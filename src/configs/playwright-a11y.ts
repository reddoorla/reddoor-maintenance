import { execFileSync } from "node:child_process";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

export type A11yRoute = { path: string; name: string };

export const a11yRoutes: A11yRoute[] = [
  { path: "/dev/a11y-fixtures", name: "a11y fixtures" },
  { path: "/dev/animate-in", name: "animate-in demo" },
];

// Routes smoke-loaded for client-side (hydration) errors only — NOT axe-scanned.
// Catches the class of bug where build + SSR succeed but client hydration throws
// and blanks the page (data-dynamiq 2026-06-09: a Svelte 4->5 `run()` referenced
// a `$state` declared after it → TDZ ReferenceError on hydrate). `/` is the one
// route every site has; real routes carry a11y debt we don't gate on here, so we
// assert only that they don't crash on hydrate.
export const smokeRoutes: A11yRoute[] = [{ path: "/", name: "home" }];

// R1.1 (health-gate): the central `smoke` audit (src/audits/smoke.ts) allocates
// a free port and passes it as REDDOOR_SMOKE_PORT so a zombie vite already
// squatting the default 5173 can't silently hijack the run and green a stale
// build. The per-site R1.1 config template honors it, but sites whose
// playwright.config.ts merely re-exports this shared base (pre-R1.1 adopters
// the smoke-suite recipe flags-but-never-rewrites) would otherwise ignore it —
// so honor it here too and every re-exporter inherits the port binding on its
// next package bump. Unset (local `pnpm test:smoke`) → the fixed 5173.
const smokePort = process.env.REDDOOR_SMOKE_PORT;

/**
 * Allocate a free port SYNCHRONOUSLY, for the local path where nothing handed
 * us one. Same trick as src/util/free-port.ts (bind :0, read the assigned port,
 * release it) — but that is async, and this value is needed at module scope
 * while Playwright is still building the config object.
 *
 * It cannot be an async default export instead: sites consume this base by
 * SPREADING it (`{ ...base, use: { ...base.use } }` — see the smoke-suite
 * recipe template). Spreading a Promise yields none of its properties, so the
 * site would get a silently empty config — the exact false-green this whole
 * change exists to remove. The export must stay a plain object.
 *
 * A subprocess is the cost of that constraint: ~30-50ms, once per Playwright
 * run. On any failure we return null and the caller falls back to 5173, which
 * (with reuseExistingServer now false) degrades to a loud "port already in use"
 * rather than a silent wrong-server run.
 */
function allocateFreePortSync(): string | null {
  try {
    const out = execFileSync(
      process.execPath,
      [
        "-e",
        'const s=require("node:net").createServer();s.on("error",()=>process.exit(1));' +
          's.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>process.stdout.write(String(p)))});',
      ],
      { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return /^\d+$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the port this run binds to, ONCE per run rather than once per
 * evaluation of this file.
 *
 * REDDOOR_SMOKE_PORT (the central audit already allocated one) wins; otherwise
 * this run allocates its own. The old fallback was the fixed 5173 — the same
 * port a dev server sits on, which is what let `reuseExistingServer` silently
 * hijack local runs (#524).
 *
 * The allocation is pinned back into the environment, and that is the whole
 * point. Playwright re-evaluates the config file in EVERY worker process, not
 * just the main one. Allocating per evaluation gave each worker a different
 * port: the main process started the dev server on one, every worker aimed
 * `baseURL` at another, and the run died with ERR_CONNECTION_REFUSED against a
 * handful of ports nothing was ever serving. Workers are forked and inherit
 * this environment, so writing it back makes every later evaluation agree.
 *
 * It broke on the site suites and not on `audit --only a11y`, which writes its
 * own config and never reads this file — so nothing here caught it.
 */
function resolvePort(): string {
  if (smokePort) return smokePort;
  const allocated = allocateFreePortSync() || "5173";
  process.env.REDDOOR_SMOKE_PORT = allocated;
  return allocated;
}

const port = resolvePort();

// NOTE: default export only — sites consume this as `import base from
// "@reddoorla/maintenance/configs/playwright-a11y"` (or re-export the default).
// The old `playwrightA11yConfig` named alias had zero importers and was removed.
const playwrightA11yConfig: PlaywrightTestConfig = defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Portable across pnpm and npm sites — pnpm respects `npm run` too.
    //
    // `--port ... --strictPort` in BOTH cases. It used to be applied only when
    // REDDOOR_SMOKE_PORT allocated one, on the reasoning that we should "fail
    // loudly rather than let vite drift to a free port the baseURL doesn't
    // point at" — but that argument covers the unset case just as well. 5173 is
    // equally a fixed port that `baseURL` and the readiness probe below are
    // pinned to, and vite left to itself drifts off it whenever something else
    // holds it.
    //
    // The symptom that exposed this: a non-vite process on 5173 sends vite to
    // 5174 while the probe keeps polling 5173, so the run dies on
    // "Timed out waiting 120000ms from config.webServer" — 120 seconds of
    // nothing, naming neither the port nor the squatter. With --strictPort it
    // is an immediate "Port 5173 is already in use".
    //
    // --strictPort now only bites if the allocated port is taken in the window
    // between releasing and binding it, which is exactly the case worth failing
    // on.
    command: `npm run vite:dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}/dev/a11y-fixtures`,
    // NEVER reuse (#524). This used to be `!process.env.CI`, so local runs
    // reused whatever answered the probe URL. The probe only asks "does this
    // respond?" — never "is this serving the code I am about to test?" — so a
    // dev server left open, or one whose tree changed under it after a
    // checkout, silently became the system under test. That fails in both
    // directions: a false red blamed on the code (beachfront 2026-08-12, where
    // it was investigated as a macOS-vs-Linux difference and written up as one
    // before being caught), and a false green where a passing suite ran against
    // an old build. CI already had it false, and that asymmetry is precisely
    // what made the failure read as a platform bug.
    //
    // The cost is a fresh vite boot per run (~10-20s against a ~2min suite).
    // Because the port above is allocated rather than fixed, your own dev
    // server on 5173 keeps running untouched.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

export default playwrightA11yConfig;
