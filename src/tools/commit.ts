import type { CommitResult, CertificateType } from "../types.js";

export interface CommitInput {
  task_id: string;
  class_name: string;
  type: CertificateType;
  state?: string;
}

// TODO: Implement — git add + git commit the generated files on success
// Files: app/Certificates/{type}/{ClassName}.php, config/certificates.php,
//        .claude/blocks/CND_BLOCKS_MEMORY.json
// Commit message: "#{task_id} - Implementa {ClassName}"
export async function commitResult(_input: CommitInput): Promise<CommitResult> {
  throw new Error("commitResult: not implemented yet");
}
