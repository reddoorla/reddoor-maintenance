import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WORKFLOW = fileURLToPath(
  new URL("../../.claude/workflows/model-bakeoff.workflow.js", import.meta.url),
);

export interface AgentCall {
  prompt: string;
  opts: Record<string, unknown>;
}

/** Runs the bake-off workflow script with a stub runtime and returns the agents it would spawn. */
export async function runWorkflow(args: Record<string, unknown>) {
  const src = readFileSync(WORKFLOW, "utf8").replace(/^export const meta/m, "const meta");
  const calls: AgentCall[] = [];
  const agent = async (prompt: string, opts: Record<string, unknown>) => {
    calls.push({ prompt, opts });
    return {};
  };
  const parallel = (thunks: (() => Promise<unknown>)[]) => Promise.all(thunks.map((t) => t()));
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const body = new AsyncFunction("args", "agent", "parallel", "phase", "log", src);
  const result = await body(
    args,
    agent,
    parallel,
    () => {},
    () => {},
  );
  return { result, calls };
}
