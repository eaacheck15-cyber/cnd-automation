import type { TestResult, CertificateType } from "../types.js";

export interface TestCertificateInput {
  class_name: string;
  type: CertificateType;
  state?: string;
  php_code: string;
}

// TODO: Implement — write PHP file to GIT_WORKING_DIR, update config/certificates.php,
// run `php artisan issue --class={ClassName}`, parse output for success/failure
// Success: output contains CHECKPOINT without unexpected error or PDF generated
export async function testCertificate(
  _input: TestCertificateInput
): Promise<TestResult> {
  throw new Error("testCertificate: not implemented yet");
}
