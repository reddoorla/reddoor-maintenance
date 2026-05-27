// Implementation in Task 4.2. Stub keeps the CLI dynamic import resolvable at typecheck time.
export async function sendApprovedReports(): Promise<{ output: string; code: number }> {
  throw Object.assign(new Error("sendApprovedReports not yet implemented (Task 4.2)"), {
    exitCode: 2,
  });
}
