import type { InterpretedStep, GenerationResult, CertificateType } from "../types.js";

export interface GenerateCodeInput {
  interpretation: InterpretedStep[];
  task_description: string;
  class_name: string;
  type: CertificateType;
  state?: string;
}

// TODO: Implement — generate PHP certificate class following CND architecture
// Reads CND_BLOCKS_MEMORY.json for pattern scoring (same as cnd-engine FASE 3)
// Identifies base class by domain (Betha/Fiorilli/Abaco/CertificateBase)
// Follows all rules from cnd-engine.md sections 5.2, 5.3 and 5.4
export async function generateCode(
  _input: GenerateCodeInput
): Promise<GenerationResult> {
  throw new Error("generateCode: not implemented yet");
}
