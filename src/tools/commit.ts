import { execSync } from "child_process";
import path from "path";
import type { CommitResult, CertificateType } from "../types.js";
import { GIT_WORKING_DIR, GIT_BRANCH, PHP_BINARY, DOCKER_CONTAINER } from "../config.js";

export interface CommitInput {
  task_id: string;
  task_subject: string;
  class_name: string;
  type: CertificateType;
  state?: string;
}

export async function commitResult(input: CommitInput): Promise<CommitResult> {
  const { task_id, task_subject, class_name, type, state } = input;

  const certPath   = getCertPath(type, state, class_name);
  const configPath = "config/certificates.php";
  const memoryPath = path.join(".claude", "blocks", "CND_BLOCKS_MEMORY.json");
  const message    = `#${task_id} - ${task_subject}`;

  const exec = (cmd: string) =>
    execSync(cmd, { cwd: GIT_WORKING_DIR, stdio: "pipe", encoding: "utf-8" });

  const currentBranch = exec("git rev-parse --abbrev-ref HEAD").trim();
  if (currentBranch !== GIT_BRANCH) {
    exec(`git checkout ${GIT_BRANCH}`);
  }

  exec(`git add "${certPath}" "${configPath}" "${memoryPath}"`);
  exec(`git commit -m "${message}"`);
  exec(`git push origin ${GIT_BRANCH}`);

  const hash = exec("git rev-parse --short HEAD").trim();

  // FASE 8 do cnd-engine: atualizar lista de classes após commit
  const updateCmd = DOCKER_CONTAINER
    ? `docker exec ${DOCKER_CONTAINER} php -d memory_limit=512M artisan update-class-list`
    : `${PHP_BINARY} artisan update-class-list`;
  exec(updateCmd);

  return { committed: true, commit_hash: hash, message };
}

function getCertPath(type: CertificateType, state: string | undefined, className: string): string {
  switch (type) {
    case "Federal":
      return path.join("app", "Certificates", "Federal", `${className}.php`);
    case "State":
      return path.join("app", "Certificates", "State", `${className}.php`);
    case "Municipal":
      if (!state) throw new Error("State abbreviation required for Municipal certificates");
      return path.join("app", "Certificates", "Municipal", state, `${className}.php`);
  }
}
