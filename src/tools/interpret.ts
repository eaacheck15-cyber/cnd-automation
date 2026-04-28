import type { FlowStep, InterpretedStep } from "../types.js";

export interface InterpretFlowInput {
  flow: FlowStep[];
}

// TODO: Implement — classify each FlowStep as INIT/AUTH/CONSULTA/EMISSAO/POLLING/DOWNLOAD
// Rules: initial GET → INIT, sso.acesso.gov.br or usuario/senha POST → AUTH,
// CNPJ/CPF POST → CONSULTA, protocol-returning POST → EMISSAO,
// repeated URL → POLLING, application/pdf response → DOWNLOAD
export async function interpretFlow(
  _input: InterpretFlowInput
): Promise<InterpretedStep[]> {
  throw new Error("interpretFlow: not implemented yet");
}
