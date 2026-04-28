import type { PipelineState, PipelineResult } from "../types.js";

export interface DecisionOutput {
  final: boolean;
  reason: string;
  next_step?: "INTERPRETATION" | "DONE" | "FAILED";
}

// TODO: Implement — evaluate test result and decide next action
// success → commit and DONE
// failure + attempt < max_attempts → retry from INTERPRETATION with artisan output as feedback
// failure + attempt >= max_attempts → FAILED, do not commit
export async function decide(
  state: PipelineState
): Promise<DecisionOutput> {
  throw new Error("decide: not implemented yet");
}

export function buildResult(state: PipelineState): PipelineResult {
  return {
    status: state.step === "DONE" ? "success" : "failed",
    attempts: state.attempt,
    summary: state.logs.at(-1) ?? "",
    code: state.data.code,
    flow: state.data.flow,
    logs: state.logs,
  };
}
