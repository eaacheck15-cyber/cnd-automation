import { spawn } from "child_process";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
import path from "path";
import os from "os";
import { TESSERACT_BINARY, TESSDATA_DIR } from "../config.js";

// Bounding box de uma palavra detectada pelo Tesseract no formato TSV.
// As coordenadas são absolutas em pixels da imagem analisada.
export interface OcrWord {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  conf: number; // 0-100; -1 = grupo (linha/bloco), descartado
}

export interface OcrMatch {
  // Centro da caixa que delimita o(s) token(s) casados — pronto para AHK Click.
  x: number;
  y: number;
  // Bounding box agregada dos tokens casados (útil para encontrar campo vizinho).
  left: number;
  top: number;
  right: number;
  bottom: number;
  matched_text: string;
  confidence: number;
}

// Roda tesseract no PNG salvo e devolve cada palavra detectada com bbox.
// Usamos o modo TSV (--psm 6 = "single uniform block of text") porque ele
// emite uma linha por palavra com coordenadas — ideal pra localizar texto
// específico na tela. PSM 6 é melhor que o default (3) pra páginas web onde
// o texto está em múltiplos blocos pequenos.
export async function ocrWords(pngPath: string, lang = "por+eng"): Promise<OcrWord[]> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "cnd-ocr-"));
  const out = path.join(tmp, "out");
  try {
    // -c tessedit_create_tsv=1 em vez do config "tsv" porque a tessdata custom
    // não inclui a pasta configs/. Mesmo efeito (gera <out>.tsv).
    await runTesseract([
      pngPath,
      out,
      "-l", lang,
      "--tessdata-dir", TESSDATA_DIR,
      "--psm", "6",
      "-c", "tessedit_create_tsv=1",
    ]);
    const tsv = await readFile(`${out}.tsv`, "utf8");
    return parseTsv(tsv);
  } finally {
    await unlink(`${out}.tsv`).catch(() => { /* best-effort */ });
  }
}

// TSV header: level page_num block_num par_num line_num word_num left top width height conf text
function parseTsv(tsv: string): OcrWord[] {
  const out: OcrWord[] = [];
  const lines = tsv.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = line.split("\t");
    if (cols.length < 12) continue;
    const conf = Number(cols[10]);
    const text = (cols[11] ?? "").trim();
    if (!text || conf < 0) continue;
    out.push({
      text,
      left: Number(cols[6]),
      top: Number(cols[7]),
      width: Number(cols[8]),
      height: Number(cols[9]),
      conf,
    });
  }
  return out;
}

// Encontra a melhor casamento para o texto buscado entre as palavras detectadas.
// Estratégia:
//   1. Normaliza tudo (lowercase, sem acentos, sem pontuação).
//   2. Tenta casamento exato; se falhar, casamento por substring; se falhar,
//      tenta sequência de N palavras consecutivas pra textos como "Gerar Certidão".
// Confiança mínima de 40 evita falsos positivos em ruído visual.
export function findText(words: OcrWord[], query: string): OcrMatch | null {
  const target = normalize(query);
  if (!target) return null;

  // Single word exact/substring
  const single = words.find(w => normalize(w.text) === target && w.conf >= 40);
  if (single) return wordToMatch(single, single.text);

  const substr = words.find(w => normalize(w.text).includes(target) && w.conf >= 40);
  if (substr) return wordToMatch(substr, substr.text);

  // Multi-word: slide a window of size = number of target tokens.
  const tokens = target.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    for (let i = 0; i <= words.length - tokens.length; i++) {
      const slice = words.slice(i, i + tokens.length);
      const joined = slice.map(w => normalize(w.text)).join(" ");
      if (joined === target && slice.every(w => w.conf >= 30)) {
        return mergeMatch(slice);
      }
    }
    // Fallback: contains (e.g. "Gerar Certidão" within "Gerar Certidão Negativa")
    for (let i = 0; i <= words.length - tokens.length; i++) {
      const slice = words.slice(i, i + tokens.length);
      const joined = slice.map(w => normalize(w.text)).join(" ");
      if (joined.includes(target) && slice.every(w => w.conf >= 30)) {
        return mergeMatch(slice);
      }
    }
  }

  return null;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordToMatch(w: OcrWord, matchedText: string): OcrMatch {
  return {
    x: Math.round(w.left + w.width / 2),
    y: Math.round(w.top + w.height / 2),
    left: w.left,
    top: w.top,
    right: w.left + w.width,
    bottom: w.top + w.height,
    matched_text: matchedText,
    confidence: w.conf,
  };
}

function mergeMatch(slice: OcrWord[]): OcrMatch {
  const left = Math.min(...slice.map(w => w.left));
  const top = Math.min(...slice.map(w => w.top));
  const right = Math.max(...slice.map(w => w.left + w.width));
  const bottom = Math.max(...slice.map(w => w.top + w.height));
  return {
    x: Math.round((left + right) / 2),
    y: Math.round((top + bottom) / 2),
    left, top, right, bottom,
    matched_text: slice.map(w => w.text).join(" "),
    confidence: Math.min(...slice.map(w => w.conf)),
  };
}

function runTesseract(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(TESSERACT_BINARY, args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("error", reject);
    proc.on("close", code => {
      if (code === 0) resolve();
      else reject(new Error(`tesseract exited with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

export async function saveScreenshot(base64Png: string, taskId: string, step: number): Promise<string> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), `cnd-shot-${taskId}-`));
  const file = path.join(tmp, `step-${step}.png`);
  await writeFile(file, Buffer.from(base64Png, "base64"));
  return file;
}
