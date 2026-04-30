import { REDMINE_URL, REDMINE_API_KEY, REDMINE_PROJECT_ID } from "../config.js";

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

export async function getRedmineTasks(input: {
  project_id?: string;
  status_id?: string;
  assigned_to_id?: string;
  offset?: number;
  limit?: number;
}): Promise<{ issues: RedmineIssue[]; total_count: number }> {
  const params = new URLSearchParams({
    project_id: input.project_id ?? REDMINE_PROJECT_ID,
    offset: String(input.offset ?? 0),
    limit: String(input.limit ?? 100),
  });

  if (input.status_id) params.set("status_id", input.status_id);
  if (input.assigned_to_id) params.set("assigned_to_id", input.assigned_to_id);

  const url = `${REDMINE_URL}/issues.json?${params}`;

  const response = await fetch(url, {
    headers: { "X-Redmine-API-Key": REDMINE_API_KEY },
  });

  if (!response.ok) {
    throw new Error(`Redmine API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as RedmineIssuesResponse;
  return { issues: data.issues, total_count: data.total_count };
}
