import { spawn, type ChildProcess } from "child_process";
import { mkdir, writeFile, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import CDP from "chrome-remote-interface";
import { AHK_BINARY, CHROME_BINARY, HAR_DIR } from "../config.js";
import { findText, ocrWords, saveScreenshot } from "./ocr.js";
import type { NavStep } from "../types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AHK_RUNNER = path.resolve(__dirname, "../../resources/ahk/runner.ahk");
// Profile persistente — mesmo dir que o Playwright (browser.ts) usa. Cookies,
// histórico e fingerprint acumulam organicamente ao longo das execuções,
// melhorando o score em proteções como Cloudflare. Nunca conflita com o
// Chrome do usuário porque é um user-data-dir separado.
const PERSISTENT_PROFILE_DIR = path.resolve(__dirname, "../../browser-profile");

const CDP_PORT = 9222;
const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 900;

export interface BrowserAhkInput {
  task_id: string;
  url: string;
  inputs: string[];
  expected_flow: string[];
  nav_steps?: NavStep[];
  // Diagnóstico do pipeline_browser_capture (Playwright) quando ele falhou.
  // Usamos só pra decidir se devemos esperar por Cloudflare antes do 1º clique —
  // o resto (cookies, sessão) já viaja via profile compartilhado.
  playwright_diagnostics?: {
    page_title?: string;
    dom_snippet?: string;
  };
}

export interface BrowserAhkOutput {
  har_path: string;
  pdf_path?: string;
  failed_step?: number;
  failure_reason?: string;
  mode: "ahk";
}

// Cada entrada do HAR é construída incrementalmente conforme os eventos CDP
// chegam. Mantemos um Map por requestId pra agregar request + response + body.
interface HarEntryDraft {
  requestId: string;
  startedDateTime: string;
  request: {
    method: string;
    url: string;
    headers: Array<{ name: string; value: string }>;
    postData?: { mimeType: string; text: string };
  };
  response?: {
    status: number;
    statusText: string;
    headers: Array<{ name: string; value: string }>;
    content: { mimeType: string; text?: string; size: number };
  };
  cookies: Array<{ name: string; value: string }>;
}

// Heurística leve sobre o snapshot do Playwright: confirma que a falha foi
// por Cloudflare/challenge interativo, não por outro motivo. Quando true,
// o goto vai aguardar dinamicamente o challenge cair antes de seguir.
function looksLikeCloudflareChallenge(diag?: BrowserAhkInput["playwright_diagnostics"]): boolean {
  if (!diag) return false;
  const title = (diag.page_title ?? "").toLowerCase();
  const dom = (diag.dom_snippet ?? "").toLowerCase();
  return (
    title.includes("um momento") ||
    title.includes("just a moment") ||
    title.includes("verifying") ||
    dom.includes("cdn-cgi/challenge-platform") ||
    dom.includes("cf_chl_opt")
  );
}

export async function browserCaptureAhk(input: BrowserAhkInput): Promise<BrowserAhkOutput> {
  const { task_id, nav_steps } = input;
  const expectChallenge = looksLikeCloudflareChallenge(input.playwright_diagnostics);

  await mkdir(HAR_DIR, { recursive: true });
  const har_path = path.join(HAR_DIR, `${task_id}.har`);
  const pdf_path = path.join(HAR_DIR, `${task_id}.pdf`);

  await mkdir(PERSISTENT_PROFILE_DIR, { recursive: true });
  const profileDir = PERSISTENT_PROFILE_DIR;
  // Limpa lock de execução anterior abortada — sem isso o Chrome novo falha com
  // "profile is in use". Não afeta o Chrome do usuário porque é outro user-data-dir.
  await Promise.all([
    rmIfExists(path.join(profileDir, "SingletonLock")),
    rmIfExists(path.join(profileDir, "SingletonCookie")),
    rmIfExists(path.join(profileDir, "SingletonSocket")),
  ]);
  let chromeProc: ChildProcess | null = null;
  let client: CDP.Client | null = null;
  const entries = new Map<string, HarEntryDraft>();
  let pdfBuffer: Buffer | null = null;
  let failed_step: number | undefined;
  let failure_reason: string | undefined;

  try {
    chromeProc = launchChrome(profileDir);
    await waitForCdp(CDP_PORT, 20000);

    client = await CDP({ port: CDP_PORT });
    const { Page, Network, Runtime, Target } = client;
    await Page.enable();
    await Network.enable({});
    await Runtime.enable();

    // Coleta de tráfego — eventos CDP convertidos em HAR entries.
    Network.requestWillBeSent((p) => {
      const draft: HarEntryDraft = entries.get(p.requestId) ?? {
        requestId: p.requestId,
        startedDateTime: new Date(p.wallTime * 1000).toISOString(),
        request: {
          method: p.request.method,
          url: p.request.url,
          headers: Object.entries(p.request.headers).map(([name, value]) => ({ name, value: String(value) })),
        },
        cookies: [],
      };
      // Redirect chain: o evento pode reescrever a request original.
      draft.request.method = p.request.method;
      draft.request.url = p.request.url;
      draft.request.headers = Object.entries(p.request.headers).map(([name, value]) => ({ name, value: String(value) }));
      if (p.request.postData) {
        draft.request.postData = {
          mimeType: String(p.request.headers["Content-Type"] ?? p.request.headers["content-type"] ?? "application/x-www-form-urlencoded"),
          text: p.request.postData,
        };
      }
      entries.set(p.requestId, draft);
    });

    Network.responseReceived((p) => {
      const draft = entries.get(p.requestId);
      if (!draft) return;
      draft.response = {
        status: p.response.status,
        statusText: p.response.statusText ?? "",
        headers: Object.entries(p.response.headers).map(([name, value]) => ({ name, value: String(value) })),
        content: {
          mimeType: p.response.mimeType,
          size: p.response.encodedDataLength ?? 0,
        },
      };
    });

    // Após cada loadingFinished, tentamos puxar o body. Isso é "best-effort" —
    // se a request já não estiver disponível (ex.: navegação trocou de documento),
    // só pulamos.
    Network.loadingFinished(async (p) => {
      const draft = entries.get(p.requestId);
      if (!draft?.response) return;
      try {
        const body = await Network.getResponseBody({ requestId: p.requestId });
        if (draft.response.content) {
          draft.response.content.text = body.base64Encoded
            ? Buffer.from(body.body, "base64").toString("binary")
            : body.body;
        }
        // PDF detection: magic bytes %PDF-
        if (body.base64Encoded) {
          const buf = Buffer.from(body.body, "base64");
          if (buf.length >= 5 && buf.slice(0, 5).toString("ascii") === "%PDF-") {
            pdfBuffer = buf;
          }
        }
      } catch { /* request may be gone */ }
    });

    // Bring Chrome to front via AHK so all subsequent input lands on it.
    await runAhk(["focus", "Chrome"]);
    // Get viewport offset (where the client area starts relative to screen).
    const offset = await getChromeOffset(client);

    if (nav_steps && nav_steps.length > 0) {
      for (let i = 0; i < nav_steps.length; i++) {
        const step = nav_steps[i]!;
        failed_step = i;
        await executeStep(client, step, offset, task_id, i);
        // Após o primeiro goto, se o Playwright nos avisou que tinha Cloudflare
        // ou se a página atual ainda parece um challenge, espera dinamicamente.
        if (step.action === "goto") {
          await waitForChallengeCleared(client, expectChallenge ? 45000 : 15000);
        }
      }
      failed_step = undefined;
      // Give late XHRs a chance to land.
      await sleep(2000);
    }
  } catch (err) {
    failure_reason = (err as Error).message;
  } finally {
    if (client) await client.close().catch(() => { /* best-effort */ });
    if (chromeProc && !chromeProc.killed) {
      chromeProc.kill();
      await sleep(500);
    }
  }

  // Persist HAR even on failure (partial captures are useful).
  await writeHar(har_path, Array.from(entries.values()));
  if (pdfBuffer) {
    await writeFile(pdf_path, pdfBuffer);
  }

  // Profile é persistente — não deletar entre runs (esse é o ponto).

  const out: BrowserAhkOutput = { har_path, mode: "ahk" };
  if (await fileExists(pdf_path)) out.pdf_path = pdf_path;
  if (failed_step !== undefined) out.failed_step = failed_step;
  if (failure_reason) out.failure_reason = failure_reason;
  return out;
}

function launchChrome(profileDir: string): ChildProcess {
  const args = [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    `--window-position=0,0`,
    `--window-size=${WINDOW_WIDTH},${WINDOW_HEIGHT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--lang=pt-BR",
    "about:blank",
  ];
  return spawn(CHROME_BINARY, args, {
    detached: false,
    stdio: "ignore",
    windowsHide: false,
  });
}

async function waitForCdp(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (resp.ok) return;
    } catch { /* not ready */ }
    await sleep(300);
  }
  throw new Error(`Chrome CDP did not come up on port ${port} within ${timeoutMs}ms`);
}

// Computa o offset entre o canto superior esquerdo da janela (onde Chrome foi
// posicionado, 0,0) e o canto superior esquerdo do viewport (área de renderização).
// É o que precisamos somar nas coordenadas do screenshot pra clicar na tela real.
async function getChromeOffset(client: CDP.Client): Promise<{ x: number; y: number }> {
  const metrics = await client.Page.getLayoutMetrics();
  // visualViewport.clientWidth/Height são o viewport CSS; comparamos com a janela.
  const vh = metrics.cssLayoutViewport?.clientHeight ?? metrics.layoutViewport.clientHeight;
  // Y offset = window height (1080) - viewport height. X offset costuma ser 0.
  const offsetY = Math.max(0, WINDOW_HEIGHT - vh);
  return { x: 0, y: offsetY };
}

async function executeStep(
  client: CDP.Client,
  step: NavStep,
  offset: { x: number; y: number },
  taskId: string,
  stepIndex: number
): Promise<void> {
  const { Page, Input } = client;

  switch (step.action) {
    case "goto": {
      await Page.navigate({ url: step.url! });
      // Wait for the document to be reasonably idle: load event + extra grace
      // because Cloudflare/Flutter pages keep loading XHRs after `load`.
      await waitForLoad(client, 30000);
      await sleep(3000);
      return;
    }

    case "wait": {
      await sleep(step.ms ?? 1000);
      return;
    }

    case "click_text": {
      if (!step.text) throw new Error("click_text requires text");
      const match = await findOnScreen(client, step.text, taskId, stepIndex);
      if (!match) throw new Error(`text "${step.text}" not found on screen`);
      await runAhk(["click", String(match.x + offset.x), String(match.y + offset.y)]);
      await sleep(800);
      return;
    }

    case "fill_field": {
      if (!step.label) throw new Error("fill_field requires label");
      const match = await findOnScreen(client, step.label, taskId, stepIndex);
      if (!match) throw new Error(`label "${step.label}" not found on screen`);
      // No Flutter, o "input" geralmente fica ao lado/abaixo do label. Tentamos
      // clicar um pouco à direita do label primeiro; se o cursor não engatar,
      // o usuário pode adicionar um click_xy explícito antes do type.
      const inputX = match.right + 20 + offset.x;
      const inputY = match.y + offset.y;
      await runAhk(["click", String(inputX), String(inputY)]);
      await sleep(300);
      await runAhk(["type", step.value ?? ""]);
      await sleep(500);
      return;
    }

    case "select_text": {
      if (!step.label) throw new Error("select_text requires label");
      // Abre o dropdown clicando no label, espera animação, OCR procura o valor, clica.
      const labelMatch = await findOnScreen(client, step.label, taskId, stepIndex);
      if (!labelMatch) throw new Error(`label "${step.label}" not found on screen`);
      await runAhk(["click", String(labelMatch.x + offset.x), String(labelMatch.y + offset.y)]);
      await sleep(800);
      const valueMatch = await findOnScreen(client, step.value ?? "", taskId, stepIndex);
      if (!valueMatch) throw new Error(`value "${step.value}" not visible after opening dropdown`);
      await runAhk(["click", String(valueMatch.x + offset.x), String(valueMatch.y + offset.y)]);
      await sleep(500);
      return;
    }

    // Selector-based actions don't apply in AHK mode (no DOM access).
    case "fill":
    case "click":
    case "select":
    case "frame_fill":
    case "frame_click":
      throw new Error(`action "${step.action}" not supported in AHK mode — use click_text / fill_field instead`);
  }
}

async function findOnScreen(
  client: CDP.Client,
  query: string,
  taskId: string,
  stepIndex: number
): Promise<{ x: number; y: number; right: number } | null> {
  const { data } = await client.Page.captureScreenshot({ format: "png" });
  const pngPath = await saveScreenshot(data, taskId, stepIndex);
  const words = await ocrWords(pngPath, "por+eng");
  const match = findText(words, query);
  return match;
}

// Polling leve do document.title via CDP — sai assim que o título deixa de
// parecer challenge (custa ~50ms por check, muito mais barato que screenshot+OCR).
// Se nunca cair dentro do timeout, retorna mesmo assim — deixa o step seguinte
// falhar com diagnóstico claro em vez de travar a captura.
async function waitForChallengeCleared(client: CDP.Client, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { result } = await client.Runtime.evaluate({ expression: "document.title", returnByValue: true });
    const title = String(result?.value ?? "").toLowerCase();
    const stillChallenge =
      title.includes("um momento") ||
      title.includes("just a moment") ||
      title.includes("verifying") ||
      title.includes("attention required");
    if (!stillChallenge) return;
    await sleep(800);
  }
}

async function waitForLoad(client: CDP.Client, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    client.Page.loadEventFired(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function runAhk(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(AHK_BINARY, [AHK_RUNNER, ...args], { windowsHide: true });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", d => { stdout += d.toString(); });
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`AHK failed (${code}): ${stdout.trim() || stderr.trim()}`));
    });
  });
}

async function writeHar(harPath: string, entries: HarEntryDraft[]): Promise<void> {
  const har = {
    log: {
      version: "1.2",
      creator: { name: "cnd-pipeline-ahk", version: "1.0" },
      entries: entries
        .filter(e => e.response) // skip requests that never got a response
        .map(e => ({
          startedDateTime: e.startedDateTime,
          time: 0,
          request: {
            method: e.request.method,
            url: e.request.url,
            httpVersion: "HTTP/1.1",
            headers: e.request.headers,
            cookies: [],
            queryString: parseQuery(e.request.url),
            ...(e.request.postData ? { postData: e.request.postData } : {}),
            headersSize: -1,
            bodySize: e.request.postData?.text.length ?? -1,
          },
          response: {
            status: e.response!.status,
            statusText: e.response!.statusText,
            httpVersion: "HTTP/1.1",
            headers: e.response!.headers,
            cookies: [],
            content: {
              mimeType: e.response!.content.mimeType,
              size: e.response!.content.text?.length ?? e.response!.content.size,
              text: e.response!.content.text ?? "",
            },
            redirectURL: "",
            headersSize: -1,
            bodySize: e.response!.content.text?.length ?? -1,
          },
          cache: {},
          timings: { send: 0, wait: 0, receive: 0 },
        })),
    },
  };
  await writeFile(harPath, JSON.stringify(har, null, 2), "utf8");
}

function parseQuery(url: string): Array<{ name: string; value: string }> {
  try {
    const u = new URL(url);
    return Array.from(u.searchParams.entries()).map(([name, value]) => ({ name, value }));
  } catch { return []; }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function rmIfExists(p: string): Promise<void> {
  try { await (await import("fs/promises")).unlink(p); } catch { /* not there */ }
}
