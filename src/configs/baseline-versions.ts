// Curated map of the framework deps reddoor sites should stay close to.
// Refreshed at each package release from reddoor-starter's package.json.
// Versions are caret ranges to mirror what `pnpm add` would produce.

export const baselineVersions: Record<string, string> = {
  // SvelteKit core
  svelte: "^5.55.10",
  "@sveltejs/kit": "^2.61.1",
  "@sveltejs/adapter-netlify": "^6.0.4",
  "@sveltejs/adapter-auto": "^7.0.1",
  "@sveltejs/vite-plugin-svelte": "^7.1.2",
  "svelte-check": "^4.4.8",

  // Build tooling
  vite: "^8.0.14",
  vitest: "^4.1.7",
  typescript: "^6.0.3",

  // Tailwind 4
  tailwindcss: "^4.3.0",
  "@tailwindcss/vite": "^4.3.0",

  // Prismic
  "@prismicio/client": "^7.21.8",
  "@prismicio/svelte": "^2.2.1",
  "@slicemachine/adapter-sveltekit": "^0.3.96",
  "slice-machine-ui": "^2.21.3",

  // Test tooling
  "@playwright/test": "^1.60.0",
  "@axe-core/playwright": "^4.11.3",
  "@lhci/cli": "^0.15.1",

  // Lint
  eslint: "^10.4.0",
  "eslint-plugin-svelte": "^3.18.0",
  "eslint-config-prettier": "^10.1.8",
  prettier: "^3.8.3",
  "prettier-plugin-svelte": "^4.0.1",
  "typescript-eslint": "^8.60.0",
  "@eslint/js": "^10.0.1",
  globals: "^17.6.0",

  // Misc
  "@lucide/svelte": "^1.17.0",
  "@zerodevx/svelte-img": "^2.1.2",
};

export default baselineVersions;
