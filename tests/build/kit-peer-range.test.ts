import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../../package.json"), "utf8")) as {
  peerDependencies: Record<string, string>;
};

function caretMajors(range: string): number[] {
  return range.split("||").map((alt) => {
    const m = /^\^(\d+)\.\d+\.\d+$/.exec(alt.trim());
    if (!m) throw new Error(`not a caret range: ${alt.trim()}`);
    return Number(m[1]);
  });
}

describe("the @sveltejs/kit peer range", () => {
  it("admits kit 2 and kit 3, the majors the fleet runs", () => {
    const majors = caretMajors(pkg.peerDependencies["@sveltejs/kit"] ?? "");
    expect(majors).toContain(2);
    expect(majors).toContain(3);
  });

  it("reads a range that leaves out a major as missing it", () => {
    expect(caretMajors("^2.0.0")).not.toContain(3);
    expect(() => caretMajors(">=2")).toThrow("not a caret range");
  });
});
