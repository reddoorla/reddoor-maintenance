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

  it("defaults keyPath alongside credentials.env", () => {
    process.env.GA_SUBJECT = "tucker@reddoorla.com";
    expect(readGaConfig()).toEqual({
      subject: "tucker@reddoorla.com",
      keyPath: join(dirname(defaultCredentialsPath()), "ga-service-account.json"),
    });
  });

  it("honors GA_SA_KEY_PATH override", () => {
    process.env.GA_SUBJECT = "x@y.com";
    process.env.GA_SA_KEY_PATH = "/custom/key.json";
    expect(readGaConfig()?.keyPath).toBe("/custom/key.json");
  });
});
