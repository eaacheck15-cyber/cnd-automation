import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
config({ path: path.join(__dirname, "..", ".env"), override: true });

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

export const BROWSER_HEADLESS = optional("BROWSER_HEADLESS", "false") === "true";

// Docker: when set, artisan commands run inside the container instead of host PHP
export const DOCKER_CONTAINER = optional("DOCKER_CONTAINER", "");
export const DOCKER_WORKING_DIR = optional("DOCKER_WORKING_DIR", "/var/www/html");

export const REDMINE_URL = optional("REDMINE_URL", "https://redmine.questor.com.br");
export const REDMINE_API_KEY = required("REDMINE_API_KEY");
export const REDMINE_PROJECT_ID = optional("REDMINE_PROJECT_ID", "1106");
export const REDMINE_ASSIGNED_TO_NAME = optional(
  "REDMINE_ASSIGNED_TO_NAME",
  "Questor Sistemas - Desenvolvimento Web"
);
export const REDMINE_ASSIGNED_TO_ID = optional("REDMINE_ASSIGNED_TO_ID", "");
// Grupo destino quando o /auto falha (Analista de Negocio Web/Imobiliario).
export const REDMINE_FAILURE_ASSIGNEE_ID = optional("REDMINE_FAILURE_ASSIGNEE_ID", "");

// Webhook do Google Chat para notificacoes do /auto (sucesso/falha).
export const GOOGLE_CHAT_WEBHOOK_URL = optional("GOOGLE_CHAT_WEBHOOK_URL", "");
export const REDMINE_STATUS_EM_DESENV = optional("REDMINE_STATUS_EM_DESENV", "57");
export const REDMINE_STATUS_AG_REVIEW = optional("REDMINE_STATUS_AG_REVIEW", "84");
export const REDMINE_STATUS_AG_DESENV = optional("REDMINE_STATUS_AG_DESENV", "56");

export const MONGO_CONTAINER = optional("MONGO_CONTAINER", "configs-development-mongodb-1");
export const MONGO_DB = optional("MONGO_DB", "questorservercnd");

export const BLOCKS_MEMORY_PATH = path.join(
  GIT_WORKING_DIR,
  ".claude",
  "blocks",
  "CND_BLOCKS_MEMORY.json"
);

export const HAR_DIR = path.join(WORK_DIR, "har");
export const TASK_QUEUE_PATH = path.join(WORK_DIR, "state", "task_queue.json");
