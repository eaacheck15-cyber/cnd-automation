import type { FlowStep, InterpretedStep, BlockType, FlowType, InterpretFlowOutput } from "../types.js";

export interface InterpretFlowInput {
  flow: FlowStep[];
  artisan_feedback?: string;
}

export async function interpretFlow(input: InterpretFlowInput): Promise<InterpretFlowOutput> {
  const { flow } = input;

  const flow_type = detectFlowType(flow);
  const steps     = classifySteps(flow);

  return { flow_type, steps };
}

// ─── FlowType detection ───────────────────────────────────────────────────────

function detectFlowType(flow: FlowStep[]): FlowType {
  const urls     = flow.map(s => s.url.toLowerCase());
  const payloads = flow.map(s => (s.payload ?? "").toLowerCase());

  const hasGovBr     = urls.some(u => u.includes("sso.acesso.gov.br") || u.includes("certificado.sso.acesso.gov.br"));
  const hasOAuth     = urls.some(u => u.includes("client_id") && (u.includes("authorization") || u.includes("oauth")));
  const hasLoginForm = payloads.some(p => /usuario|senha|password/.test(p));
  const hasPolling   = detectPollingUrls(flow);
  const hasCaptcha   = urls.some(u => u.includes("cf-turnstile") || u.includes("hcaptcha"))
                    || payloads.some(p => p.includes("cf-turnstile-response") || p.includes("h-captcha-response"));

  const activeCount = [hasGovBr || hasOAuth, hasLoginForm, hasPolling, hasCaptcha].filter(Boolean).length;
  if (activeCount > 1) return "HIBRIDO";
  if (hasGovBr || hasOAuth) return "LOGIN_CERT";
  if (hasLoginForm)         return "LOGIN_FORM";
  if (hasPolling)           return "PROTOCOLO";
  if (hasCaptcha)           return "CAPTCHA";
  return "DIRETO";
}

function detectPollingUrls(flow: FlowStep[]): boolean {
  const counts: Record<string, number> = {};
  for (const s of flow) {
    const key = `${s.method}:${s.url}`;
    counts[key] = (counts[key] ?? 0) + 1;
    if (counts[key] >= 2) return true;
  }
  return false;
}

// ─── Block classification ─────────────────────────────────────────────────────

function classifySteps(flow: FlowStep[]): InterpretedStep[] {
  // Pre-count occurrences for polling detection
  const totalCounts: Record<string, number> = {};
  for (const s of flow) {
    const key = `${s.method}:${s.url}`;
    totalCounts[key] = (totalCounts[key] ?? 0) + 1;
  }

  const seenCounts: Record<string, number> = {};
  const result: InterpretedStep[] = [];
  let hasInit = false;

  for (const step of flow) {
    const key = `${step.method}:${step.url}`;
    seenCounts[key] = (seenCounts[key] ?? 0) + 1;

    const type = classifyStep(step, hasInit, totalCounts[key]!, seenCounts[key]!);
    if (type === "INIT") hasInit = true;

    result.push({ type, step });
  }

  // VALIDACAO is always the last logical block (processIssuance — no HTTP step)
  const lastStep = result.at(-1)?.step;
  if (lastStep) result.push({ type: "VALIDACAO", step: lastStep });

  return result;
}

function classifyStep(
  step: FlowStep,
  hasInit: boolean,
  totalCount: number,
  seenCount: number,
): BlockType {
  const url     = step.url.toLowerCase();
  const payload = (step.payload ?? "").toLowerCase();

  // POLLING: same URL+method seen more than once (not on the first occurrence)
  if (totalCount >= 2 && seenCount > 1) return "POLLING";

  // INIT: first GET without payload — session initialization
  if (!hasInit && step.method === "GET" && !step.payload) return "INIT";

  // AUTH: SSO gov.br, OAuth, login endpoints, or credentials in payload
  if (
    url.includes("sso.acesso.gov.br") ||
    url.includes("certificado.sso.acesso.gov.br") ||
    url.includes("/oauth") ||
    url.includes("/login") ||
    url.includes("/auth") ||
    url.includes("client_id") ||
    /[?&](usuario|senha)=/.test(url) ||
    /usuario|senha|password/.test(payload)
  ) return "AUTH";

  // DOWNLOAD: PDF/download endpoints
  if (
    url.includes("/download") ||
    url.includes("/pdf") ||
    url.endsWith(".pdf") ||
    /certid(ao|ão|oes|ões)/i.test(url) ||
    step.headers["content-type"]?.includes("application/pdf")
  ) return "DOWNLOAD";

  // CONSULTA: POST with CNPJ/CPF in payload
  if (
    step.method === "POST" &&
    /cnpj|cpf|cgc|inscricao|inscri[cç][aã]o|registration/.test(payload)
  ) return "CONSULTA";

  // EMISSAO: any other POST (generates protocol or certificate number)
  if (step.method === "POST") return "EMISSAO";

  // Remaining GET after INIT (loading tokens, intermediate pages)
  return "INIT";
}
