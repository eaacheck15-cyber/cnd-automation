import { chromium, type Browser, type BrowserContext, type Frame, type Page } from "playwright";
import { mkdir, writeFile, stat } from "fs/promises";
import path from "path";
import { HAR_DIR, BROWSER_HEADLESS } from "../config.js";
import type { NavStep } from "../types.js";

export interface BrowserCaptureInput {
  task_id: string;
  url: string;
  inputs: string[];
  expected_flow: string[];
  nav_steps?: NavStep[];
}

export interface BrowserCaptureOutput {
  har_path: string;
  pdf_path?: string;
  popup_pages?: number;
  failed_step?: number;
  failure_reason?: string;
}

const CNPJ_SELECTORS = [
  'input[name*="cnpj" i]',
  'input[placeholder*="cnpj" i]',
  'input[id*="cnpj" i]',
  'input[name*="cpf" i]',
  'input[placeholder*="cpf" i]',
  'input[id*="cpf" i]',
  'input[name*="document" i]',
  'input[placeholder*="document" i]',
  'input[name*="registration" i]',
  'input[type="text"]:visible',
];

const SUBMIT_SELECTORS = [
  'button:has-text("Gerar")',
  'button:has-text("Consultar")',
  'button:has-text("Emitir")',
  'button:has-text("Buscar")',
  'button:has-text("Pesquisar")',
  'button:has-text("Imprimir")',
  'button:has-text("Certidão")',
  'input[value*="Gerar" i]',
  'input[value*="Consultar" i]',
  'input[value*="Emitir" i]',
  'input[type="submit"]',
  'button[type="submit"]',
];

const BLOCKED_RESOURCES = ['image', 'stylesheet', 'font', 'media'];

type FillTarget = Page | Frame;

async function fillWithDelay(target: FillTarget, selector: string, value: string, delay = 80) {
  const loc = target.locator(selector).first();
  await loc.click();
  await loc.fill('');
  // Frame doesn't expose keyboard directly — fall back to its owning page.
  const keyboard = 'keyboard' in target ? target.keyboard : target.page().keyboard;
  for (const char of value) {
    await keyboard.type(char, { delay });
  }
}

// Pattern adapted from qscraping certificateICMSdeSP.js (lines 50-55):
// poll page.frames() for up to 6s looking for a frame whose URL matches.
async function findFrame(page: Page, frameUrl: string): Promise<Frame> {
  for (let i = 0; i < 6; i++) {
    const frame = page.frames().find(f => f.url().includes(frameUrl));
    if (frame) return frame;
    await page.waitForTimeout(1000);
  }
  const known = page.frames().map(f => f.url()).join(", ");
  throw new Error(`Frame not found for url substring "${frameUrl}". Known frames: [${known}]`);
}

function pickPage(mainPage: Page, extraPages: Page[], pageIndex: number | undefined): Page {
  if (!pageIndex) return mainPage;
  const popup = extraPages[pageIndex - 1];
  if (!popup) {
    throw new Error(`page_index ${pageIndex} requested but only ${extraPages.length} popup(s) detected`);
  }
  return popup;
}

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

export async function browserCapture(input: BrowserCaptureInput): Promise<BrowserCaptureOutput> {
  const { task_id, url, inputs, nav_steps } = input;

  await mkdir(HAR_DIR, { recursive: true });
  const har_path = path.join(HAR_DIR, `${task_id}.har`);
  const pdf_path = path.join(HAR_DIR, `${task_id}.pdf`);

  const browser: Browser = await chromium.launch({
    headless: BROWSER_HEADLESS,
    slowMo: 300,
    timeout: 80000,
    args: [
      '--autoplay-policy=user-gesture-required',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      '--disable-domain-reliability',
      '--disable-features=AudioServiceOutOfProcess',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-notifications',
      '--disable-popup-blocking',
      '--disable-print-preview',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-setuid-sandbox',
      '--disable-speech-api',
      '--disable-sync',
      '--hide-scrollbars',
      '--ignore-gpu-blacklist',
      '--metrics-recording-only',
      '--mute-audio',
      '--no-default-browser-check',
      '--no-first-run',
      '--no-pings',
      '--no-sandbox',
      '--no-zygote',
      '--password-store=basic',
      '--use-gl=swiftshader',
      '--use-mock-keychain',
      '--disable-blink-features=AutomationControlled',
      '--ignore-certificate-errors',
      '--disable-web-security',
      '--disable-gpu',
      '--disable-infobars',
      '--lang=pt-BR',
    ],
  });

  // recordHar.mode "full" preserves redirects/iframes/popups; content "embed" keeps
  // bodies inline as base64 — required by CertificateBase::loadHiddenFieldsFromString
  // (Workspace/cnd app/Certificates/CertificateBase.php) which parses HTML/JSON bodies.
  const context: BrowserContext = await browser.newContext({
    recordHar: { path: har_path, mode: "full", content: "embed" },
    acceptDownloads: true,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: 'pt-BR',
    extraHTTPHeaders: {
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US'] });
  });

  const page = await context.newPage();

  // Pattern from qscraping certificateRJSINCAD.js (lines 23-33): collect popups
  // opened via window.open / target=_blank so steps can target them by page_index.
  const extraPages: Page[] = [];
  context.on('page', async (newPage) => {
    extraPages.push(newPage);
    try { await newPage.waitForLoadState('domcontentloaded', { timeout: 15000 }); } catch { /* still usable */ }
  });

  // Capture PDF binaries — two complementary strategies:
  // (a) Inline PDF responses via page.on('response') — pattern from certificateCE.js:151-161
  // (b) Browser download dialogs (Content-Disposition: attachment) via page.on('download')
  let pdfFromResponse: Buffer | null = null;
  let pdfSavedFromDownload = false;

  const attachPdfHooks = (target: Page) => {
    target.on('response', async (response) => {
      try {
        const ct = (response.headers()['content-type'] ?? '').toLowerCase();
        if (response.status() === 200 && (ct.includes('pdf') || ct.includes('octet-stream'))) {
          const buf = await response.body();
          if (buf && buf.length > 0) pdfFromResponse = buf;
        }
      } catch { /* response stream may already be consumed */ }
    });
    target.on('download', async (dl) => {
      try {
        await dl.saveAs(pdf_path);
        pdfSavedFromDownload = true;
      } catch { /* best-effort */ }
    });
  };
  attachPdfHooks(page);
  context.on('page', attachPdfHooks);

  await page.route('**/*', (route: any) => {
    if (BLOCKED_RESOURCES.includes(route.request().resourceType())) {
      route.abort();
    } else {
      route.continue();
    }
  });

  let failed_step: number | undefined;
  let failure_reason: string | undefined;

  try {
    if (nav_steps && nav_steps.length > 0) {
      for (let i = 0; i < nav_steps.length; i++) {
        const step = nav_steps[i]!;
        failed_step = i;

        const target: Page = pickPage(page, extraPages, step.page_index);

        switch (step.action) {
          case 'goto':
            await target.goto(step.url!, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await target.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            break;

          case 'fill':
            await target.locator(step.selector!).first().click();
            await fillWithDelay(target, step.selector!, step.value ?? '');
            break;

          case 'click':
            await target.locator(step.selector!).first().click();
            await target.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
            break;

          case 'select':
            await target.locator(step.selector!).first().selectOption(step.value ?? '');
            break;

          case 'wait':
            await target.waitForTimeout(step.ms ?? 1000);
            break;

          case 'frame_fill': {
            if (!step.frame_url) throw new Error("frame_fill requires frame_url");
            const frame = await findFrame(target, step.frame_url);
            await frame.locator(step.selector!).first().click();
            await fillWithDelay(frame, step.selector!, step.value ?? '');
            break;
          }

          case 'frame_click': {
            if (!step.frame_url) throw new Error("frame_click requires frame_url");
            const frame = await findFrame(target, step.frame_url);
            await frame.locator(step.selector!).first().click();
            await target.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
            break;
          }
        }
      }
      failed_step = undefined;

      // Give late XHR/polling/redirects a chance to complete and land in HAR.
      await page.waitForTimeout(2000);
    } else {
      // Fallback: legacy heuristic for when nav_steps is omitted. Kept for backwards
      // compat; /auto always supplies nav_steps so this path is rarely taken.
      const MAX_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
          break;
        } catch (err) {
          if (attempt >= MAX_ATTEMPTS) throw err;
          await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        }
      }

      if (inputs.length > 0) {
        const cnpj = inputs[0]!;
        for (const sel of CNPJ_SELECTORS) {
          try {
            const el = page.locator(sel).first();
            if (await el.isVisible({ timeout: 2000 })) {
              await el.click();
              await fillWithDelay(page, sel, cnpj);
              break;
            }
          } catch { /* try next */ }
        }

        await page.waitForTimeout(800);

        for (const sel of SUBMIT_SELECTORS) {
          try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 2000 })) {
              await btn.click();
              await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
              break;
            }
          } catch { /* try next */ }
        }
      }

      await page.waitForTimeout(2000);
    }
  } catch (err) {
    failure_reason = (err as Error).message;
    const stepInfo = failed_step !== undefined ? ` at step ${failed_step}` : '';
    throw new Error(`browserCapture failed${stepInfo}: ${failure_reason}`);
  } finally {
    // If response listener captured a PDF and the download path didn't fire, persist it.
    if (!pdfSavedFromDownload && pdfFromResponse && !(await fileExists(pdf_path))) {
      try { await writeFile(pdf_path, pdfFromResponse); } catch { /* best-effort */ }
    }
    await context.close();
    await browser.close();
  }

  const out: BrowserCaptureOutput = { har_path };
  if (await fileExists(pdf_path)) out.pdf_path = pdf_path;
  if (extraPages.length > 0) out.popup_pages = extraPages.length;
  if (failed_step !== undefined) out.failed_step = failed_step;
  if (failure_reason) out.failure_reason = failure_reason;
  return out;
}
