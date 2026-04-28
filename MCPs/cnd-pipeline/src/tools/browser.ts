import type { TaskPlan } from "../types.js";

export interface BrowserCaptureInput {
  task_id: string;
  url: string;
  inputs: string[];
  expected_flow: string[];
}

export interface BrowserCaptureOutput {
  har_path: string;
}

// TODO: Implement — open Playwright headless, execute flow, capture HAR to WORK_DIR/har/{task_id}.har
export async function browserCapture(
  _input: BrowserCaptureInput
): Promise<BrowserCaptureOutput> {
  throw new Error("browserCapture: not implemented yet");
}
