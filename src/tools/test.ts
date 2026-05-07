import { execSync, spawnSync } from "child_process";
import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";
import type { TestResult, CertificateType } from "../types.js";
import { GIT_WORKING_DIR, PHP_BINARY, DOCKER_CONTAINER, DOCKER_WORKING_DIR, MONGO_CONTAINER, MONGO_DB } from "../config.js";

export interface TestCertificateInput {
  class_name: string;
  type: CertificateType;
  state?: string;
  php_code: string;
  cnpj: string;
  nome?: string;
}

function artisanExec(artisanArgs: string): string {
  if (DOCKER_CONTAINER) {
    return `docker exec ${DOCKER_CONTAINER} php -d memory_limit=512M artisan ${artisanArgs}`;
  }
  return `"${PHP_BINARY}" artisan ${artisanArgs}`;
}

function phpLintCmd(filePath: string): string {
  if (DOCKER_CONTAINER) {
    const containerPath = filePath
      .replace(GIT_WORKING_DIR, DOCKER_WORKING_DIR)
      .replace(/\\/g, '/');
    return `docker exec ${DOCKER_CONTAINER} php -l "${containerPath}"`;
  }
  return `"${PHP_BINARY}" -l "${filePath}"`;
}

function mongoExec(script: string): string {
  const result = spawnSync(
    "docker",
    ["exec", "-i", MONGO_CONTAINER, "mongosh", MONGO_DB, "--quiet"],
    { input: script, encoding: "utf-8", timeout: 15000 }
  );
  if (result.status !== 0) throw new Error(`mongosh error: ${result.stderr}`);
  return result.stdout.trim();
}

function mongoInsertTestRecord(class_name: string, cnpj: string, nome: string): string {
  const doc = {
    cliente: cnpj,
    classname: class_name,
    category: null,
    empresa: cnpj,
    nome,
    inscfederal: cnpj,
    numtentativas: 0,
    tentativalog: 0,
    captchalog: 0,
    msgErro: null,
    msgSolicitacao: null,
    status: "Aguardando",
    tipocertidao: "0",
    tiposolicitacao: "Manual",
    adicionais: { configuration: [] },
    external: true,
  };
  const script = `
const doc = ${JSON.stringify(doc)};
doc.datainicio = new Date();
const r = db.listaespera.insertOne(doc);
print(r.insertedId.toString());
`;
  return mongoExec(script);
}

function mongoCleanupTestRecord(insertedId: string): void {
  try {
    mongoExec(`db.listaespera.deleteOne({ _id: ObjectId('${insertedId}') });`);
  } catch {
    // best-effort cleanup
  }
}

export async function testCertificate(input: TestCertificateInput): Promise<TestResult> {
  const { class_name, type, state, php_code, cnpj, nome } = input;

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

  // 4. Insert test record into MongoDB so artisan has something to process
  let testRecordId: string | null = null;
  try {
    testRecordId = mongoInsertTestRecord(class_name, cnpj, nome ?? "EMPRESA TESTE");
  } catch (err: any) {
    configErrors.push(`MongoDB insert failed: ${(err as Error).message}`);
  }

  // 5. Run artisan issue inside Docker (PHP 7.3) or host
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

  // 6. Cleanup: if artisan didn't consume the record (failure), remove it
  if (testRecordId) {
    mongoCleanupTestRecord(testRecordId);
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
