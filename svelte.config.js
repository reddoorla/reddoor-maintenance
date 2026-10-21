import adapter from "@sveltejs/adapter-netlify";

/**
 * The SvelteKit cockpit (#582), served by this site beside its Netlify
 * functions. The config sits at the repo root because the build runs here:
 * the Netlify adapter writes `.netlify/` (the render function) relative to the
 * build's working directory, and Netlify collects it from the root.
 *
 * `svelte-kit sync`, and so every `pnpm cockpit:build` in CI, therefore warns
 * that the root tsconfig.json should extend
 * ./cockpit/.svelte-kit/tsconfig.json. That is expected and stays: the root
 * tsconfig is the Node package's and deliberately does not extend SvelteKit's;
 * cockpit/tsconfig.json is the one that extends it (#1578).
 * @type {import('@sveltejs/kit').Config}
 */
export default {
  kit: {
    adapter: adapter({ split: true }),
    files: { src: "cockpit/src" },
    outDir: "cockpit/.svelte-kit",
  },
};
