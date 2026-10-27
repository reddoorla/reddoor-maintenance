import type { Call, Check, ChildRecord, SessionArm, SessionTask } from "./lib/session-arms.mjs";
export function scoreTask(
  task: SessionTask,
  calls: Call[],
): {
  task: string;
  truth: unknown;
  rows: {
    arm: SessionArm;
    rec?: ChildRecord;
    problems: string[];
    checks?: Check[];
    correct: number;
    total: number;
  }[];
};
