import type { TaskPlan } from "../types.js";

export interface DiscoverInput {
  task_id: string;
  task_description: string;
}

// TODO: Implement — analyze task description to extract URL, inputs, expected flow and complexity
export async function discover(_input: DiscoverInput): Promise<TaskPlan> {
  throw new Error("discover: not implemented yet");
}
