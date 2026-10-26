import adapter from "@sveltejs/adapter-netlify";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

/**
 * The SvelteKit cockpit (#582), served by this site beside its Netlify
 * functions. SvelteKit 3 refuses `svelte.config.js` (config_file_unsupported)
 * and takes its options here, top-level with no `kit` namespace. This file
 * sits at the repo root because the build runs here: the Netlify adapter
 * writes `.netlify/` (the render function) relative to the build's working
 * directory, and Netlify collects it from the root.
 *
 * It is not named `vite.config.ts`, so `svelte-kit sync` does not find it on
 * its own: with no `--config` it resolves Vite's defaults and writes
 * `./.svelte-kit` for a `src/` app that does not exist, with no error. Every
 * sync goes through `pnpm cockpit:sync`, which passes it (tests/ci-gate.test.ts).
 *
 * `split: false` makes the whole app one function, `sveltekit-render` on `/*`:
 * the pages and the dashboard's `/api/*` and `/auth/*` endpoints. With
 * `split: true` each page was its own function of about 16 MB that
 * cold-started separately, and endpoints are routes here so that the site
 * declares few enough rate-limit rules for any of them to apply (maintenance#1642).
 *
 * The root tsconfig.json is the Node package's and deliberately does not
 * extend SvelteKit's; cockpit/tsconfig.json is the one that extends it (#1578).
 */
export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter({ split: false, publish: "cockpit/build" }),
      files: { src: "cockpit/src" },
      // SvelteKit's own origin check ("Cross-site POST form submissions are
      // forbidden") would sit in front of the `/api/*` and `/auth/*` routes and
      // refuse a form-typed POST with no Origin, which the old functions took.
      // It stays off: the hook runs `isCsrfAllowed` on every page POST, and each
      // state-changing endpoint runs it itself (maintenance#1642).
      csrf: { trustedOrigins: ["*"] },
      outDir: "cockpit/.svelte-kit",
    }),
  ],
});
