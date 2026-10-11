import { describe, it, expect } from "vitest";
import {
  MIN_COUNT,
  parseBlocklist,
  renderSnapshot,
} from "../../scripts/refresh-disposable-domains.mjs";

const filler = Array.from({ length: MIN_COUNT }, (_, i) => `throwaway${i}.example`);
const SHA = "2a79805ed6caf893921e3d0f0f85ac18a6fea99c";

describe("refresh-disposable-domains", () => {
  it("keeps bare domains sorted and deduplicated, skipping blanks and comments", () => {
    const text = ["# header", "", "zz-mail.com", "aa-mail.com", "zz-mail.com", ...filler].join(
      "\n",
    );
    const { domains, excluded } = parseBlocklist(text, []);
    expect(domains.length).toBe(MIN_COUNT + 2);
    expect(domains[0]).toBe("aa-mail.com");
    expect(domains).toEqual([...domains].sort());
    expect(excluded).toEqual([]);
  });

  it("leaves out a domain that is already blocked, and reports it", () => {
    const { domains, excluded } = parseBlocklist(["vasdirect.com", ...filler].join("\n"), [
      "vasdirect.com",
    ]);
    expect(domains).not.toContain("vasdirect.com");
    expect(excluded).toEqual(["vasdirect.com"]);
  });

  it("refuses a malformed line rather than vendoring it", () => {
    expect(() => parseBlocklist(["Bad Domain.com", ...filler].join("\n"), [])).toThrow(/line 1/);
    expect(() => parseBlocklist(["user@mail.com", ...filler].join("\n"), [])).toThrow(/line 1/);
  });

  it("refuses a list under the floor, the shape a truncated fetch has", () => {
    expect(() => parseBlocklist(filler.slice(1).join("\n"), [])).toThrow(/floor/);
  });

  it("renders a module whose set round-trips every domain and records the source", async () => {
    const domains = ["0-mail.com", "dropmail.me"];
    const src = renderSnapshot(domains, SHA);
    expect(src).toContain(`commit: "${SHA}"`);
    expect(src).toContain('licence: "CC0-1.0"');
    const mod = (await import(
      `data:text/javascript,${encodeURIComponent(src.replace(": ReadonlySet<string>", "").replace(" as const", ""))}`
    )) as {
      VENDORED_DISPOSABLE_DOMAINS: Set<string>;
      VENDORED_DISPOSABLE_SOURCE: { count: number };
    };
    expect([...mod.VENDORED_DISPOSABLE_DOMAINS]).toEqual(domains);
    expect(mod.VENDORED_DISPOSABLE_SOURCE.count).toBe(2);
  });

  it("refuses a ref that is not a full commit sha", () => {
    expect(() => renderSnapshot(["a.com"], "main")).toThrow(/sha/);
  });
});
