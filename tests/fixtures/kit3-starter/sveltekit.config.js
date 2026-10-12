// The shape reddoor-starter ships since P1-45 (reddoor-starter#187): kit 3's
// options, top-level, passed to sveltekit(...) by vite.config.ts. Trimmed to
// what sync-configs reads; the starter's own file also carries the CSP,
// prerender policy and Netlify origins.
import adapter from "@sveltejs/adapter-netlify";

/** @type {import('@sveltejs/kit/vite').Config} */
const config = {
  adapter: adapter(),
  alias: { $lib: "src/lib", "$lib/*": "src/lib/*" },
};

export default config;
