import adapter from "@sveltejs/adapter-netlify";

/**
 * The SvelteKit cockpit (#582), served by this site beside its Netlify
 * functions. The config sits at the repo root because the build runs here:
 * the Netlify adapter writes `.netlify/` (the render function) relative to the
 * build's working directory, and Netlify collects it from the root.
 * @type {import('@sveltejs/kit').Config}
 */
export default {
  kit: {
    adapter: adapter({ split: true }),
    files: { src: "cockpit/src" },
    outDir: "cockpit/.svelte-kit",
  },
};
