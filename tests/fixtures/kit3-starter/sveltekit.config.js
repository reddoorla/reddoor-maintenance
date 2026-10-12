import { readFileSync } from "node:fs";
import adapter from "@sveltejs/adapter-netlify";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";
import { SVELTE_EVENT_REPLAY_HASH } from "@reddoorla/maintenance/configs/svelte";

const prismicConfig = JSON.parse(
  readFileSync(new URL("./prismic.config.json", import.meta.url), "utf-8"),
);
const PLACEHOLDER_SENTINEL = "your-prismic-repo-name";
const prismicRepository = process.env.VITE_PRISMIC_ENVIRONMENT || prismicConfig.repositoryName;
const isPlaceholderRepo = prismicRepository === PLACEHOLDER_SENTINEL;
if (!/^[a-z0-9][a-z0-9-]*$/i.test(prismicRepository)) {
  throw new Error(
    `Prismic repository name ${JSON.stringify(prismicRepository)} is not a repository name; ` +
      "it is written into the CSP frame-src, so it must be letters, digits and hyphens only.",
  );
}

// The env-var route to the sentinel is a LOCAL-ONLY hatch (#120). Set in CI
// or on Netlify it makes `entries()` return [] so `/` is never prerendered,
// then tolerates the resulting 404s — a green build with no home page, from a
// variable that is invisible in the diff and persists indefinitely. Refuse it
// at module load so the failure is loud at the point someone reaches for it.
// The sentinel IN prismic.config.json is untouched: that is the
// documented fresh-clone state, and it is visible in the repo.
// Mirrored in tests/smoke/routes.ts, which reads the same variable.
if (
  process.env.VITE_PRISMIC_ENVIRONMENT === PLACEHOLDER_SENTINEL &&
  (process.env.CI || process.env.NETLIFY)
) {
  throw new Error(
    `VITE_PRISMIC_ENVIRONMENT=${PLACEHOLDER_SENTINEL} is a local-only hatch and is set in ` +
      "CI/Netlify: it would green a deploy that emits no home page (every Prismic route " +
      "prerenders as a tolerated 404). Unset it there; a site whose Prismic repository is " +
      "not ready should stay red, or keep the sentinel in prismic.config.json.",
  );
}

// VITE_REDDOOR_GATE_FIXTURES=1 builds the /dev fixtures into the bundle, for
// the a11y gate's own build and nothing else (src/routes/dev/+layout.server.ts,
// reddoor-maintenance#948). Set on Netlify it would deploy them, so refuse it
// there, at module load, the same way as the hatch above.
if (process.env.VITE_REDDOOR_GATE_FIXTURES && process.env.NETLIFY) {
  throw new Error(
    "VITE_REDDOOR_GATE_FIXTURES is set on Netlify: it builds the /dev fixtures into the " +
      "deployed site. It belongs to the a11y gate's own build (reddoor-maint audit) only. " +
      "Unset it in the Netlify environment.",
  );
}

// Netlify sets URL to the site's production origin during a build, and
// prerendered pages bake it into canonical and og:url. Kit 2 took it as
// `prerender.origin`. Kit 3 removed that for `paths.origin`, which also
// becomes the ONLY origin the CSRF check accepts a form POST from (kit 2
// compared with the request's own host). Set, the contact form answered 403 on
// a Netlify domain alias, and on a custom domain attached after the last build
// until the next deploy (measured on a built server, reddoor-starter#187). So
// it is not set: kit keeps its "http://sveltekit-prerender" placeholder and the
// per-host CSRF check, and vite.config.ts hands this origin to $lib/seo, which
// puts it in place of the placeholder. Local builds set no URL and keep the
// placeholder, which only shows up in build/ output, never in dev.
// robots.txt and sitemap.xml are NOT prerendered: they must answer per host,
// so the netlify.app mirror can differ from the real domain (#140).
/** @param {string | undefined} value */
const originOf = (value) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
};
export const productionOrigin = originOf(process.env.URL) ?? null;

// SvelteKit 3 refuses `svelte.config.js` (`config_file_unsupported`): its
// configuration is passed to the `sveltekit(...)` plugin in vite.config.ts,
// and kit's options are top-level there, with no `kit` namespace. This object
// is that argument. It lives in its own module, not inline in vite.config.ts,
// because eslint.config.js, the privacy-services plugin and the CSP and hatch
// tests read the same object, and they import it with a bare `node` (no Vite).
/** @type {import('@sveltejs/kit/vite').Config} */
const config = {
  compilerOptions: {
    warningFilter: (warning) => warning.code !== "element_invalid_self_closing_tag",
  },
  adapter: adapter(),
  // Until a clone is wired to a real Prismic repo, every Prismic-backed
  // route returns 404 during prerender. Tolerate that on the placeholder
  // so `pnpm build` (and Netlify CI) succeed; real sites still fail loudly
  // because `repositoryName` no longer matches the sentinel.
  prerender: {
    handleHttpError: ({ path, status, message, referrer }) => {
      if (isPlaceholderRepo && status === 404) {
        return;
      }
      throw new Error(
        `${status} ${path}${referrer ? ` (linked from ${referrer})` : ""}: ${message}`,
      );
    },
    // A malformed URL in CMS-pasted rich text (e.g. a school name typed into a
    // hyperlink) is unparseable — it can never be a real route to crawl, and
    // one editor's typo must not fail the whole build. Warn (so it surfaces
    // for cleanup) and keep prerendering. Unlike handleHttpError's fail-loud
    // 404 policy, an invalid URL has no valid interpretation to preserve.
    handleInvalidUrl: ({ href, referrer, message }) => {
      console.warn(
        `[prerender] skipped invalid URL ${JSON.stringify(href)}` +
          `${referrer ? ` (linked from ${referrer})` : ""} — fix the CMS link` +
          `${message ? ` [${message}]` : ""}`,
      );
    },
  },
  // `alias` is deprecated in kit 3 (a build warning) in favour of package.json
  // subpath imports (`#lib`), and kit 3 no longer provides `$lib` itself. The
  // `$lib` entries keep every existing import working; moving the fleet to
  // `#lib` is a separate codemod (reddoor-maintenance P1-45's plan).
  alias: {
    $lib: "src/lib",
    "$lib/*": "src/lib/*",
    $components: "src/lib/components",
    "$components/*": "src/lib/components/*",
    $utils: "src/lib/utils",
    "$utils/*": "src/lib/utils/*",
    $stores: "src/lib/stores",
    "$stores/*": "src/lib/stores/*",
    $assets: "src/lib/assets",
    "$assets/*": "src/lib/assets/*",
  },
  // Baseline CSP for Prismic + Vimeo + Turnstile + Google Fonts. EXTEND PER
  // PROJECT — every new host (a Typekit kit, YouTube, a donation platform,
  // analytics, Maps) must be added to the relevant directive or the browser
  // blocks it silently. SvelteKit adds nonces for the inline scripts it emits;
  // styles are covered by 'unsafe-inline' below, which is LOAD-BEARING: the
  // template sets style attributes (ContentBand's fallback height, the
  // animate-in transitions, app.html) and a nonce never authorises a style
  // *attribute* — removing it silently breaks those in production only.
  csp: {
    mode: "auto",
    // Violations POST to /api/csp-report. To stage a stricter policy without
    // blocking, copy `directives` below into a sibling `reportOnly: { ... }`
    // block — SvelteKit will then emit a Content-Security-Policy-Report-Only
    // header alongside the enforced one.
    directives: {
      "default-src": ["self"],
      "object-src": ["none"],
      "script-src": [
        "self",
        "https://static.cdn.prismic.io",
        "https://prismic.io/prismic-toolbar/",
        "https://html2canvas.hertzen.com/dist/html2canvas.min.js",
        "https://player.vimeo.com",
        // Svelte 5 server-renders `onload="this.__e=event"` (and onerror) on
        // every element carrying an attribute spread — i.e. every
        // `<img {...getImageProps(field)} />` the Prismic helpers produce.
        // It is the replay stub for a load/error that fires before hydration.
        // A nonce NEVER covers an event-handler attribute, so without both of
        // the entries below the browser refuses to run it: the pre-hydration
        // load is dropped (anything keyed on it can strand) and one violation
        // is POSTed to /api/csp-report per image per page view — 12 on `/`
        // alone, measured on beachfront-dentistry 2026-08-13 — burying real
        // violations. 'unsafe-hashes' widens hash matching to event handlers
        // and NOTHING else, so only this exact one-liner is permitted; pair it
        // with 'unsafe-inline' and that guarantee is gone (scripts/csp-policy.test.ts
        // asserts we do not). The hash is imported, never transcribed: the
        // stub's text is upstream's to change, and a copied string cannot be
        // told apart from a stale one.
        //
        // Both entries sit in script-src to match the shared baseline in
        // @reddoorla/maintenance/configs/svelte (verified there in Chrome,
        // 2026-08-17). This file overrides script-src wholesale, so it has to
        // carry them itself.
        //
        // This comment used to say the `script-src-attr` form (vida-legacy-
        // foundation's) was avoided because Safari ignores that directive and
        // falls back to script-src. That was asserted without a measurement
        // (#132), and a measurement refuted it (2026-09-16, re
        // vida-legacy-foundation#79): Playwright's WebKit 26.5 and Chromium
        // 151 behaved identically. Handler ran / blocked, WebKit / Chromium:
        //   vida's served policy (allowance in script-src-attr)   ran / ran
        //   the same policy minus script-src-attr                 blocked / blocked
        //   control, no allowance                                 blocked / blocked
        //   control, 'unsafe-hashes' + hash in script-src         ran / ran
        // So WebKit honours script-src-attr, and both forms work in both
        // engines. Caveat: that is Playwright's WebKit build, not a shipping
        // Safari.app. The form here is a consistency choice, not a Safari
        // workaround.
        "unsafe-hashes",
        SVELTE_EVENT_REPLAY_HASH,
        // Cloudflare Turnstile contact-form widget (enable via PUBLIC_TURNSTILE_SITE_KEY).
        "https://challenges.cloudflare.com",
      ],
      // Google Fonts stylesheet host (paired with fonts.gstatic.com under
      // font-src). Self-hosted fonts need nothing extra.
      "style-src": ["self", "unsafe-inline", "https://fonts.googleapis.com"],
      "img-src": ["self", "data:", "https://*.prismic.io"],
      // Prismic hosts non-image media (e.g. .mp4 assets) on
      // <repo>.cdn.prismic.io — first-party content, same origin family as
      // images.prismic.io already allowed under img-src.
      "media-src": ["self", "https://*.vimeocdn.com", "https://*.prismic.io"],
      "frame-src": [
        "self",
        `https://${prismicRepository}.prismic.io`,
        "https://player.vimeo.com",
        // Cloudflare Turnstile renders its challenge in an iframe from this host.
        "https://challenges.cloudflare.com",
      ],
      "connect-src": ["self", "https://*.prismic.io"],
      "font-src": ["self", "data:", "https://fonts.gstatic.com"],
      "base-uri": ["self"],
      "form-action": ["self"],
      "frame-ancestors": ["self"],
      // report-uri is deprecated in favour of report-to, but Firefox still
      // honours only report-uri and SvelteKit exposes no report-to hook.
      "report-uri": ["/api/csp-report"],
    },
  },
  preprocess: vitePreprocess(),
};

export default config;
