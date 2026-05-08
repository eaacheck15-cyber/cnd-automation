import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { StateManager } from "./state/StateManager.js";
import { runPipeline } from "./tools/pipeline.js";
import { discover } from "./tools/discover.js";
import { browserCapture } from "./tools/browser.js";
import { extractHar } from "./tools/extract.js";
import { interpretFlow } from "./tools/interpret.js";
import { generateCode } from "./tools/generate.js";
import { testCertificate } from "./tools/test.js";
import { commitResult } from "./tools/commit.js";
import { getRedmineTasks, getNextTask, updateRedmineIssue } from "./tools/redmine.js";
import { REDMINE_STATUS_EM_DESENV, REDMINE_STATUS_AG_REVIEW, REDMINE_STATUS_AG_DESENV } from "./config.js";

const stateManager = new StateManager();

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

// ─── Tool 1: pipeline_run ────────────────────────────────────────────────────

server.tool(
  "pipeline_run",
  "Execute the full automation pipeline: DISCOVERY → BROWSER → EXTRACTION → INTERPRETATION → GENERATION → TEST → DECISION. Persists state and retries up to 3 times on failure.",
  {
    task_id: z.string().describe("Redmine task ID or any unique identifier"),
    task_description: z.string().describe("Full task description — URL, certificate type, system details"),
    class_name: z.string().describe("PHP class name to generate (e.g. CertificateFrancoDaRocha)"),
    type: CertificateTypeSchema.describe("Certificate type: Federal, State or Municipal"),
    state: z.string().optional().describe("State abbreviation (required for State and Municipal)"),
  },
  async (input) => {
    try {
      const result = await runPipeline(input);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Tool 2: pipeline_discover ───────────────────────────────────────────────

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
  action:     z.enum(["goto", "fill", "click", "wait", "select", "frame_fill", "frame_click"]),
  url:        z.string().optional().describe("URL to navigate to (goto)"),
  selector:   z.string().optional().describe("CSS/Playwright selector (fill, click, select, frame_*)"),
  value:      z.string().optional().describe("Value to fill or select option (fill, select, frame_fill)"),
  ms:         z.number().optional().describe("Milliseconds to wait (wait)"),
  frame_url:  z.string().optional().describe("URL substring used to locate the iframe for frame_fill/frame_click (e.g. 'recaptcha/api2/anchor', '/iframe/municipal')"),
  page_index: z.number().optional().describe("Target page: 0 (default) for the main tab, 1+ for popups opened via window.open / target=_blank — populated in order of appearance"),
});

server.tool(
  "pipeline_browser_capture",
  "Open Playwright browser, execute the certificate issuance flow, and capture a full HAR file to WORK_DIR/har/{task_id}.har. The HAR is recorded with mode='full' and content='embed' so HTML/JSON/PDF response bodies arrive inline (required by the CND PHP code that parses them via loadHiddenFieldsFromString). Supports iframes (frame_fill/frame_click + frame_url) and popups/new tabs (page_index — 0=main, 1+=window.open). When the portal returns a PDF (Content-Type pdf/octet-stream or Content-Disposition attachment), it is saved to WORK_DIR/har/{task_id}.pdf and returned as pdf_path. On failure the error message includes the failed step index. IMPORTANT: before calling this tool, use WebFetch to load the portal URL and analyze the HTML — identify the exact selectors for input fields and submit buttons. Then build nav_steps with precise actions based on that analysis.",
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

// ─── Tool 9: pipeline_get_state ──────────────────────────────────────────────

server.tool(
  "pipeline_get_state",
  "Return the current pipeline state for a task. Without task_id returns the most recently updated state.",
  {
    task_id: z.string().optional().describe("Task ID to retrieve. Omit to get the latest."),
  },
  async ({ task_id }) => {
    const state = task_id
      ? stateManager.load(task_id)
      : stateManager.getLatest();
    if (!state) {
      return { content: [{ type: "text", text: "No state found." }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(state, null, 2) }] };
  }
);

// ─── Tool 10: redmine_get_tasks ───────────────────────────────────────────────

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
  `Update a Redmine issue status and/or add a journal note. Use the predefined status constants:
- Em Desenvolvimento (${REDMINE_STATUS_EM_DESENV}): when starting work on a task
- Ag. Review (${REDMINE_STATUS_AG_REVIEW}): when pipeline succeeds
- Ag. Desenv. (${REDMINE_STATUS_AG_DESENV}): when pipeline fails`,
  {
    issue_id: z.number().describe("Redmine issue ID"),
    status_id: z.string().optional().describe(`Status ID to set. Use: ${REDMINE_STATUS_EM_DESENV} (Em Desenv.), ${REDMINE_STATUS_AG_REVIEW} (Ag. Review), ${REDMINE_STATUS_AG_DESENV} (Ag. Desenv.)`),
    notes: z.string().optional().describe("Journal note to add to the issue history"),
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

// ─── Start server ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
