import { chromium, type BrowserContext, type Frame, type Page } from "playwright";
import { mkdir, writeFile, stat } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { HAR_DIR, BROWSER_HEADLESS } from "../config.js";
import type { NavStep } from "../types.js";

// Project-root-relative paths so the extension travels with the repo and the
// persistent profile (CapMonster API key) survives across runs on the same machine.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAPMONSTER_EXT_DIR = path.resolve(__dirname, "../../resources/capmonster");
const BROWSER_PROFILE_DIR = path.resolve(__dirname, "../../browser-profile");

export interface BrowserCaptureInput {
  task_id: string;
  url: string;
  inputs: string[];
  expected_flow: string[];
  nav_steps?: NavStep[];
}

export interface VisibleElement {
  tag: string;
  text?: string;
  label?: string;
  name?: string;
  id?: string;
  type?: string;
}

export interface BrowserDiagnostics {
  current_url: string;
  page_title: string;
  visible_elements: VisibleElement[];
  dom_snippet: string;
}

export interface BrowserCaptureOutput {
  har_path: string;
  pdf_path?: string;
  popup_pages?: number;
  failed_step?: number;
  failure_reason?: string;
  diagnostics?: BrowserDiagnostics;
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

// Hosts whose requests must always pass through, even for blocked resource types.
// CapMonster extension and reCAPTCHA/hCaptcha/Turnstile challenges need their
// images, CSS and fonts to render — otherwise the solver can't classify tiles
// and the captcha never produces a token.
const CAPTCHA_HOST_WHITELIST = [
  'recaptcha.net',
  'google.com/recaptcha',
  'gstatic.com/recaptcha',
  'www.gstatic.com',
  'hcaptcha.com',
  'challenges.cloudflare.com',
];

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

async function typeIntoLocator(target: Page, locator: import("playwright").Locator, value: string, delay = 80) {
  await locator.click();
  await locator.fill('');
  for (const char of value) {
    await target.keyboard.type(char, { delay });
  }
}

// Resolve a clickable element from human-friendly text (button caption, link
// label, image alt, input value). Tries role-based locators first (more
// accurate, ignores hidden/disabled), then falls back to plain text matching
// and common input patterns. Throws if nothing visible is found within timeout.
async function clickByText(target: Page, text: string, timeout = 5000) {
  const candidates = [
    target.getByRole('button', { name: text, exact: false }),
    target.getByRole('link', { name: text, exact: false }),
    target.getByRole('menuitem', { name: text, exact: false }),
    target.locator(`input[type="submit"][value*="${text}" i]`),
    target.locator(`input[type="button"][value*="${text}" i]`),
    target.locator(`a:has-text("${text}")`),
    target.locator(`button:has-text("${text}")`),
    target.getByText(text, { exact: false }),
  ];
  for (const loc of candidates) {
    const el = loc.first();
    try {
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click({ timeout });
        return;
      }
    } catch { /* try next */ }
  }
  throw new Error(`No clickable element found for text "${text}"`);
}

// Resolve an input/textarea from a visible label and type the value. Handles
// the standard <label for=...> pattern via getByLabel, then falls back to
// inputs near the label text (common in legacy GeneXus / ASP forms where the
// label is a <td> sibling instead of a real <label>).
async function fillByLabel(target: Page, label: string, value: string) {
  const candidates = [
    target.getByLabel(label, { exact: false }),
    target.locator(`input[placeholder*="${label}" i]`),
    target.locator(`input[name*="${label.replace(/[^a-z0-9]/gi, '')}" i]`),
    target.locator(`input[id*="${label.replace(/[^a-z0-9]/gi, '')}" i]`),
    // GeneXus/legacy: input that follows a cell containing the label text.
    target.locator(`xpath=//*[contains(normalize-space(.), "${label}")]/following::input[not(@type="hidden")][1]`),
  ];
  for (const loc of candidates) {
    const el = loc.first();
    try {
      if (await el.isVisible({ timeout: 1500 })) {
        await typeIntoLocator(target, el, value);
        return;
      }
    } catch { /* try next */ }
  }
  throw new Error(`No input found for label "${label}"`);
}

// Resolve a <select> from a visible label and select the option whose visible
// text matches `value` (case-insensitive substring). Falls back to selecting
// by option value when the label match fails.
async function selectByLabel(target: Page, label: string, value: string) {
  const candidates = [
    target.getByLabel(label, { exact: false }),
    target.locator(`select[name*="${label.replace(/[^a-z0-9]/gi, '')}" i]`),
    target.locator(`xpath=//*[contains(normalize-space(.), "${label}")]/following::select[1]`),
  ];
  for (const loc of candidates) {
    const el = loc.first();
    try {
      if (await el.isVisible({ timeout: 1500 })) {
        try {
          await el.selectOption({ label: value });
        } catch {
          await el.selectOption(value);
        }
        return;
      }
    } catch { /* try next */ }
  }
  throw new Error(`No select found for label "${label}"`);
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

// Run a step, retrying once after a short pause if it throws. Covers the
// common case where the element exists but isn't visible/ready yet (timing
// flakiness on slow portals). Capped at 2 attempts to keep token costs low.
async function runWithRetry(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    return;
  } catch (err) {
    await new Promise(r => setTimeout(r, 1500));
    try {
      await fn();
    } catch {
      throw err; // surface the original error, not the retry's
    }
  }
}

// Collect a textual snapshot of the page so Claude can see what was on screen
// when a step failed — alternative to a screenshot, which is harder for the
// agent to act on. Returns visible buttons/links/inputs with their text+attrs,
// the URL, the title, and a trimmed body HTML chunk.
async function collectDiagnostics(target: Page): Promise<BrowserDiagnostics> {
  try {
    const current_url = target.url();
    const page_title = await target.title().catch(() => '');

    const visible_elements: VisibleElement[] = await target.evaluate(() => {
      const out: any[] = [];
      const sel = 'button, a, input, select, textarea, [role="button"], [role="link"]';
      const nodes = Array.from(document.querySelectorAll(sel));
      for (const node of nodes) {
        const el = node as HTMLElement;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') continue;

        const tag = el.tagName.toLowerCase();
        const text = (el.innerText || el.textContent || '').trim().slice(0, 80);
        const id = el.id || undefined;
        const name = (el as HTMLInputElement).name || undefined;
        const type = (el as HTMLInputElement).type || undefined;

        let label: string | undefined;
        if (id) {
          const lab = document.querySelector(`label[for="${id}"]`);
          if (lab) label = (lab.textContent || '').trim().slice(0, 80);
        }
        if (!label) {
          const parent = el.closest('label');
          if (parent) label = (parent.textContent || '').trim().slice(0, 80);
        }
        const value = (el as HTMLInputElement).value;
        const display = text || label || value || '';
        if (!display && !id && !name) continue;

        const entry: any = { tag };
        if (display) entry.text = display;
        if (label && label !== display) entry.label = label;
        if (name) entry.name = name;
        if (id) entry.id = id;
        if (type) entry.type = type;
        out.push(entry);
        if (out.length >= 60) break;
      }
      return out;
    }).catch(() => []);

    const body_html = await target.evaluate(() => {
      const body = document.body ? document.body.innerHTML : '';
      return body.length > 8000 ? body.slice(0, 8000) + '\n<!-- ...truncated -->' : body;
    }).catch(() => '');

    return { current_url, page_title, visible_elements, dom_snippet: body_html };
  } catch {
    return { current_url: target.url(), page_title: '', visible_elements: [], dom_snippet: '' };
  }
}

export async function browserCapture(input: BrowserCaptureInput): Promise<BrowserCaptureOutput> {
  const { task_id, url, inputs, nav_steps } = input;

  await mkdir(HAR_DIR, { recursive: true });
  const har_path = path.join(HAR_DIR, `${task_id}.har`);
  const pdf_path = path.join(HAR_DIR, `${task_id}.pdf`);

  await mkdir(BROWSER_PROFILE_DIR, { recursive: true });

  // launchPersistentContext is required to load unpacked extensions (CapMonster).
  // The userDataDir persists the CapMonster API key across runs — configure once
  // per machine by opening the extension popup and pasting the key.
  const context: BrowserContext = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    headless: false,
    slowMo: 300,
    timeout: 80000,
    acceptDownloads: true,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 },
    locale: 'pt-BR',
    extraHTTPHeaders: {
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    },
    recordHar: { path: har_path, mode: "full", content: "embed" },
    args: [
      `--disable-extensions-except=${CAPMONSTER_EXT_DIR}`,
      `--load-extension=${CAPMONSTER_EXT_DIR}`,
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

  // recordHar mode/content moved into launchPersistentContext above. The HAR is
  // configured with mode="full" + content="embed" so HTML/JSON/PDF bodies arrive
  // inline (required by CertificateBase::loadHiddenFieldsFromString).
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
    Object.defineProperty(navigator, 'languages', { get: () => ['pt-BR', 'pt', 'en-US'] });
  });

  // Persistent context opens with one blank page already — reuse it instead of
  // creating a second (avoids an extra tab and noisy 'page' events).
  const page = context.pages()[0] ?? await context.newPage();

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
    const req = route.request();
    if (BLOCKED_RESOURCES.includes(req.resourceType())) {
      const url = req.url();
      const whitelisted = CAPTCHA_HOST_WHITELIST.some(h => url.includes(h));
      if (whitelisted) {
        route.continue();
      } else {
        route.abort();
      }
    } else {
      route.continue();
    }
  });

  let failed_step: number | undefined;
  let failure_reason: string | undefined;
  let diagnostics: BrowserDiagnostics | undefined;

  try {
    if (nav_steps && nav_steps.length > 0) {
      for (let i = 0; i < nav_steps.length; i++) {
        const step = nav_steps[i]!;
        failed_step = i;

        const target: Page = pickPage(page, extraPages, step.page_index);

        await runWithRetry(async () => {
          switch (step.action) {
            case 'goto':
              await target.goto(step.url!, { waitUntil: 'domcontentloaded', timeout: 60000 });
              await target.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
              break;

            case 'fill':
              await target.locator(step.selector!).first().click();
              await fillWithDelay(target, step.selector!, step.value ?? '');
              break;

            case 'click':
              await target.locator(step.selector!).first().click();
              await target.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });
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
              await target.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });
              break;
            }

            case 'click_text': {
              if (!step.text) throw new Error("click_text requires text");
              await clickByText(target, step.text);
              await target.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });
              break;
            }

            case 'fill_field': {
              if (!step.label) throw new Error("fill_field requires label");
              await fillByLabel(target, step.label, step.value ?? '');
              break;
            }

            case 'select_text': {
              if (!step.label) throw new Error("select_text requires label");
              await selectByLabel(target, step.label, step.value ?? '');
              break;
            }
          }
        });
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
          await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
          break;
        } catch (err) {
          if (attempt >= MAX_ATTEMPTS) throw err;
          await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => { });
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
              await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => { });
              break;
            }
          } catch { /* try next */ }
        }
      }

      await page.waitForTimeout(2000);
    }
  } catch (err) {
    failure_reason = (err as Error).message;
    // Collect diagnostics from the page that was active when the step failed,
    // so the agent can see what was on screen and adjust the step on retry —
    // alternative to a screenshot, which Claude can't easily turn into a fix.
    try {
      const failedStep = failed_step !== undefined ? nav_steps?.[failed_step] : undefined;
      const target = pickPage(page, extraPages, failedStep?.page_index);
      diagnostics = await collectDiagnostics(target);
    } catch { /* best-effort */ }
  } finally {
    // If response listener captured a PDF and the download path didn't fire, persist it.
    if (!pdfSavedFromDownload && pdfFromResponse && !(await fileExists(pdf_path))) {
      try { await writeFile(pdf_path, pdfFromResponse); } catch { /* best-effort */ }
    }
    // closing the persistent context shuts down the browser as well
    await context.close();
  }

  const out: BrowserCaptureOutput = { har_path };
  if (await fileExists(pdf_path)) out.pdf_path = pdf_path;
  if (extraPages.length > 0) out.popup_pages = extraPages.length;
  if (failed_step !== undefined) out.failed_step = failed_step;
  if (failure_reason) out.failure_reason = failure_reason;
  if (diagnostics) out.diagnostics = diagnostics;
  return out;
}
