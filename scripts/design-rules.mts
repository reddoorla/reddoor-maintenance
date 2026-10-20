#!/usr/bin/env -S pnpm tsx
// Check pages against the encoded design-review rules
// (docs/design-review-rules-2026-09.md).
//
//   pnpm tsx scripts/design-rules.mts <url…> [--rule R2] [--json]
//
// Exit 1 when any page fails a rule, 2 when nothing failed but something was
// unmeasured (the browser not launching included), 0 when every check passed,
// 64 on a usage error. The logic is src/audits/design-rules/cli.ts.
import { chromium, type Browser } from "@playwright/test";
import { DESIGN_RULES, runDesignRules } from "../src/audits/design-rules/index.js";
import { exitCodeFor, parseDesignRulesArgs } from "../src/audits/design-rules/cli.js";

const args = parseDesignRulesArgs(process.argv.slice(2));
if ("error" in args) {
  console.error(args.error);
  process.exit(64);
}

let browser: Browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.error(`UNMEASURED: the browser did not launch: ${String(error).split("\n")[0]}`);
  process.exit(2);
}
try {
  const outcomes = await runDesignRules(
    args.urls,
    args.rules.map((id) => DESIGN_RULES[id]),
    browser,
  );
  if (args.json) console.log(JSON.stringify(outcomes, null, 2));
  else {
    for (const o of outcomes) {
      console.log(`${o.status.toUpperCase()} ${o.rule} ${o.url}: ${o.note}`);
      for (const f of o.findings) console.log(`  - ${f.target}: ${f.problem}`);
    }
  }
  process.exitCode = exitCodeFor(outcomes);
} finally {
  await browser.close();
}
