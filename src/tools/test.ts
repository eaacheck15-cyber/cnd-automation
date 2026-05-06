import { execSync } from "child_process";
import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";
import type { TestResult, CertificateType } from "../types.js";
import { GIT_WORKING_DIR, PHP_BINARY, DOCKER_CONTAINER, DOCKER_WORKING_DIR } from "../config.js";

export interface TestCertificateInput {
  class_name: string;
  type: CertificateType;
  state?: string;
  php_code: string;
}

function artisanExec(artisanArgs: string): string {
  if (DOCKER_CONTAINER) {
    return `docker exec ${DOCKER_CONTAINER} php -d memory_limit=512M artisan ${artisanArgs}`;
  }
  return `"${PHP_BINARY}" artisan ${artisanArgs}`;
}

function phpLintCmd(filePath: string): string {
  if (DOCKER_CONTAINER) {
    // Map host path to container path
    const containerPath = filePath
      .replace(GIT_WORKING_DIR, DOCKER_WORKING_DIR)
      .replace(/\\/g, '/');
    return `docker exec ${DOCKER_CONTAINER} php -l "${containerPath}"`;
  }
  return `"${PHP_BINARY}" -l "${filePath}"`;
}

export async function testCertificate(input: TestCertificateInput): Promise<TestResult> {
  const { class_name, type, state, php_code } = input;

  // 1. Write PHP file
  const rel = getCertPath(type, state, class_name);
  const full = path.join(GIT_WORKING_DIR, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, php_code, "utf-8");

  // 2. PHP syntax check
  try {
    execSync(phpLintCmd(full), {
      cwd: GIT_WORKING_DIR,
      encoding: "utf-8",
      timeout: 15000,
    });
  } catch (err: any) {
    return {
      success: false,
      errors: [`PHP syntax error: ${(err.stdout ?? err.message ?? "").trim()}`],
      artisan_output: "",
    };
  }

  // 3. Register in config/certificates.php
  const configErrors: string[] = [];
  try {
    await registerCertificate(class_name, type, state);
  } catch (err: any) {
    configErrors.push(`config/certificates.php: ${(err as Error).message}`);
  }

  // 4. Run artisan issue inside Docker (PHP 7.3) or host
  let artisan_output = "";
  try {
    artisan_output = execSync(
      artisanExec(`issue --class=${class_name}`),
      { cwd: GIT_WORKING_DIR, encoding: "utf-8", timeout: 120000 }
    );
  } catch (err: any) {
    artisan_output = (err.stdout ?? "") + "\n" + (err.stderr ?? "");
    configErrors.push("artisan issue exited with error — see artisan_output");
  }

  const lower = artisan_output.toLowerCase();
  const hasSuccess =
    lower.includes("checkpoint") ||
    lower.includes("emitida") ||
    lower.includes("success") ||
    lower.includes("certidão gerada") ||
    lower.includes("concluída");
  const hasError =
    lower.includes("exception") ||
    lower.includes("fatal error") ||
    lower.includes("undefined");

  const success = configErrors.length === 0 && (hasSuccess || (!hasError && artisan_output.trim() !== ""));

  return { success, errors: configErrors, artisan_output };
}

async function registerCertificate(
  class_name: string,
  type: CertificateType,
  state?: string
): Promise<void> {
  const config_path = path.join(GIT_WORKING_DIR, "config", "certificates.php");
  let content = await readFile(config_path, "utf-8");

  if (content.includes(`'${class_name}'`)) return;

  const entry = buildConfigEntry(class_name, type, state);

  const closeIdx = content.lastIndexOf("];");
  if (closeIdx === -1) throw new Error("Could not locate ]; in certificates.php");

  content = content.slice(0, closeIdx) + `    ${entry}\n` + content.slice(closeIdx);
  await writeFile(config_path, content, "utf-8");
}

function buildConfigEntry(class_name: string, type: CertificateType, state?: string): string {
  if (type === "Federal") return `'${class_name}' => Federal\\${class_name}::class,`;
  if (type === "State")   return `'${class_name}' => State\\${class_name}::class,`;
  if (!state) throw new Error("State abbreviation required for Municipal certificates");
  return `'${class_name}' => Municipal\\${state}\\${class_name}::class,`;
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
