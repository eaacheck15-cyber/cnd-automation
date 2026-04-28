import type { PipelineRunInput, PipelineResult } from "../types.js";

// TODO: Implement — full orchestrator: DISCOVERY → BROWSER → EXTRACTION → INTERPRETATION → GENERATION → TEST → DECISION
// Uses StateManager to persist state at each step
// Respects max_attempts (3) with retry from INTERPRETATION on failure
// Calls commitResult on success, does NOT commit on failure
export async function runPipeline(
  _input: PipelineRunInput
): Promise<PipelineResult> {
  throw new Error("runPipeline: not implemented yet");
}
