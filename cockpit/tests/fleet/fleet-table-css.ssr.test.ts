import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Review round 5 (P1-87, PR 2): the overview's fact styling moved to the Sites table.
 * A failed check is bold and an unknown one muted; these read the sheet's text and
 * assert each selector carries its declaration, as the style-guide test does.
 */

const CSS = readFileSync(
  new URL("../../src/routes/fleet/fleet-table.css", import.meta.url).pathname,
  "utf8",
);

/** The body of the rule whose selector is exactly `selector`, or null. */
function ruleBody(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return m ? m[1]! : null;
}

describe("the fact cells' styling (P1-87, PR 2, review round 5)", () => {
  it("makes a failed check's cell bold", () => {
    const body = ruleBody("table.fleet td.fact.bad");
    expect(body).not.toBeNull();
    expect(body).toMatch(/font-weight:\s*var\(--weight-bold\)/);
  });

  it("mutes an unknown check's cell", () => {
    const body = ruleBody("table.fleet td.fact.unknown");
    expect(body).not.toBeNull();
    expect(body).toMatch(/(?:^|[;\s])color:\s*var\(--ink-muted\)/);
  });
});
