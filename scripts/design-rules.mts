#!/usr/bin/env -S pnpm tsx
// Check pages against the encoded design-review rules
// (docs/design-review-rules-2026-09.md).
//
//   pnpm tsx scripts/design-rules.mts <url…> [--rule R2] [--json]
//
// Exit 1 when any page fails a rule, 2 when nothing failed but something was
// unmeasured, 0 when every check passed.
import { chromium } from "@playwright/test";
import {
  DESIGN_RULES,
  runDesignRules,
  type DesignRuleId,
} from "../src/audits/design-rules/index.js";

const args = process.argv.slice(2);
const urls: string[] = [];
const picked: DesignRuleId[] = [];
let json = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--json") json = true;
  else if (arg === "--rule") {
    const id = args[++i] as DesignRuleId | undefined;
    if (!id || !Object.hasOwn(DESIGN_RULES, id)) {
      console.error(
        `unknown rule ${id ?? "(none)"}; known: ${Object.keys(DESIGN_RULES).join(", ")}`,
      );
      process.exit(64);
    }
    picked.push(id);
  } else urls.push(arg);
}
if (urls.length === 0) {
  console.error("usage: design-rules.mts <url…> [--rule R2] [--json]");
  process.exit(64);
}
const rules = (picked.length > 0 ? picked : (Object.keys(DESIGN_RULES) as DesignRuleId[])).map(
  (id) => DESIGN_RULES[id],
);

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  // Not a page's failure: exit 2, as for any other unmeasured run.
  console.error(`UNMEASURED: the browser did not launch: ${String(error).split("\n")[0]}`);
  process.exit(2);
}
try {
  const outcomes = await runDesignRules(urls, rules, browser);
  if (json) console.log(JSON.stringify(outcomes, null, 2));
  else {
    for (const o of outcomes) {
      console.log(`${o.status.toUpperCase()} ${o.rule} ${o.url}: ${o.note}`);
      for (const f of o.findings) console.log(`  - ${f.target}: ${f.problem}`);
    }
  }
  process.exitCode = outcomes.some((o) => o.status === "fail")
    ? 1
    : outcomes.some((o) => o.status === "unmeasured")
      ? 2
      : 0;
} finally {
  await browser.close();
}
