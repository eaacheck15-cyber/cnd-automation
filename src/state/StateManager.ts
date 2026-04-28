import fs from "fs";
import path from "path";
import { STATE_DIR } from "../config.js";
import type { PipelineState, CertificateType } from "../types.js";

export class StateManager {
  private statePath(taskId: string): string {
    return path.join(STATE_DIR, `${taskId}.json`);
  }

  private ensureDir(): void {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
  }

  create(
    taskId: string,
    className: string,
    type: CertificateType,
    state?: string
  ): PipelineState {
    const now = new Date().toISOString();
    return {
      task_id: taskId,
      class_name: className,
      type,
      state,
      step: "DISCOVERY",
      attempt: 0,
      max_attempts: 3,
      data: {
        task: null,
        plan: null,
        har_path: null,
        flow: null,
        interpretation: null,
        code: null,
        test_result: null,
      },
      logs: [],
      created_at: now,
      updated_at: now,
    };
  }

  load(taskId: string): PipelineState | null {
    const filePath = this.statePath(taskId);
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as PipelineState;
  }

  save(state: PipelineState): void {
    this.ensureDir();
    state.updated_at = new Date().toISOString();
    fs.writeFileSync(this.statePath(state.task_id), JSON.stringify(state, null, 2));
  }

  log(state: PipelineState, message: string): void {
    const entry = `[${new Date().toISOString()}] ${message}`;
    state.logs.push(entry);
    this.save(state);
  }

  getLatest(): PipelineState | null {
    if (!fs.existsSync(STATE_DIR)) return null;
    const files = fs.readdirSync(STATE_DIR).filter((f) => f.endsWith(".json"));
    if (files.length === 0) return null;
    const latest = files
      .map((f) => ({
        file: f,
        mtime: fs.statSync(path.join(STATE_DIR, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)[0];
    return this.load(path.basename(latest.file, ".json"));
  }
}
