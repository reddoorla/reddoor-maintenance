import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readGitHubConfig, type ExecFileSyncFn } from "../../src/github/config.js";

const SAVED = { ...process.env };
beforeEach(() => {
  delete process.env.GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.RENOVATE_TOKEN;
});
afterEach(() => {
  process.env = { ...SAVED };
});

/** A `gh auth token` double that never shells out. */
const ghSays = (out: string) => vi.fn<ExecFileSyncFn>(() => out);
const ghFails = () =>
  vi.fn<ExecFileSyncFn>(() => {
    throw new Error("gh: not logged in");
  });

describe("readGitHubConfig", () => {
  it("returns null when GITHUB_TOKEN is unset AND gh has no keyring token", () => {
    expect(readGitHubConfig({ execFileSync: ghFails() })).toBeNull();
  });
  it("RENOVATE_TOKEN alone is not a token source: still null (the retired PAT name)", () => {
    process.env.RENOVATE_TOKEN = "ghp_retired_pat";
    expect(readGitHubConfig({ execFileSync: ghFails() })).toBeNull();
  });
  it("returns the broad token when present — and nothing else", () => {
    process.env.GITHUB_TOKEN = "ghp_broad";
    process.env.RENOVATE_TOKEN = "ghp_retired_pat";
    expect(readGitHubConfig({ execFileSync: ghFails() })).toEqual({ token: "ghp_broad" });
  });
});

/**
 * #665. A set-but-dead file token overrode the working `gh` keyring (gh.ts hands
 * the token to `gh` as GH_TOKEN), so the recipes 401'd on a machine where `gh`
 * itself was authenticated the whole time. The fix retires the copy: when
 * GITHUB_TOKEN is absent, ask `gh auth token`. The spawn is injected so this
 * suite never shells out and never depends on the runner's own keyring.
 */
describe("readGitHubConfig — `gh auth token` keyring fallback (#665)", () => {
  it("env unset: returns the keyring token (trimmed)", () => {
    const gh = ghSays("gho_keyring\n");
    expect(readGitHubConfig({ execFileSync: gh })).toEqual({ token: "gho_keyring" });
    expect(gh).toHaveBeenCalledOnce();
    expect(gh.mock.calls[0]?.[0]).toBe("gh");
    expect(gh.mock.calls[0]?.[1]).toEqual(["auth", "token"]);
  });

  it("env unset, RENOVATE_TOKEN set: the keyring token wins and RENOVATE_TOKEN is ignored", () => {
    process.env.RENOVATE_TOKEN = "ghp_retired_pat";
    expect(readGitHubConfig({ execFileSync: ghSays("gho_keyring\n") })).toEqual({
      token: "gho_keyring",
    });
  });

  it("env set: the env token wins and gh is never asked", () => {
    process.env.GITHUB_TOKEN = "ghp_file";
    const gh = ghSays("gho_keyring\n");
    expect(readGitHubConfig({ execFileSync: gh })?.token).toBe("ghp_file");
    expect(gh).not.toHaveBeenCalled();
  });

  it("env set to whitespace counts as unset: falls through to the keyring", () => {
    process.env.GITHUB_TOKEN = "   ";
    expect(readGitHubConfig({ execFileSync: ghSays("gho_keyring") })?.token).toBe("gho_keyring");
  });

  /**
   * THE GUARD CI CAN ACTUALLY FAIL ON, and the reason it is written here rather
   * than only where the defect surfaced.
   *
   * #808 resolved the token as `process.env.GITHUB_TOKEN?.trim() || ghAuthToken()`.
   * `""` is falsy, so an EXPLICITLY emptied `GITHUB_TOKEN` fell through to the
   * keyring and a machine that had run `gh auth login` resolved a token anyway.
   * `tests/cli/prismic-ci-command.test.ts` stubs `GITHUB_TOKEN` empty to land
   * deterministically on the "GITHUB_TOKEN not set" gate — so that test passed
   * on runners (logged out) and failed on any developer machine (logged in).
   * CI was structurally incapable of seeing it: the bug needs a keyring the
   * runner does not have.
   *
   * This assertion needs no keyring either way. The spawn is INJECTED, so
   * `not.toHaveBeenCalled()` fails in CI and on a laptop alike the moment an
   * explicit "no token" starts consulting `gh` again.
   */
  it("env set to the EMPTY STRING is a deliberate 'no token': null, and gh is NEVER asked", () => {
    process.env.GITHUB_TOKEN = "";
    const gh = ghSays("gho_keyring\n");
    expect(readGitHubConfig({ execFileSync: gh })).toBeNull();
    expect(gh).not.toHaveBeenCalled();
  });

  it("an empty GITHUB_TOKEN is not rescued by RENOVATE_TOKEN — null means null", () => {
    process.env.GITHUB_TOKEN = "";
    process.env.RENOVATE_TOKEN = "ghp_retired_pat";
    expect(readGitHubConfig({ execFileSync: ghSays("gho_keyring\n") })).toBeNull();
  });

  it("gh throws (not installed / not logged in): null, the pre-#665 'not configured' signal", () => {
    expect(readGitHubConfig({ execFileSync: ghFails() })).toBeNull();
  });

  it("gh prints nothing: null, not an empty-string token", () => {
    expect(readGitHubConfig({ execFileSync: ghSays("\n") })).toBeNull();
  });

  it("asks gh with GITHUB_TOKEN and GH_TOKEN STRIPPED from the child env", () => {
    // Trap 1 from the issue: `gh auth token` echoes $GITHUB_TOKEN / $GH_TOKEN
    // back when set, so a dead file token would make the keyring look dead
    // too. The fallback only runs when GITHUB_TOKEN is unset, but GH_TOKEN may
    // still be in the environment (the dashboard's request-path name) — and a
    // stale one would be echoed straight back as if it were the keyring.
    process.env.GH_TOKEN = "ghp_stale_gh_token";
    const gh = ghSays("gho_keyring\n");
    expect(readGitHubConfig({ execFileSync: gh })?.token).toBe("gho_keyring");
    const opts = gh.mock.calls[0]?.[2];
    expect(opts?.env).toBeDefined();
    expect(opts!.env).not.toHaveProperty("GITHUB_TOKEN");
    expect(opts!.env).not.toHaveProperty("GH_TOKEN");
    // …but the rest of the environment (PATH, HOME — gh needs both) is kept.
    expect(opts!.env.PATH).toBe(process.env.PATH);
  });

  it("does not validate the token by pinging an endpoint (trap 2: the token may not be allowed to read it)", () => {
    // One call, `gh auth token`, and nothing else — no `gh api /user`, no
    // `gh auth status`. A fine-grained token that cannot read itself is still a
    // working token for the calls it is scoped to.
    const gh = ghSays("gho_keyring\n");
    readGitHubConfig({ execFileSync: gh });
    expect(gh).toHaveBeenCalledTimes(1);
  });
});
