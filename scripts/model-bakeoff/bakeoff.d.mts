import type { Arm } from "./lib/arms.mjs";
import type { Check, Collection, Kinds } from "./lib/score.mjs";
import type { AgentTranscript } from "./lib/transcripts.mjs";
export const REFEREE: Readonly<Arm>;
/**
 * A bake-off task module, as `prepare`, `collect` and `score` read it. Every hook is optional;
 * `observe` needs `truth`, and an item task (`items`) needs `assemble`.
 */
export interface Task {
  id: string;
  title: string;
  row: number;
  sources: { from: string; match: RegExp; to: string }[];
  collections: Collection[];
  kinds?: Kinds;
  schema: unknown;
  prompt: (dir: string) => string;
  goldAddendum: string;
  arms: Arm[];
  gold: Arm;
  /** prepare: called before the input is frozen; `root` is set only when --root was given. */
  setup?: (o: { input: string; work: string; ids: string[]; root?: string }) => void;
  /** prepare: the reference, computed from the frozen input. */
  truth?: (dir: string) => unknown;
  items?: (dir: string) => { id: string; prompt: string; schema: unknown }[];
  assemble?: (outputs: never, dir: string) => unknown;
  /** score: what is scored for one agent, read from its work dir, in place of its output. */
  observe?: (work: string, structured: unknown, agent?: unknown, reference?: unknown) => unknown;
  secrets?: string[];
  referenceFaults?: (task: never, reference: never) => string[];
  extraCandidates?: (task: never, reference: never, outputs: never) => unknown;
  scoreRun?: (task: never, reference: never, output: never, candidates?: never) => Check[];
  summarize?: (o: never) => unknown;
  formatSummary?: (summary: never) => string;
  decision?: (records: never, dir: string, ctx: never) => unknown;
}
export function truthPath(run: string): string;
export function loadTask(name: string): Promise<Record<string, unknown>>;
export function prepare(
  opts: { task?: string; out: string; root?: string; arms?: string },
  task?: Task,
): Promise<void>;
export function manifest(dir: string): Record<string, string>;
export function extractArgs(
  task: {
    id: string;
    arms: Arm[];
    gold: Arm;
    prompt: (d: string) => string;
    goldAddendum?: string;
    schema: unknown;
    items?: (d: string) => { id: string; prompt: string; schema: unknown }[];
  },
  inputDir: string,
  arms?: Arm[],
  work?: string,
): Record<string, unknown>;
export function scorerFor(task: Record<string, unknown>): {
  referenceFaults: (...a: unknown[]) => string[];
  extraCandidates: (...a: unknown[]) => Record<string, unknown>;
  scoreRun: (...a: unknown[]) => unknown[];
};
// agentType is absent on a runs.json entry collected before 2026-10-20.
export type Collected = AgentTranscript & { transcript: string; agentType?: string | null };
export function collectFile(file: string): Collected;
export type Marker = { kind: "arm" | "referee"; id: string; item?: string };
export function agentKey(marker: Marker): string;
export interface RunArgs {
  dir: string;
  work: string;
  gold: Arm;
  arms: Arm[];
  items?: { id: string }[];
}
export function expectedWork(args: RunArgs, marker: Marker): string;
export function mergeAgents(
  prior: Record<string, Collected>,
  found: Collected[],
  args: RunArgs,
): { agents: Record<string, Collected>; errors: string[] };
export function verifyRan(
  arm: Arm,
  agent: AgentTranscript & { agentType?: string | null },
  work?: string,
  opts?: { needOutput?: boolean },
): string[];
export function combineItems(
  task: { assemble: (outputs: Record<string, unknown>, dir: string) => unknown },
  args: RunArgs & { items: { id: string }[] },
  agents: Record<string, AgentTranscript & { agentType?: string | null }>,
  arm: Arm,
): {
  record: (Omit<AgentTranscript, "marker" | "markerError"> & Record<string, unknown>) | null;
  problems: string[];
};
export function secretReads(
  secrets: string[],
  agents: Record<string, { bash?: string[]; reads?: string[] }>,
): string[];
export function scoreArms(
  task: Record<string, unknown>,
  args: RunArgs & { task: string },
  agents: Record<string, Collected>,
  reference: unknown,
  truth: unknown,
): {
  checksByArm: Record<string, import("./lib/score.mjs").Check[]>;
  problems: string[];
  invalid: string[];
};
export function armOutput(
  task: {
    observe?: (work: string, structured: unknown, agent?: unknown, reference?: unknown) => unknown;
  },
  args: { work: string },
  arm: Arm,
  agent: (Partial<Collected> & { structured?: unknown }) | undefined,
  reference?: unknown,
): unknown;
export function nextRound(agents: Record<string, unknown>): number;
export function byCollection(
  byField: Record<string, { total: number; correct: number }>,
): Record<string, string>;
export function formatResult(r: Record<string, unknown>): string;
export function launchers(
  args: { task: string; gold: Arm; arms: Arm[] } & Record<string, unknown>,
  source: string,
): { id: string; script: string }[];
