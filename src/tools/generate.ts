import { readFile, readdir } from "fs/promises";
import path from "path";
import type { InterpretedStep, GenerationResult, CertificateType } from "../types.js";
import { GIT_WORKING_DIR, BLOCKS_MEMORY_PATH } from "../config.js";

export interface GenerateCodeInput {
  interpretation: InterpretedStep[];
  task_description: string;
  class_name: string;
  type: CertificateType;
  state?: string;
}

// Gather context so Claude can generate the PHP class itself.
// Returns: recommended base class, namespace, similar example classes, blocks memory.
export async function generateCode(input: GenerateCodeInput): Promise<GenerationResult> {
  const { interpretation, class_name, type, state } = input;

  const base_class = detectBaseClass(interpretation);
  const namespace = buildNamespace(type, state);
  const examples = await readExamples(type, state);
  const blocks_memory = (await safeRead(BLOCKS_MEMORY_PATH)).slice(0, 3000);

  const flowSummary = interpretation
    .map(s => `  ${s.type}: ${s.step.method} ${s.step.url}`)
    .join("\n");

  const instructions = [
    `Generate a PHP class named "${class_name}" in namespace "${namespace}".`,
    `Extend "${base_class}" (from App\\Certificates\\Bases\\).`,
    `The HTTP flow was classified as:\n${flowSummary}`,
    `Apply the validation rules from the task description inside processIssuance().`,
    `Use the example classes below as structural reference.`,
    `Member order inside the class (top to bottom, ALWAYS): 1) URLs ($url* properties), 2) Headers (requestHeaders*() methods), 3) Payloads (getParams*() methods), 4) General functions (startIssuance, private step methods, helpers like loadHiddenFields/fixHtml, processIssuance last). Never let the URLs/header block end up below the methods.`,
    `After generating the code, call pipeline_test with the resulting php_code.`,
  ].join("\n");

  return { base_class, namespace, examples, blocks_memory, instructions };
}

function detectBaseClass(interpretation: InterpretedStep[]): string {
  const urls = interpretation.map(s => s.step.url.toLowerCase());
  if (urls.some(u => u.includes("betha.com.br")))       return "CertificateBethaCND";
  if (urls.some(u => u.includes("fiorilli")))           return "CertificateFiorilli";
  if (urls.some(u => u.includes("/gpi") || u.match(/gpi\.\w+\.gov\.br/))) return "CertificateGpi";
  if (urls.some(u => u.includes("governa")))            return "CertificateGoverna";
  if (urls.some(u => u.includes("atendenet")))          return "CertificateAtendeNet";
  if (urls.some(u => u.includes("abaco")))              return "CertificateAbaco";
  if (urls.some(u => u.includes("prefweb")))            return "CertificatePrefWeb";
  return "CertificateBase";
}

function buildNamespace(type: CertificateType, state?: string): string {
  if (type === "Municipal" && state) return `App\\Certificates\\Municipal\\${state}`;
  if (type === "State")             return `App\\Certificates\\State`;
  return `App\\Certificates\\Federal`;
}

async function readExamples(type: CertificateType, state?: string): Promise<string[]> {
  const examples: string[] = [];
  try {
    const dir =
      type === "Municipal" && state
        ? path.join(GIT_WORKING_DIR, "app", "Certificates", "Municipal", state)
        : type === "State"
        ? path.join(GIT_WORKING_DIR, "app", "Certificates", "State")
        : path.join(GIT_WORKING_DIR, "app", "Certificates", "Federal");

    const files = await readdir(dir);
    let count = 0;
    for (const file of files) {
      if (!file.endsWith(".php") || count >= 3) break;
      const content = await safeRead(path.join(dir, file));
      if (content && content.length < 3000) {
        examples.push(`// --- ${file} ---\n${content}`);
        count++;
      }
    }
  } catch { /* directory not accessible */ }
  return examples;
}

async function safeRead(filePath: string): Promise<string> {
  try { return await readFile(filePath, "utf-8"); }
  catch { return ""; }
}
