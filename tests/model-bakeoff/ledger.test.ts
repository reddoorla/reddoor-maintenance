import { describe, it, expect } from "vitest";
import {
  PRICES,
  priceRequest,
  splitLines,
  summarise,
  usageRecords,
} from "../../scripts/model-bakeoff/lib/ledger.mjs";

type U = Partial<{
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cache_creation: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number };
}>;

const line = (id: string, model: string, usage: U, effort = "low", text = "") =>
  JSON.stringify({
    effort,
    timestamp: "2026-10-19T00:00:00Z",
    message: { id, model, role: "assistant", content: [{ type: "text", text }], usage },
  });

describe("usageRecords", () => {
  it("counts a message once however many lines repeat its usage, keeping the last", () => {
    const lines = [
      line("m1", "claude-opus-5-5", { input_tokens: 10, output_tokens: 5 }),
      line("m1", "claude-opus-5-5", { input_tokens: 10, output_tokens: 50 }),
      line("m1", "claude-opus-5-5", { input_tokens: 10, output_tokens: 500 }),
      line("m2", "claude-opus-5-5", { input_tokens: 1, output_tokens: 1 }),
    ];
    const { records, diag } = usageRecords(lines);
    expect(records).toHaveLength(2);
    expect(diag.repeats).toBe(2);
    const s = summarise(records);
    expect(s.total.requests).toBe(2);
    expect(s.total.output).toBe(501);
    expect(s.total.input).toBe(11);
  });

  it("ignores user lines and lines without usage", () => {
    const user = JSON.stringify({ message: { role: "user", content: 'has "usage" in it' } });
    expect(usageRecords([user, 'not json "usage"']).records).toHaveLength(0);
  });
});

describe("splitLines", () => {
  it("splits on LF only, so U+2028 and U+2029 inside a JSON string keep the record whole", () => {
    const text = [
      line("a", "claude-opus-5-5", { output_tokens: 1 }, "low", "x y"),
      line("b", "claude-opus-5-5", { output_tokens: 1 }, "low", "p q\rr"),
    ].join("\n");
    const lines = [...splitLines(text)];
    expect(lines).toHaveLength(2);
    expect(usageRecords(lines).records.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("yields a final line with no trailing newline, and no empty tail", () => {
    expect([...splitLines("a\nb")]).toEqual(["a", "b"]);
    expect([...splitLines("a\nb\n")]).toEqual(["a", "b"]);
  });
});

describe("priceRequest", () => {
  const u = (o: Partial<Record<"in" | "out" | "cr" | "cw5m" | "cw1h", number>>) => {
    const v = { in: 0, out: 0, cr: 0, cw5m: 0, cw1h: 0, ...o };
    return { ...v, cw: v.cw5m + v.cw1h, ttlUnknown: false };
  };

  it("prices Haiku on its long-prompt card only above 100K prompt tokens", () => {
    const at = priceRequest("claude-haiku-5-5", u({ in: 1, cr: 99_999, out: 1_000_000 }));
    expect(at.longPrompt).toBe(false);
    expect(at.cost).toBeCloseTo((1 * 0.1 + 99_999 * 0.01 + 1_000_000 * 0.5) / 1e6, 10);
    const over = priceRequest("claude-haiku-5-5", u({ in: 1, cr: 100_000, out: 1_000_000 }));
    expect(over.longPrompt).toBe(true);
    expect(over.cost).toBeCloseTo((1 * 0.5 + 100_000 * 0.05 + 1_000_000 * 2.5) / 1e6, 10);
  });

  it("counts cache writes toward the 100K threshold", () => {
    expect(priceRequest("claude-haiku-5-5", u({ cw1h: 100_001 })).longPrompt).toBe(true);
  });

  it("has no long-prompt card for Opus or Sonnet", () => {
    expect(priceRequest("claude-opus-5-5", u({ cr: 500_000 })).longPrompt).toBe(false);
    expect(PRICES["claude-sonnet-5-5"]?.long).toBeUndefined();
  });

  it("prices 1-hour cache writes at 2x input and 5-minute ones at 1.25x", () => {
    expect(priceRequest("claude-opus-5-5", u({ cw1h: 1e6 })).cost).toBeCloseTo(8, 10);
    expect(priceRequest("claude-opus-5-5", u({ cw5m: 1e6 })).cost).toBeCloseTo(5, 10);
  });

  it("reports an unknown model as unpriced rather than guessing", () => {
    expect(priceRequest("claude-opus-5", u({ in: 1 })).cost).toBeNull();
  });
});

describe("summarise", () => {
  it("reports by message.model and effort, and splits cache writes by TTL", () => {
    const { records } = usageRecords([
      line("a", "claude-haiku-5-5", { output_tokens: 1 }, "low"),
      line("b", "claude-haiku-5-5", { output_tokens: 1 }, "medium"),
      line(
        "c",
        "claude-haiku-5-5",
        {
          cache_creation_input_tokens: 30,
          cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 },
        },
        "low",
      ),
      line("d", "claude-opus-5", { output_tokens: 1 }, "xhigh"),
    ]);
    const s = summarise(records);
    const key = (r: { model: string; effort: string }) => `${r.model}@${r.effort}`;
    expect(s.rows.map(key).sort()).toEqual([
      "claude-haiku-5-5@low",
      "claude-haiku-5-5@medium",
      "claude-opus-5@xhigh",
    ]);
    const low = s.rows.find((r) => key(r) === "claude-haiku-5-5@low")!;
    expect([low.requests, low.cacheWrite5m, low.cacheWrite1h]).toEqual([2, 10, 20]);
    expect(s.rows.find((r) => r.model === "claude-opus-5")!.priced).toBe(false);
    expect(s.total.priced).toBe(false);
  });

  it("prices cache writes with no TTL split at the 5-minute rate and counts them", () => {
    const { records } = usageRecords([
      line("a", "claude-opus-5-5", { cache_creation_input_tokens: 1e6 }),
    ]);
    const s = summarise(records);
    expect(s.total.cost).toBeCloseTo(5, 10);
    expect(s.total.ttlUnknown).toBe(1);
  });
});
