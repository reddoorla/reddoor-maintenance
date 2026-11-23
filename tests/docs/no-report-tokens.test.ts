import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

/**
 * A prospect report's 22-character token is the whole credential for reading
 * it (`netlify/functions/audit-report-json.mts`), and this repo is public. One
 * sat in a journal entry here for 18 days, so anyone could open a client's
 * report, and each visit overwrote its read receipt. The token was rotated on
 * 2026-11-23; git history still holds the old one, which now opens nothing.
 *
 * This fails on any tracked file holding `/audit/` followed by exactly 22
 * token characters. Write `/audit/<token>` in prose, and keep real tokens in
 * the private workspace.
 */

// Built from parts, so this file never matches itself.
const TOKEN_CHARS = "[A-Za-z0-9_-]";
// Every route that takes a token (`/audit/`, the `/r/` redirect, the JSON
// route), with slashes optionally JSON-escaped, and a stored row's `"token"`.
const SLASH = String.raw`\\?/`;
const REPORT_URL = new RegExp(
  `(?:${SLASH}(?:audit|r|api${SLASH}audit-report)${SLASH}|"token"\\s*:\\s*")${TOKEN_CHARS}{22}(?!${TOKEN_CHARS})`,
  "g",
);

/** Fake tokens tests carry on purpose: the shared fixture token, and any token
 *  of one repeated character (`AAAA…`), which `generateToken()` never makes. */
const FAKE = new Set(["aB3-_xY9zQ1rS2tU4vW6xY"]);
const isFake = (token: string) => FAKE.has(token) || /^(.)\1+$/.test(token);

export function reportTokenHits(text: string): string[] {
  return [...text.matchAll(REPORT_URL)].map((m) => m[0]).filter((hit) => !isFake(hit.slice(-22)));
}

describe("reportTokenHits", () => {
  const fake = "/audit/" + "Ab0_-".repeat(4) + "Zz";

  it("finds a report URL with a 22-character token", () => {
    expect(fake).toHaveLength(7 + 22);
    expect(reportTokenHits(`see https://reddoorla.com${fake}/print today`)).toEqual([fake]);
  });

  it("finds the same token on the other routes and in a stored row", () => {
    const t = fake.slice("/audit/".length);
    for (const shape of [
      `/r/${t}`,
      `/api/audit-report/${t}`,
      `\\/audit\\/${t}`,
      `"token": "${t}"`,
    ]) {
      expect(reportTokenHits(`x ${shape} y`), shape).toHaveLength(1);
    }
  });

  it("ignores placeholders, wrong lengths and fake tokens", () => {
    expect(reportTokenHits("/audit/{token} and /audit/<token> and /audit/[token]")).toEqual([]);
    expect(reportTokenHits(fake.slice(0, -1))).toEqual([]);
    expect(reportTokenHits(fake + "x")).toEqual([]);
    expect(reportTokenHits(`/audit/${[...FAKE][0]} /r/${"A".repeat(22)}`)).toEqual([]);
  });
});

describe("tracked files", () => {
  it("hold no report token", () => {
    const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
    expect(files.length).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const f of files) {
      let buf: Buffer;
      try {
        if (statSync(f).size > 5_000_000) continue;
        buf = readFileSync(f);
      } catch {
        continue; // deleted in the working tree, or a submodule
      }
      if (buf.includes(0)) continue; // binary
      const lines = buf.toString("utf8").split("\n");
      lines.forEach((line, i) => {
        for (const hit of reportTokenHits(line)) hits.push(`${f}:${i + 1} ${hit.slice(0, 13)}…`);
      });
    }
    expect(
      hits,
      "A report token is in a tracked file. Rotate it and write /audit/<token> instead.",
    ).toEqual([]);
  });
});
