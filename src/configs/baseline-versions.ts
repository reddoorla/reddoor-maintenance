// Curated map of the framework deps reddoor sites should stay close to.
// Refreshed at each package release from reddoor-starter's package.json.
// Versions are caret ranges to mirror what `pnpm add` would produce.

export const baselineVersions: Record<string, string> = {
  // SvelteKit core
  svelte: "^5.55.5",
  "@sveltejs/kit": "^2.59.0",
  "@sveltejs/adapter-netlify": "^6.0.4",
  "@sveltejs/adapter-auto": "^7.0.0",
  "@sveltejs/vite-plugin-svelte": "^7.0.0",
  "svelte-check": "^4.4.7",

  // Build tooling
  vite: "^8.0.10",
  vitest: "^4.1.1",
  typescript: "^6.0.3",

  // Tailwind 4
  tailwindcss: "^4.0.14",
  "@tailwindcss/vite": "^4.3.0",

  // Prismic
  "@prismicio/client": "^7.3.1",
  "@prismicio/svelte": "^2.0.0",
  "@slicemachine/adapter-sveltekit": "^0.3.36",
  "slice-machine-ui": "^2.11.1",

  // Test tooling
  "@playwright/test": "^1.59.1",
  "@axe-core/playwright": "^4.11.3",
  "@lhci/cli": "^0.15.1",

  // Lint
  eslint: "^10.3.0",
  "eslint-plugin-svelte": "^3.1.0",
  "eslint-config-prettier": "^10.1.1",
  prettier: "^3.1.1",
  "prettier-plugin-svelte": "^3.2.6",
  "typescript-eslint": "^8.59.1",
  "@eslint/js": "^10.0.1",
  globals: "^17.6.0",

  // Misc
  "@lucide/svelte": "^1.14.0",
  "@zerodevx/svelte-img": "^2.1.2",
};

export default baselineVersions;
