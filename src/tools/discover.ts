import type { TaskPlan, Complexity } from "../types.js";

export interface DiscoverInput {
  task_id: string;
  task_description: string;
}

export async function discover(input: DiscoverInput): Promise<TaskPlan> {
  const desc = input.task_description;

  const urlMatch =
    desc.match(/URL\s+Site:\s*(https?:\/\/[^\s\r\n]+)/i) ??
    desc.match(/^URL:\s*(https?:\/\/[^\s\r\n]+)/im);
  const url = urlMatch?.[1]?.trim() ?? "";

  // Extract CNPJ/CPF digits (remove formatting)
  const seen = new Set<string>();
  const inputs: string[] = [];
  for (const m of desc.matchAll(/(?:CNPJ|CPF)[:\s]+([\d.\-\/]+)/gi)) {
    const digits = m[1].replace(/[.\-\/]/g, "");
    if (digits.length >= 11 && !seen.has(digits)) {
      seen.add(digits);
      inputs.push(digits);
    }
  }

  // Extract step-by-step flow (lines starting with ">")
  const expected_flow = desc
    .split(/\r?\n/)
    .filter(l => /^\s*>/.test(l))
    .map(l => l.trim().replace(/^>\s*/, ""))
    .filter(Boolean);

  const lower = desc.toLowerCase();
  let complexity: Complexity = "low";
  if (lower.includes("captcha")) complexity = "high";
  else if (lower.includes("login") || lower.includes("senha") || lower.includes("certificado digital")) complexity = "medium";

  return { url, inputs, expected_flow, complexity };
}
