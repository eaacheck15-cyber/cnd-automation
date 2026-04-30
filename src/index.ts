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
import { getRedmineTasks } from "./tools/redmine.js";

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

server.tool(
  "pipeline_browser_capture",
  "Open Playwright headless browser, execute the certificate issuance flow, and capture a full HAR file to WORK_DIR/har/{task_id}.har.",
  {
    task_id: z.string(),
    url: z.string().describe("Main URL to navigate to"),
    inputs: z.array(z.string()).describe("Input values to fill during navigation"),
    expected_flow: z.array(z.string()).describe("Sequence of steps to perform"),
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
  "Generate a PHP certificate class following CND architecture. Reads CND_BLOCKS_MEMORY.json for pattern reuse. Identifies base class by domain and applies all rules from cnd-engine.md.",
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
  "After a successful test, git add + git commit the generated PHP file, updated config/certificates.php, and updated CND_BLOCKS_MEMORY.json. Commit message: '#{task_id} - Implementa {ClassName}'.",
  {
    task_id: z.string(),
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

// ─── Start server ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
