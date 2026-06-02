import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readGitHubConfig } from "../../src/github/config.js";

const SAVED = { ...process.env };
beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
  delete process.env.RENOVATE_TOKEN;
});
afterEach(() => {
  process.env = { ...SAVED };
});

describe("readGitHubConfig", () => {
  it("returns null when GITHUB_TOKEN is unset", () => {
    process.env.RENOVATE_TOKEN = "r";
    expect(readGitHubConfig()).toBeNull();
  });
  it("returns the broad token + renovate token when present", () => {
    process.env.GITHUB_TOKEN = "ghp_broad";
    process.env.RENOVATE_TOKEN = "ghp_narrow";
    expect(readGitHubConfig()).toEqual({ token: "ghp_broad", renovateToken: "ghp_narrow" });
  });
  it("falls back renovateToken to the broad token when RENOVATE_TOKEN unset", () => {
    process.env.GITHUB_TOKEN = "ghp_broad";
    expect(readGitHubConfig()).toEqual({ token: "ghp_broad", renovateToken: "ghp_broad" });
  });
});
