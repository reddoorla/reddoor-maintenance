#!/usr/bin/env node
// Wasted-work census: heuristics nominate CANDIDATE episodes with a token cost; a
// refuter confirms or rejects each from its transcript window
// (scripts/meta-week/transcript-window.mjs). See docs/meta-week/11-wasted-work-census.md.
//
//   node scripts/meta-week/census.mjs [--root DIR] [--class fanout|redo|unread|all]
//     [--top N] [--json FILE] [--jsonl FILE]
import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { collectEvents } from "./lib/walk.mjs";

function parseArgs(argv) {
  const o = {
    root: join(homedir(), ".claude", "projects"),
    class: "all",
    top: 10,
    json: null,
    jsonl: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case "--root":
        o.root = next();
        break;
      case "--class":
        o.class = next();
        break;
      case "--top":
        o.top = Number(next());
        break;
      case "--json":
        o.json = next();
        break;
      case "--jsonl":
        o.jsonl = next();
        break;
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  if (!["fanout", "redo", "unread", "all"].includes(o.class)) {
    throw new Error("--class must be fanout|redo|unread|all");
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const all = await collectEvents(o.root, { full: true });
  const result = {
    root: o.root,
    files: all.files,
    prompts: all.prompts.length,
    tools: all.tools.length,
    agentResults: all.agentResults.length,
    interrupts: all.interrupts.length,
    classes: {},
  };
  process.stdout.write(
    `files=${all.files} prompts=${all.prompts.length} tools=${all.tools.length} agentResults=${all.agentResults.length} interrupts=${all.interrupts.length}\n`,
  );
  if (o.json) await writeFile(o.json, JSON.stringify(result, null, 2));
}

main().catch((e) => {
  process.stderr.write(`census: ${e.message}\n`);
  process.exit(1);
});
