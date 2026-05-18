import fs from "fs";
import path from "path";
import {
  REDMINE_URL,
  REDMINE_API_KEY,
  REDMINE_PROJECT_ID,
  REDMINE_ASSIGNED_TO_ID,
  REDMINE_ASSIGNED_TO_NAME,
  TASK_QUEUE_PATH,
} from "../config.js";

function filterByAssignee(issues: RedmineIssue[]): RedmineIssue[] {
  if (!REDMINE_ASSIGNED_TO_NAME) return issues;
  const target = REDMINE_ASSIGNED_TO_NAME.trim().toLowerCase();
  return issues.filter((i) => i.assigned_to?.name?.trim().toLowerCase() === target);
}

export async function updateRedmineIssue(input: {
  issue_id: number;
  status_id?: string;
  notes?: string;
  assigned_to_id?: string;
}): Promise<void> {
  const body: Record<string, unknown> = {};
  if (input.status_id) body.status_id = Number(input.status_id);
  if (input.notes) body.notes = input.notes;
  if (input.assigned_to_id) body.assigned_to_id = Number(input.assigned_to_id);

  const response = await fetch(`${REDMINE_URL}/issues/${input.issue_id}.json`, {
    method: "PUT",
    headers: {
      "X-Redmine-API-Key": REDMINE_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ issue: body }),
  });

  if (!response.ok) {
    throw new Error(`Redmine update error: ${response.status} ${response.statusText}`);
  }
}

export interface RedmineIssue {
  id: number;
  subject: string;
  description: string;
  status: { id: number; name: string };
  assigned_to?: { id: number; name: string };
  priority: { id: number; name: string };
  created_on: string;
  updated_on: string;
}

interface RedmineIssuesResponse {
  issues: RedmineIssue[];
  total_count: number;
  offset: number;
  limit: number;
}

interface TaskQueue {
  fetched_at: string;
  total_count: number;
  cursor: number;
  tasks: RedmineIssue[];
}

const QUEUE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function loadQueue(): TaskQueue | null {
  if (!fs.existsSync(TASK_QUEUE_PATH)) return null;
  return JSON.parse(fs.readFileSync(TASK_QUEUE_PATH, "utf-8")) as TaskQueue;
}

function saveQueue(queue: TaskQueue): void {
  const dir = path.dirname(TASK_QUEUE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TASK_QUEUE_PATH, JSON.stringify(queue, null, 2));
}

function isStale(queue: TaskQueue): boolean {
  return Date.now() - new Date(queue.fetched_at).getTime() > QUEUE_TTL_MS;
}

async function fetchAndSaveQueue(): Promise<TaskQueue> {
  const params = new URLSearchParams({
    project_id: REDMINE_PROJECT_ID,
    offset: "0",
    limit: "100",
  });
  if (REDMINE_ASSIGNED_TO_ID) params.set("assigned_to_id", REDMINE_ASSIGNED_TO_ID);

  const url = `${REDMINE_URL}/issues.json?${params}`;
  const response = await fetch(url, {
    headers: { "X-Redmine-API-Key": REDMINE_API_KEY },
  });

  if (!response.ok) {
    throw new Error(`Redmine API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as RedmineIssuesResponse;
  const filtered = filterByAssignee(data.issues);
  const queue: TaskQueue = {
    fetched_at: new Date().toISOString(),
    total_count: filtered.length,
    cursor: 0,
    tasks: filtered,
  };
  saveQueue(queue);
  return queue;
}

export async function getRedmineTasks(input: {
  project_id?: string;
  status_id?: string;
  assigned_to_id?: string;
  offset?: number;
  limit?: number;
}): Promise<{ issues: RedmineIssue[]; total_count: number; queue_saved: boolean }> {
  const params = new URLSearchParams({
    project_id: input.project_id ?? REDMINE_PROJECT_ID,
    offset: String(input.offset ?? 0),
    limit: String(input.limit ?? 100),
  });

  if (input.status_id) params.set("status_id", input.status_id);
  const assignedToId = input.assigned_to_id ?? REDMINE_ASSIGNED_TO_ID;
  if (assignedToId) params.set("assigned_to_id", assignedToId);

  const url = `${REDMINE_URL}/issues.json?${params}`;
  const response = await fetch(url, {
    headers: { "X-Redmine-API-Key": REDMINE_API_KEY },
  });

  if (!response.ok) {
    throw new Error(`Redmine API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as RedmineIssuesResponse;
  const filtered = filterByAssignee(data.issues);
  const queue: TaskQueue = {
    fetched_at: new Date().toISOString(),
    total_count: filtered.length,
    cursor: 0,
    tasks: filtered,
  };
  saveQueue(queue);

  return { issues: filtered, total_count: filtered.length, queue_saved: true };
}

export async function getNextTask(): Promise<{
  task: RedmineIssue | null;
  remaining: number;
  cursor: number;
  fetched_at: string | null;
  auto_refreshed: boolean;
}> {
  let queue = loadQueue();
  let auto_refreshed = false;

  // Auto-refresh if queue is missing, exhausted, or older than 24h
  if (!queue || queue.cursor >= queue.tasks.length || isStale(queue)) {
    queue = await fetchAndSaveQueue();
    auto_refreshed = true;
  }

  if (queue.tasks.length === 0) {
    return { task: null, remaining: 0, cursor: 0, fetched_at: queue.fetched_at, auto_refreshed };
  }

  const candidate = queue.tasks[queue.cursor];
  queue.cursor += 1;
  saveQueue(queue);
  const remaining = queue.tasks.length - queue.cursor;
  return { task: candidate, remaining, cursor: queue.cursor, fetched_at: queue.fetched_at, auto_refreshed };
}
