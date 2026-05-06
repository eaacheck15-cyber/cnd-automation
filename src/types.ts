export type CertificateType = "Federal" | "State" | "Municipal";

export type PipelineStep =
  | "DISCOVERY"
  | "BROWSER"
  | "EXTRACTION"
  | "INTERPRETATION"
  | "GENERATION"
  | "TEST"
  | "DECISION"
  | "DONE";

export type FlowType =
  | "DIRETO"
  | "LOGIN_FORM"
  | "LOGIN_CERT"
  | "PROTOCOLO"
  | "CAPTCHA"
  | "HIBRIDO";

export type BlockType =
  | "INIT"
  | "AUTH"
  | "CONSULTA"
  | "EMISSAO"
  | "POLLING"
  | "DOWNLOAD"
  | "VALIDACAO";

export type Complexity = "low" | "medium" | "high";

export interface FlowStep {
  step: number;
  method: string;
  url: string;
  query: string | null;
  headers: Record<string, string>;
  cookies: Record<string, string>;
  payload: string | null;
  status: number | null;
}

export interface InterpretedStep {
  type: BlockType;
  step: FlowStep;
}

export interface InterpretFlowOutput {
  flow_type: FlowType;
  steps: InterpretedStep[];
}

export interface NavStep {
  action: "goto" | "fill" | "click" | "wait" | "select";
  url?: string;       // goto
  selector?: string;  // fill, click, select
  value?: string;     // fill, select
  ms?: number;        // wait
}

export interface TaskPlan {
  url: string;
  inputs: string[];
  expected_flow: string[];
  complexity: Complexity;
}

export interface TestResult {
  success: boolean;
  errors: string[];
  artisan_output: string;
}

export interface CommitResult {
  committed: boolean;
  commit_hash: string;
  message: string;
}

export interface GenerationResult {
  base_class: string;
  namespace: string;
  examples: string[];
  blocks_memory: string;
  instructions: string;
}

export interface PipelineData {
  task: TaskPlan | null;
  plan: TaskPlan | null;
  har_path: string | null;
  flow: FlowStep[] | null;
  interpretation: InterpretedStep[] | null;
  code: string | null;
  test_result: TestResult | null;
}

export interface PipelineState {
  task_id: string;
  class_name: string;
  type: CertificateType;
  state?: string;
  step: PipelineStep;
  attempt: number;
  max_attempts: number;
  data: PipelineData;
  logs: string[];
  created_at: string;
  updated_at: string;
}

export interface PipelineResult {
  status: "success" | "failed";
  attempts: number;
  summary: string;
  code: string | null;
  flow: FlowStep[] | null;
  logs: string[];
}

export interface PipelineRunInput {
  task_id: string;
  task_description: string;
  class_name: string;
  type: CertificateType;
  state?: string;
}
