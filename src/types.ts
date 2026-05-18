export type CertificateType = "Federal" | "State" | "Municipal";

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
  action:
    | "goto"
    | "fill"
    | "click"
    | "wait"
    | "select"
    | "frame_fill"
    | "frame_click"
    | "click_text"
    | "fill_field"
    | "select_text";
  url?: string;        // goto
  selector?: string;   // fill, click, select, frame_*
  value?: string;      // fill, select, fill_field, select_text
  ms?: number;         // wait
  frame_url?: string;  // substring/regex para localizar frame quando action=frame_*
  page_index?: number; // 0 = aba principal (default), 1+ = popup detectado por context.on('page')
  text?: string;       // texto visível do botão/link (click_text)
  label?: string;      // rótulo visível do campo (fill_field, select_text)
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

