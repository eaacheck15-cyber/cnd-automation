import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import path from "path";
import { HAR_DIR } from "../config.js";
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

async function fillWithDelay(page: any, selector: string, value: string, delay = 80) {
  await page.focus(selector);
  for (const char of value) {
    await page.keyboard.type(char, { delay });
  }
}

export async function browserCapture(input: BrowserCaptureInput): Promise<BrowserCaptureOutput> {
  const { task_id, url, inputs, nav_steps } = input;

  await mkdir(HAR_DIR, { recursive: true });
  const har_path = path.join(HAR_DIR, `${task_id}.har`);

  const browser = await chromium.launch({
    headless: false,
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

  const context = await browser.newContext({
    recordHar: { path: har_path },
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

  await page.route('**/*', (route: any) => {
    if (BLOCKED_RESOURCES.includes(route.request().resourceType())) {
      route.abort();
    } else {
      route.continue();
    }
  });

  try {
    if (nav_steps && nav_steps.length > 0) {
      // Execute precise steps provided by Claude after HTML analysis
      for (const step of nav_steps) {
        switch (step.action) {
          case 'goto':
            await page.goto(step.url!, { waitUntil: 'domcontentloaded', timeout: 60000 });
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            break;
          case 'fill':
            await page.locator(step.selector!).first().click();
            await fillWithDelay(page, step.selector!, step.value ?? '');
            break;
          case 'click':
            await page.locator(step.selector!).first().click();
            await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
            break;
          case 'select':
            await page.locator(step.selector!).first().selectOption(step.value ?? '');
            break;
          case 'wait':
            await page.waitForTimeout(step.ms ?? 1000);
            break;
        }
      }
    } else {
      // Fallback: generic selectors for when nav_steps are not provided
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
        const cnpj = inputs[0];
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
  } finally {
    await context.close();
    await browser.close();
  }

  return { har_path };
}
