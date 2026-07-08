// GENERATED verbatim from the reddoor-starter working tree (tests/smoke/*,
// playwright.config.ts). Byte-fidelity matters — the smoke spec + config are
// written into each site unchanged. Regenerate with scratchpad/gen-smoke-template.mjs
// if the starter's smoke suite changes. Do NOT hand-edit the string bodies.

export const SMOKE_ROUTES_RELATIVE = "tests/smoke/routes.ts";
export const SMOKE_ROUTES_TEMPLATE = `// Committed per-site smoke manifest. \`tests/smoke/pages.spec.ts\` iterates this
// list, asserting each route returns its expected status and paints a hydration
// marker with no console errors. This ships the SAFE DEFAULT every reddoor-starter
// clone inherits; each site's figma-slices build grows the list as real routes
// land (add \`{ path, name, hydrationMarker }\` entries).
//
// NOTE on the default \`/\` entry: it expects 200, which holds once the clone is
// wired to a real Prismic repo (getByUID("page","home") resolves). On the bare
// placeholder starter, \`/\` returns 404 (the Prismic lookup throws → error(404)),
// so the \`/\` case only goes green after Prismic is wired — by design, since the
// gate is about real site health. The hydration marker \`footer\` is the shared
// layout footer, present on every page including the error page.

export type SmokeRoute = {
  /** Route path to visit, e.g. "/" or "/about". */
  path: string;
  /** Human-readable label used in the test title. */
  name: string;
  /** CSS selector asserted visible after load (hydration proof). Default: skip. */
  hydrationMarker?: string;
  /** Expected HTTP status. Default: 200. */
  expectStatus?: number;
};

export const smokeRoutes: SmokeRoute[] = [
  { path: "/", name: "home", hydrationMarker: "footer" },
];
`;

export const SMOKE_SPEC_RELATIVE = "tests/smoke/pages.spec.ts";
export const SMOKE_SPEC_TEMPLATE = `import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";
import { smokeRoutes } from "./routes";

// Console messages we don't care about. Add patterns here only after seeing them
// in CI and confirming they aren't actionable. Patterns are matched against both
// the message text and the offending resource URL — Chromium's "Failed to load
// resource" text omits the URL, so URL matching catches third-party network noise.
const ALLOWED_CONSOLE_PATTERNS: RegExp[] = [
  // Vimeo iframe embeds + their CDN telemetry endpoints occasionally 403 from
  // cloud IPs due to bot detection.
  /vimeo/i,
  // Turnstile (Cloudflare) telemetry occasionally surfaces in console.
  /turnstile|challenges\\.cloudflare/i,
];

function attachConsoleWatcher(page: Page, extraAllowed: RegExp[] = []) {
  const errors: string[] = [];
  const allowed = [...ALLOWED_CONSOLE_PATTERNS, ...extraAllowed];
  const isAllowed = (s: string) => !!s && allowed.some((re) => re.test(s));

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    const url = msg.location()?.url ?? "";
    if (isAllowed(text) || isAllowed(url)) return;
    errors.push(\`[console.error] \${text}\${url ? \` (\${url})\` : ""}\`);
  });

  page.on("pageerror", (err) => {
    if (isAllowed(err.message)) return;
    errors.push(\`[pageerror] \${err.message}\`);
  });

  return errors;
}

for (const route of smokeRoutes) {
  test(\`\${route.path} (\${route.name}) loads with no console errors\`, async ({
    page,
  }) => {
    const errors = attachConsoleWatcher(page);
    const response = await page.goto(route.path, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status(), \`HTTP status for \${route.path}\`).toBe(
      route.expectStatus ?? 200,
    );
    if (route.hydrationMarker) {
      await expect(
        page.locator(route.hydrationMarker),
        \`hydration marker "\${route.hydrationMarker}" on \${route.path}\`,
      ).toBeVisible();
    }
    expect(errors, \`console errors on \${route.path}\`).toEqual([]);
  });
}

test("404 page renders the custom error component", async ({ page }) => {
  // The browser logs a top-level "Failed to load resource: 404" for the page
  // itself — expected on a 404 route, not a bug. Allow it here.
  const errors = attachConsoleWatcher(page, [/Failed to load resource.*404/i]);
  const response = await page.goto("/this-uid-does-not-exist", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(404);
  // src/routes/+error.svelte renders \`<h1>{page.status}</h1>\` → "404".
  await expect(page.getByText("404", { exact: false }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
`;

export const PLAYWRIGHT_CONFIG_RELATIVE = "playwright.config.ts";

/** The R1.1 config: reads REDDOOR_SMOKE_PORT and binds --strictPort. Written
 *  when a site has no playwright.config.ts. */
export const PLAYWRIGHT_CONFIG_TEMPLATE = `import { defineConfig } from "@playwright/test";
import base from "@reddoorla/maintenance/configs/playwright-a11y";

// Emulate reduced motion in tests: instant scrollIntoView (no long animated
// smooth-scroll that flakes Playwright's actionability checks under parallel
// load) and view transitions fall back to instant. Pairs with the
// prefers-reduced-motion gate on scroll-behavior in src/app.css.
//
// R1.1 (health-gate): the central \`smoke\` audit (reddoor-maintenance
// src/audits/smoke.ts) allocates a free port and passes it as
// REDDOOR_SMOKE_PORT so a zombie vite already squatting the default 5173 can't
// silently hijack the run and green a stale build. When it's set, bind vite to
// exactly that port with --strictPort (forwarded through \`npm run vite:dev\` so
// it stays portable across pnpm/npm) and aim Playwright's baseURL + readiness
// probe at it. Unset (local \`pnpm test:smoke\`) → the shared base's fixed 5173.
const smokePort = process.env.REDDOOR_SMOKE_PORT;

export default defineConfig({
  ...base,
  use: {
    ...base.use,
    reducedMotion: "reduce",
    ...(smokePort ? { baseURL: \`http://localhost:\${smokePort}\` } : {}),
  },
  ...(smokePort
    ? {
        webServer: {
          command: \`npm run vite:dev -- --port \${smokePort} --strictPort\`,
          url: \`http://localhost:\${smokePort}/dev/a11y-fixtures\`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      }
    : {}),
});
`;

/** The pre-R1.1 shared-base config (no port block). Used ONLY to recognize a
 *  site that adopted the shared base before R1.1, so it can be safely replaced
 *  wholesale with PLAYWRIGHT_CONFIG_TEMPLATE. Any other existing config is left
 *  untouched and flagged for manual patch. */
export const PLAYWRIGHT_CONFIG_PRE_R11 = `import { defineConfig } from "@playwright/test";
import base from "@reddoorla/maintenance/configs/playwright-a11y";

// Emulate reduced motion in tests: instant scrollIntoView (no long animated
// smooth-scroll that flakes Playwright's actionability checks under parallel
// load) and view transitions fall back to instant. Pairs with the
// prefers-reduced-motion gate on scroll-behavior in src/app.css.
export default defineConfig({
  ...base,
  use: { ...base.use, reducedMotion: "reduce" },
});
`;
