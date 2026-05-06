import { config } from "dotenv";
import path from "path";

config();

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const GIT_WORKING_DIR = required("GIT_WORKING_DIR");
export const GIT_REPO_URL = optional("GIT_REPO_URL", "");
export const GIT_BRANCH = optional("GIT_BRANCH", "develop");
export const GIT_USER_NAME = optional("GIT_USER_NAME", "mcp-cnd-pipeline");
export const GIT_USER_EMAIL = optional("GIT_USER_EMAIL", "mcp@questores.com.br");
export const WORK_DIR = required("WORK_DIR");
export const PHP_BINARY = optional("PHP_BINARY", "php");

// Docker: when set, artisan commands run inside the container instead of host PHP
export const DOCKER_CONTAINER = optional("DOCKER_CONTAINER", "");
export const DOCKER_WORKING_DIR = optional("DOCKER_WORKING_DIR", "/var/www/html");

export const REDMINE_URL = optional("REDMINE_URL", "https://redmine.questor.com.br");
export const REDMINE_API_KEY = required("REDMINE_API_KEY");
export const REDMINE_PROJECT_ID = optional("REDMINE_PROJECT_ID", "1106");
export const REDMINE_STATUS_EM_DESENV = optional("REDMINE_STATUS_EM_DESENV", "57");
export const REDMINE_STATUS_AG_REVIEW = optional("REDMINE_STATUS_AG_REVIEW", "84");
export const REDMINE_STATUS_AG_DESENV = optional("REDMINE_STATUS_AG_DESENV", "56");

export const BLOCKS_MEMORY_PATH = path.join(
  GIT_WORKING_DIR,
  ".claude",
  "blocks",
  "CND_BLOCKS_MEMORY.json"
);

export const STATE_DIR = path.join(WORK_DIR, "state");
export const HAR_DIR = path.join(WORK_DIR, "har");
export const TASK_QUEUE_PATH = path.join(WORK_DIR, "state", "task_queue.json");
