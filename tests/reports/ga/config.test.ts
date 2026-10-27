import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { dirname, join } from "node:path";
import { readGaConfig } from "../../../src/reports/ga/config.js";
import { defaultCredentialsPath } from "../../../src/util/credentials.js";

const SAVED = { ...process.env };
beforeEach(() => {
  delete process.env.GA_SUBJECT;
  delete process.env.GA_SA_KEY_PATH;
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("readGaConfig", () => {
  it("returns null when GA_SUBJECT is unset (GA simply skipped)", () => {
    expect(readGaConfig()).toBeNull();
  });

  it("treats blank GA_SUBJECT as unset", () => {
    process.env.GA_SUBJECT = "   ";
    expect(readGaConfig()).toBeNull();
  });

  it("treats a GA_SUBJECT of only commas/whitespace as unset", () => {
    process.env.GA_SUBJECT = " , ,, ";
    expect(readGaConfig()).toBeNull();
  });

  it("parses a single subject as a one-element list (the degenerate case)", () => {
    process.env.GA_SUBJECT = "tucker@reddoorla.com";
    expect(readGaConfig()).toEqual({
      subjects: ["tucker@reddoorla.com"],
      keyPath: join(dirname(defaultCredentialsPath()), "ga-service-account.json"),
    });
  });

  it("parses a comma-separated list in failover order", () => {
    process.env.GA_SUBJECT = "reports@reddoorla.com,tucker@reddoorla.com";
    expect(readGaConfig()?.subjects).toEqual(["reports@reddoorla.com", "tucker@reddoorla.com"]);
  });

  it("trims whitespace around each subject and drops empty segments", () => {
    process.env.GA_SUBJECT = " reports@reddoorla.com , ,, tucker@reddoorla.com ,";
    expect(readGaConfig()?.subjects).toEqual(["reports@reddoorla.com", "tucker@reddoorla.com"]);
  });

  it("honors GA_SA_KEY_PATH override", () => {
    process.env.GA_SUBJECT = "x@y.com";
    process.env.GA_SA_KEY_PATH = "/custom/key.json";
    expect(readGaConfig()?.keyPath).toBe("/custom/key.json");
  });
});
