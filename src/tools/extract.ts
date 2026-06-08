import { readFile } from "fs/promises";
import type { FlowStep } from "../types.js";

export interface ExtractHarInput {
  har_path: string;
}

const IGNORE_EXTENSIONS = [
  "css", "js", "png", "jpg", "jpeg", "gif", "svg",
  "woff", "woff2", "ico", "map",
];

const ALLOWED_HEADERS = ["content-type", "origin", "referer", "cookie"];

export async function extractHar(input: ExtractHarInput): Promise<FlowStep[]> {
  const raw = await readFile(input.har_path, "utf-8");
  return fromJson(raw);
}

function fromJson(json: string): FlowStep[] {
  let har: any;

  try {
    har = JSON.parse(json);
  } catch {
    throw new Error("HAR inválido: falha ao parsear JSON.");
  }

  if (!har?.log?.entries) {
    throw new Error("HAR inválido: estrutura log.entries ausente.");
  }

  return processEntries(har.log.entries);
}

function processEntries(entries: any[]): FlowStep[] {
  const result: FlowStep[] = [];
  let step = 0;

  for (const entry of entries) {
    const request = entry.request ?? {};
    const response = entry.response ?? {};

    const url = (request.url ?? "") as string;
    const method = ((request.method ?? "") as string).toUpperCase();

    if (!isRelevant(url, method)) continue;

    step++;

    result.push({
      step,
      method,
      url,
      query:    extractQuery(url),
      headers:  cleanHeaders(request.headers ?? []),
      cookies:  extractCookies(request.cookies ?? []),
      payload:  extractPayload(request.postData ?? null) || null,
      status: response.status ?? null,
    });
  }

  return result;
}

function isRelevant(url: string, method: string): boolean {
  if (isAsset(url)) return false;
  return method === "GET" || method === "POST";
}

function isAsset(url: string): boolean {
  const path = (new URL(url, "http://x").pathname).toLowerCase();
  return IGNORE_EXTENSIONS.some((ext) => path.endsWith(`.${ext}`));
}

function extractQuery(url: string): string | null {
  try {
    return new URL(url).search.replace(/^\?/, "") || null;
  } catch {
    return null;
  }
}

function extractPayload(postData: any): string {
  if (!postData) return "";

  if (postData.text) return postData.text as string;

  if (Array.isArray(postData.params) && postData.params.length > 0) {
    return postData.params
      .map((p: any) => `${encodeURIComponent(p.name ?? "")}=${encodeURIComponent(p.value ?? "")}`)
      .join("&");
  }

  return "";
}

function cleanHeaders(headers: any[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (const header of headers) {
    const name = ((header.name ?? "") as string).toLowerCase();
    if (ALLOWED_HEADERS.includes(name)) {
      result[name] = (header.value ?? "") as string;
    }
  }

  return result;
}

function extractCookies(cookies: any[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (const cookie of cookies) {
    if (cookie.name) {
      result[cookie.name as string] = (cookie.value ?? "") as string;
    }
  }

  return result;
}
