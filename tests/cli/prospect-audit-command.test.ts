import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { runProspectAuditCommand } from "../../src/cli/commands/prospect-audit.js";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");
const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("prospect-audit CLI", () => {
  it("is registered with its flags", () => {
    const help = execFileSync(process.execPath, [binPath, "--help"], { encoding: "utf-8" });
    expect(help).toContain("prospect-audit");
  });

  it("rejects a non-http argument before doing any work", async () => {
    const { output, code } = await runProspectAuditCommand("not-a-url", {});
    expect(code).toBe(2);
    expect(output).toMatch(/https?:\/\//);
  });

  it("refuses to run with neither Turso nor --out — the report would vanish", async () => {
    delete process.env.TURSO_DATABASE_URL;
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {});
    expect(code).toBe(2);
    expect(output).toContain("--out");
  });
});

describe("prospect-audit CLI — writing a file", () => {
  const out = resolve(tmpdir(), "prospect-cli-test.html");

  beforeEach(() => {
    delete process.env.TURSO_DATABASE_URL;
    if (existsSync(out)) rmSync(out);
  });
  afterEach(() => {
    if (existsSync(out)) rmSync(out);
  });

  it("renders the report to --out and reports the scores", async () => {
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      out,
      probes: false,
      deps: {
        crawl: {
          async fetchUrl(url: string) {
            if (url === "https://acme.example/")
              return {
                status: 200,
                body: "<html><head><title>Acme</title></head><body><h1>Acme</h1><p>Roofing in Boise.</p></body></html>",
                headers: {},
              };
            return { status: 404, body: "", headers: {} };
          },
          async renderPages() {
            return new Map<string, string>();
          },
          maxPages: 2,
          delayMs: 0,
        },
        analyze: {
          run: async () => ({
            businessName: "Acme Roofing",
            business: "A residential roofing company operating in Boise, Idaho.",
            entityClarity: { score: 50, missing: [] },
            categoryQueries: [
              "roof repair contractor Boise",
              "roof replacement cost",
              "flat roof repair Idaho",
            ],
            buyerQuestions: [
              { question: "cost?", answered: "no", quotable: false, page: null, evidence: null },
              {
                question: "do you offer free estimates?",
                answered: "no",
                quotable: false,
                page: null,
                evidence: null,
              },
              {
                question: "what areas do you serve?",
                answered: "no",
                quotable: false,
                page: null,
                evidence: null,
              },
              {
                question: "are you licensed and insured?",
                answered: "no",
                quotable: false,
                page: null,
                evidence: null,
              },
              {
                question: "how long does a roof replacement take?",
                answered: "no",
                quotable: false,
                page: null,
                evidence: null,
              },
              {
                question: "do you handle storm damage claims?",
                answered: "no",
                quotable: false,
                page: null,
                evidence: null,
              },
            ],
            fixes: [],
            narrative: { findability: "a", readability: "b", answers: "c" },
          }),
        },
        lighthouse: async () => {
          throw new Error("skipped in test");
        },
        probeDelayMs: 0,
      },
    });

    expect(code).toBe(0);
    expect(existsSync(out)).toBe(true);
    expect(readFileSync(out, "utf-8")).toContain("Acme Roofing");
    expect(output).toContain("Findability");
    expect(output).toContain(out);
  });
});
