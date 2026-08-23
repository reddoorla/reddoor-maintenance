import { describe, it, expect, afterEach } from "vitest";
import { operatorEmail, OPERATOR_FALLBACK } from "../../src/util/operator.js";

afterEach(() => {
  delete process.env.OPERATOR_EMAIL;
});

describe("operatorEmail", () => {
  // The ONE assertion on the shipped value. Every other test here injects its
  // own state, so changing the constant breaks exactly this line — and this
  // line is the whole point: internal fleet mail must never default to the
  // client-facing info@reddoorla.com alias (2026-08-17, when it did).
  it("defaults to the monitored operator inbox, never the client-facing alias", () => {
    expect(OPERATOR_FALLBACK).toBe("tucker@reddoorla.com");
    expect(OPERATOR_FALLBACK).not.toContain("info@");
  });

  it("returns OPERATOR_EMAIL when it is set", () => {
    process.env.OPERATOR_EMAIL = "ops@example.com";
    expect(operatorEmail()).toBe("ops@example.com");
  });

  it("trims surrounding whitespace", () => {
    process.env.OPERATOR_EMAIL = "  ops@example.com  ";
    expect(operatorEmail()).toBe("ops@example.com");
  });

  it("falls back when OPERATOR_EMAIL is unset", () => {
    delete process.env.OPERATOR_EMAIL;
    expect(operatorEmail()).toBe(OPERATOR_FALLBACK);
  });

  it("falls back when OPERATOR_EMAIL is empty or whitespace-only", () => {
    process.env.OPERATOR_EMAIL = "";
    expect(operatorEmail()).toBe(OPERATOR_FALLBACK);
    process.env.OPERATOR_EMAIL = "   ";
    expect(operatorEmail()).toBe(OPERATOR_FALLBACK);
  });

  it("reads the environment at call time, not module load", () => {
    process.env.OPERATOR_EMAIL = "first@example.com";
    expect(operatorEmail()).toBe("first@example.com");
    process.env.OPERATOR_EMAIL = "second@example.com";
    expect(operatorEmail()).toBe("second@example.com");
  });
});
