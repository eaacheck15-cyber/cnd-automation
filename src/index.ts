import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { discover } from "./tools/discover.js";
import { browserCapture } from "./tools/browser.js";
import { browserCaptureAhk } from "./tools/browser_ahk.js";
import { extractHar } from "./tools/extract.js";
import { interpretFlow } from "./tools/interpret.js";
import { generateCode } from "./tools/generate.js";
import { testCertificate } from "./tools/test.js";
import { commitResult } from "./tools/commit.js";
import { getRedmineTasks, getNextTask, updateRedmineIssue } from "./tools/redmine.js";
import { notifyGoogleChat } from "./tools/notify.js";
import { REDMINE_STATUS_EM_DESENV, REDMINE_STATUS_AG_REVIEW, REDMINE_STATUS_AG_DESENV, REDMINE_FAILURE_ASSIGNEE_ID } from "./config.js";

const server = new McpServer({
  name: "mcp-cnd-pipeline",
  version: "1.0.0",
});

const CertificateTypeSchema = z.enum(["Federal", "State", "Municipal"]);

const FlowStepSchema = z.object({
  step:       z.number(),
  method:     z.string(),
  url:        z.string(),
  query:      z.string().nullable(),
  headers:    z.record(z.string()),
  cookies:    z.record(z.string()),
  payload:    z.string().nullable(),
  status:     z.number().nullable(),
});

// ─── Tool: pipeline_discover ─────────────────────────────────────────────────

server.tool(
  "pipeline_discover",
  "Analyze the task description to extract: main URL, required inputs (CNPJ/CPF, additional fields), expected HTTP flow, and complexity level.",
  {
    task_id: z.string(),
    task_description: z.string(),
  },
  async (input) => {
    try {
      const result = await discover(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 3: pipeline_browser_capture ────────────────────────────────────────

const NavStepSchema = z.object({
  action:     z.enum([
    "goto", "fill", "click", "wait", "select",
    "frame_fill", "frame_click",
    "click_text", "fill_field", "select_text",
  ]),
  url:        z.string().optional().describe("URL to navigate to (goto)"),
  selector:   z.string().optional().describe("CSS/Playwright selector (fill, click, select, frame_*)"),
  value:      z.string().optional().describe("Value to fill/select (fill, select, frame_fill, fill_field, select_text)"),
  ms:         z.number().optional().describe("Milliseconds to wait (wait)"),
  frame_url:  z.string().optional().describe("URL substring used to locate the iframe for frame_fill/frame_click (e.g. 'recaptcha/api2/anchor', '/iframe/municipal')"),
  page_index: z.number().optional().describe("Target page: 0 (default) for the main tab, 1+ for popups opened via window.open / target=_blank — populated in order of appearance"),
  text:       z.string().optional().describe("Visible button/link text for click_text — maps directly to the wording in 'Instrução Emissão No site' (e.g. 'Buscar', 'Certidão municipal', 'PDF')"),
  label:      z.string().optional().describe("Visible field label for fill_field/select_text (e.g. 'CNPJ', 'Natureza da certidão')"),
});

server.tool(
  "pipeline_browser_capture",
  "Open Playwright browser, execute the certificate issuance flow, and capture a full HAR file to WORK_DIR/har/{task_id}.har. The HAR is recorded with mode='full' and content='embed' so HTML/JSON/PDF response bodies arrive inline (required by the CND PHP code that parses them via loadHiddenFieldsFromString). Supports iframes (frame_fill/frame_click + frame_url) and popups/new tabs (page_index — 0=main, 1+=window.open). When the portal returns a PDF (Content-Type pdf/octet-stream or Content-Disposition attachment), it is saved to WORK_DIR/har/{task_id}.pdf and returned as pdf_path. On failure the error message includes the failed step index. PREFER text-based actions (click_text/fill_field/select_text) which take the visible button or label wording — these map directly to the lines under 'Instrução Emissão No site' in the task description and don't require HTML inspection. Use selector-based actions (click/fill/select) only as fallback for elements without distinctive text or for iframes (frame_*).",
  {
    task_id:       z.string(),
    url:           z.string().describe("Main URL (used only when nav_steps is empty as fallback entry point)"),
    inputs:        z.array(z.string()).describe("Input values (CNPJ, carnê, etc.) — used in fallback mode"),
    expected_flow: z.array(z.string()).describe("Human-readable step descriptions for context"),
    nav_steps:     z.array(NavStepSchema).optional().describe("Precise navigation steps computed by Claude after HTML analysis. Provide this to drive the browser exactly as the portal requires."),
  },
  async (input) => {
    try {
      const result = await browserCapture(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool: pipeline_browser_capture_ahk (fallback) ───────────────────────────

server.tool(
  "pipeline_browser_capture_ahk",
  "FALLBACK só usado quando pipeline_browser_capture falhou 2 vezes (ex.: portal protegido por Cloudflare challenge interativo ou SPA Flutter Web renderizada em canvas, sem DOM acessível ao Playwright). Sobe um Chrome real via CDP, dispara cliques/digitação reais via AutoHotkey usando OCR (Tesseract) para localizar texto na tela, e grava o HAR a partir dos eventos Network do CDP. Mesma assinatura do pipeline_browser_capture, mas só suporta nav_steps baseados em texto visível: goto, wait, click_text, fill_field, select_text. Actions selector-based (fill/click/select/frame_*) são rejeitadas. Quando o Playwright falhou por challenge interativo, repasse o objeto `diagnostics` retornado por ele em `playwright_diagnostics` — usaremos para esperar dinamicamente o challenge cair antes do primeiro clique (sem isso, o default já espera 15s).",
  {
    task_id:       z.string(),
    url:           z.string(),
    inputs:        z.array(z.string()),
    expected_flow: z.array(z.string()),
    nav_steps:     z.array(NavStepSchema).optional(),
    playwright_diagnostics: z.object({
      page_title:  z.string().optional(),
      dom_snippet: z.string().optional(),
    }).optional().describe("Repasse o objeto `diagnostics` retornado por pipeline_browser_capture quando ele falhou — usamos page_title/dom_snippet pra detectar se a falha foi por Cloudflare e estender o tempo de espera do challenge de 15s pra 45s."),
  },
  async (input) => {
    try {
      const result = await browserCaptureAhk(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 4: pipeline_extract_har ────────────────────────────────────────────

server.tool(
  "pipeline_extract_har",
  "Filter a HAR file keeping only document/xhr/fetch requests. Removes images, scripts, analytics and third-party domains. Returns a clean chronological flow array.",
  {
    har_path: z.string().describe("Absolute path to the .har file"),
  },
  async (input) => {
    try {
      const result = await extractHar(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 5: pipeline_interpret_flow ─────────────────────────────────────────

server.tool(
  "pipeline_interpret_flow",
  "Classify each HTTP step as INIT/AUTH/CONSULTA/EMISSAO/POLLING/DOWNLOAD/VALIDACAO and detect the global flow type (DIRETO/LOGIN_FORM/LOGIN_CERT/PROTOCOLO/CAPTCHA/HIBRIDO). On retry, pass artisan_feedback to adjust classification.",
  {
    flow:             z.array(FlowStepSchema).describe("Clean flow from pipeline_extract_har"),
    artisan_feedback: z.string().optional().describe("Artisan output from previous failed test — used to refine classification on retry"),
  },
  async (input) => {
    try {
      const result = await interpretFlow(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 6: pipeline_generate_code ──────────────────────────────────────────

server.tool(
  "pipeline_generate_code",
  "Collects context for PHP class generation: reads similar certificate examples from the CND project, detects the recommended base class from the HTTP flow, and loads CND_BLOCKS_MEMORY patterns. After receiving the result YOU (Claude) must write the PHP class following the instructions field, then call pipeline_test with the generated php_code.",
  {
    interpretation: z.array(z.object({
      type: z.enum(["INIT", "AUTH", "CONSULTA", "EMISSAO", "POLLING", "DOWNLOAD", "VALIDACAO"]),
      step: FlowStepSchema,
    })),
    task_description: z.string(),
    class_name: z.string(),
    type: CertificateTypeSchema,
    state: z.string().optional(),
  },
  async (input) => {
    try {
      const result = await generateCode(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 7: pipeline_test ───────────────────────────────────────────────────

server.tool(
  "pipeline_test",
  "Write the generated PHP class to the CND project, update config/certificates.php, run `php artisan issue --class=X`, and return parsed success/failure with full artisan output.",
  {
    class_name: z.string(),
    type: CertificateTypeSchema,
    state: z.string().optional(),
    php_code: z.string().describe("Full PHP class source code"),
    cnpj: z.string().describe("CNPJ to insert in MongoDB listaespera before running artisan"),
    nome: z.string().optional().describe("Company name for the test record (default: EMPRESA TESTE)"),
  },
  async (input) => {
    try {
      const result = await testCertificate(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 8: pipeline_commit ─────────────────────────────────────────────────

server.tool(
  "pipeline_commit",
  "After a successful test, git add + git commit the generated PHP file, updated config/certificates.php, and updated CND_BLOCKS_MEMORY.json. Commit message: '#{task_id} - {task_subject}'.",
  {
    task_id: z.string(),
    task_subject: z.string().describe("Full Redmine task subject — used as the commit message body after the task ID"),
    class_name: z.string(),
    type: CertificateTypeSchema,
    state: z.string().optional(),
  },
  async (input) => {
    try {
      const result = await commitResult(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool: redmine_get_tasks ─────────────────────────────────────────────────

server.tool(
  "redmine_get_tasks",
  "Fetch issues from Redmine API. Filters by project, status and assignee. Returns id, subject, description, status and priority.",
  {
    project_id:     z.string().optional().describe("Project ID (default: env REDMINE_PROJECT_ID)"),
    status_id:      z.string().optional().describe("Status filter: 'open', 'closed', '*' or a numeric ID"),
    assigned_to_id: z.string().optional().describe("Filter by assignee ID. Use 'me' for the current user."),
    offset:         z.number().optional().describe("Pagination offset (default: 0)"),
    limit:          z.number().optional().describe("Max results (default: 100)"),
  },
  async (input) => {
    try {
      const result = await getRedmineTasks(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 11: redmine_next_task ───────────────────────────────────────────────

server.tool(
  "redmine_next_task",
  "Return the next pending task from the local queue. If the queue is missing, exhausted, or older than 24h, automatically refreshes from the Redmine API before returning. Field auto_refreshed=true indicates a refresh happened.",
  {},
  async () => {
    try {
      const result = await getNextTask();
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 12: redmine_update_task ────────────────────────────────────────────

server.tool(
  "redmine_update_task",
  `Update a Redmine issue status, reassign it, and/or add a journal note. Use the predefined status constants:
- Em Desenvolvimento (${REDMINE_STATUS_EM_DESENV}): when starting work on a task
- Ag. Review (${REDMINE_STATUS_AG_REVIEW}): when pipeline succeeds
- Ag. Desenv. (${REDMINE_STATUS_AG_DESENV}): when pipeline fails

When the pipeline fails, also set assigned_to_id to ${REDMINE_FAILURE_ASSIGNEE_ID || "<REDMINE_FAILURE_ASSIGNEE_ID not configured>"} (Analista de Negocio Web/Imobiliario).`,
  {
    issue_id: z.number().describe("Redmine issue ID"),
    status_id: z.string().optional().describe(`Status ID to set. Use: ${REDMINE_STATUS_EM_DESENV} (Em Desenv.), ${REDMINE_STATUS_AG_REVIEW} (Ag. Review), ${REDMINE_STATUS_AG_DESENV} (Ag. Desenv.)`),
    notes: z.string().optional().describe("Journal note to add to the issue history"),
    assigned_to_id: z.string().optional().describe(`Numeric ID of the user/group to assign the issue to. Use ${REDMINE_FAILURE_ASSIGNEE_ID || "REDMINE_FAILURE_ASSIGNEE_ID"} when the pipeline fails (Analista de Negocio Web/Imobiliario).`),
  },
  async (input) => {
    try {
      await updateRedmineIssue(input);
      return { content: [{ type: "text", text: "Issue updated successfully." }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 13: notify_google_chat ─────────────────────────────────────────────

server.tool(
  "notify_google_chat",
  `Envia um card no Google Chat informando o resultado de uma tarefa do /auto.

Webhook lido de GOOGLE_CHAT_WEBHOOK_URL; se vazio, retorna {sent:false} sem erro.

Layout do card (titulo fixo "CND #<task_id> — <class_name>"):
- SUCESSO 🟢: Tipo, Esfera, Inicio, Duracao
- ERRO 🔴: Tipo, Motivo, Reatribuido para, Inicio, Duracao`,
  {
    task_id:          z.number().describe("ID numerico da tarefa no Redmine (ex.: 2338858)"),
    class_name:       z.string().describe("Nome da classe PHP (ex.: CertificateCajati)"),
    status:           z.enum(["SUCESSO", "ERRO"]).describe("Resultado da tarefa"),
    inicio:           z.string().describe("Timestamp ISO 8601 do PASSO 2 (ex.: new Date().toISOString())"),
    duracao_segundos: z.number().optional().describe("Duracao em segundos (agora - inicio)"),
    tipo:             z.enum(["NOVA IMPLEMENTAÇÃO", "MANUTENÇÃO"]).optional().describe("Operacao realizada — mostrado em sucesso e falha"),
    esfera:           z.string().optional().describe('Apenas para SUCESSO — ex.: "Federal", "Estadual SP", "Municipal SP"'),
    motivo:           z.string().optional().describe("Apenas para ERRO — descricao humana do motivo da falha"),
    reatribuido_para: z.string().optional().describe('Apenas para ERRO — grupo destino (default: "Analista de Negocio Web/Imobiliario")'),
  },
  async (input) => {
    try {
      const result = await notifyGoogleChat(input);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Start server ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
