import type { FlowStep } from "../types.js";

export interface ExtractHarInput {
  har_path: string;
}

// TODO: Implement — filter HAR keeping only document/xhr/fetch, remove images/scripts/analytics/third-party
// Port of the logic from .claude/tools/har-filter.html
export async function extractHar(_input: ExtractHarInput): Promise<FlowStep[]> {
  throw new Error("extractHar: not implemented yet");
}
