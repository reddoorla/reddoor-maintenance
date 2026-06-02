import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readSearchConfig } from "../../../src/reports/search/config.js";

const SAVED = { ...process.env };
beforeEach(() => {
  delete process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_ENGINE_ID;
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("readSearchConfig", () => {
  it("returns null when the API key is unset", () => {
    process.env.GOOGLE_SEARCH_ENGINE_ID = "CX";
    expect(readSearchConfig()).toBeNull();
  });

  it("returns null when the engine ID is unset", () => {
    process.env.GOOGLE_SEARCH_API_KEY = "KEY";
    expect(readSearchConfig()).toBeNull();
  });

  it("returns both when present", () => {
    process.env.GOOGLE_SEARCH_API_KEY = "KEY";
    process.env.GOOGLE_SEARCH_ENGINE_ID = "CX";
    expect(readSearchConfig()).toEqual({ apiKey: "KEY", engineId: "CX" });
  });
});
