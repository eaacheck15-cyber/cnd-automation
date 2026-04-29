import type { PipelineState, PipelineResult, BlockType } from "../types.js";

export interface RetryHint {
  block: BlockType;
  suggestion: string;
}

export interface DecisionOutput {
  final: boolean;
  next_step: "INTERPRETATION" | "DONE" | "FAILED";
  reason: string;
  retry_hints: RetryHint[];
  artisan_context: string;
}

// Hardcoded variations per block — from cnd-engine FASE 4.4
const BLOCK_VARIATIONS: Partial<Record<BlockType, string[]>> = {
  INIT: [
    "Use loadHiddenFieldsFromString($response->body) instead of loadHiddenFields($response) — required for gzip-encoded responses",
    "Add Referer header matching the previous page URL before the GET",
    "Add a 1s delay before the GET request",
  ],
  AUTH: [
    "Add $this->http->addNotExceptionStatusCodes([403]) before the POST",
    "Add a 2s delay before posting credentials",
    "Reload the login page before submitting credentials",
  ],
  CONSULTA: [
    "Add header X-Requested-With: XMLHttpRequest",
    "Add header Accept: application/json",
    "Change the Referer header to the previous page URL",
  ],
  DOWNLOAD: [
    "Remove the $json->success check before calling downloadPDF()",
    "Use GET instead of POST for the download request",
    "Move parameters to query string instead of request body",
  ],
};

export async function decide(state: PipelineState): Promise<DecisionOutput> {
  const test = state.data.test_result;

  if (!test) {
    return {
      final: true,
      next_step: "FAILED",
      reason: "No test result found in pipeline state.",
      retry_hints: [],
      artisan_context: "",
    };
  }

  if (test.success) {
    return {
      final: true,
      next_step: "DONE",
      reason: "Test passed successfully.",
      retry_hints: [],
      artisan_context: test.artisan_output,
    };
  }

  if (state.attempt >= state.max_attempts) {
    return {
      final: true,
      next_step: "FAILED",
      reason: `Max attempts (${state.max_attempts}) reached. Last errors: ${test.errors.join("; ")}`,
      retry_hints: [],
      artisan_context: test.artisan_output,
    };
  }

  const hints = buildRetryHints(test.artisan_output, state.attempt);

  return {
    final: false,
    next_step: "INTERPRETATION",
    reason: `Attempt ${state.attempt + 1}/${state.max_attempts} failed. Retrying from INTERPRETATION with feedback.`,
    retry_hints: hints,
    artisan_context: test.artisan_output,
  };
}

function buildRetryHints(artisanOutput: string, attempt: number): RetryHint[] {
  const out    = artisanOutput.toLowerCase();
  const hints: RetryHint[] = [];

  const matchBlock = (patterns: RegExp, block: BlockType) => {
    if (patterns.test(out)) {
      const variations = BLOCK_VARIATIONS[block] ?? [];
      const suggestion = variations[attempt % variations.length];
      if (suggestion) hints.push({ block, suggestion });
    }
  };

  matchBlock(/viewstate|hidden|csrf|_token|token.*inv[aá]lido/, "INIT");
  matchBlock(/unauthorized|401|403.*forbidden|sess[aã]o.*expir|login|redirect.*login/, "AUTH");
  matchBlock(/n[aã]o.*encontrado|cnpj|cpf|contribuinte|inscri[cç][aã]o/, "CONSULTA");
  matchBlock(/pdf|download|certid(ao|ão)|bytes|content.*pdf/, "DOWNLOAD");

  // Fallback when no specific block is identified
  if (hints.length === 0) {
    const fallbackOrder: BlockType[] = ["INIT", "CONSULTA", "DOWNLOAD"];
    const block      = fallbackOrder[attempt % fallbackOrder.length]!;
    const variations = BLOCK_VARIATIONS[block] ?? [];
    const suggestion = variations[0];
    if (suggestion) hints.push({ block, suggestion });
  }

  return hints;
}

export function buildResult(state: PipelineState): PipelineResult {
  return {
    status:   state.step === "DONE" ? "success" : "failed",
    attempts: state.attempt,
    summary:  state.logs.at(-1) ?? "",
    code:     state.data.code,
    flow:     state.data.flow,
    logs:     state.logs,
  };
}
