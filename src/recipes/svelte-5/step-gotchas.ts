import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { glob } from "tinyglobby";
import { onEventToHandler } from "./codemods/on-event-to-handler.js";
import { exportLetToProps } from "./codemods/dollar-props.js";
import { removeDollarRestProps } from "./codemods/dollar-restprops.js";

const SVELTE_GLOBS = ["src/**/*.svelte"];
const IGNORE = ["node_modules/**", ".svelte-kit/**", "build/**"];

type Codemod = (src: string) => string;

const CODEMODS: Codemod[] = [onEventToHandler, exportLetToProps, removeDollarRestProps];

export async function applyGotchaCodemods(cwd: string): Promise<{ filesChanged: number }> {
  let filesChanged = 0;
  const relPaths = await glob(SVELTE_GLOBS, { cwd, ignore: IGNORE, absolute: false });
  for (const rel of relPaths) {
    const path = join(cwd, rel);
    const before = await readFile(path, "utf-8");
    const after = CODEMODS.reduce((s, fn) => fn(s), before);
    if (after !== before) {
      await writeFile(path, after, "utf-8");
      filesChanged += 1;
    }
  }
  return { filesChanged };
}
