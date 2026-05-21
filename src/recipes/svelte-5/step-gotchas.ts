import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { onEventToHandler } from "./codemods/on-event-to-handler.js";
import { exportLetToProps } from "./codemods/dollar-props.js";
import { removeDollarRestProps } from "./codemods/dollar-restprops.js";
import { stateEffectSyncToDerived } from "./codemods/state-effect-sync.js";
import { dollarPropsClass } from "./codemods/dollar-props-class.js";

const SVELTE_GLOBS = ["src/**/*.svelte"];
const IGNORE = ["node_modules/**", ".svelte-kit/**", "build/**"];

type Codemod = (src: string) => string;

// Order matters: exportLetToProps creates the $props() destructuring that
// dollarPropsClass extends with a `class:` named prop.
const CODEMODS: Codemod[] = [
  onEventToHandler,
  exportLetToProps,
  removeDollarRestProps,
  stateEffectSyncToDerived,
  dollarPropsClass,
];

export type CodemodChange = { rel: string; after: string };

export async function planGotchaCodemods(cwd: string): Promise<CodemodChange[]> {
  const changes: CodemodChange[] = [];
  const relPaths = await glob(SVELTE_GLOBS, { cwd, ignore: IGNORE, absolute: false });
  for (const rel of relPaths) {
    const path = join(cwd, rel);
    const before = await readFile(path, "utf-8");
    const after = CODEMODS.reduce((s, fn) => fn(s), before);
    if (after !== before) changes.push({ rel, after });
  }
  return changes;
}

export async function applyGotchaCodemods(cwd: string): Promise<{ filesChanged: number }> {
  const changes = await planGotchaCodemods(cwd);
  for (const c of changes) {
    await writeFile(join(cwd, c.rel), c.after, "utf-8");
  }
  return { filesChanged: changes.length };
}
