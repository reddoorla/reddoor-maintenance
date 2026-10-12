import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";
import { imagetools } from "@zerodevx/svelte-img/vite";
import tailwindcss from "@tailwindcss/vite";
import { privacyServices } from "./scripts/privacy-services.ts";
import { prismicBarrel } from "./scripts/prismic-barrel.ts";
import kitConfig from "./sveltekit.config.js";

export default defineConfig({
  // SvelteKit 3 takes its configuration here, not from svelte.config.js
  // (which it refuses to start beside). The object lives in sveltekit.config.js
  // so eslint, the privacy-services plugin and the tests read the same one.
  plugins: [sveltekit(kitConfig), imagetools(), tailwindcss(), privacyServices(), prismicBarrel()],
  server: {
    fs: {
      // Allow access to files from the project root.
      allow: [".."],
    },
  },
  test: {
    environment: "jsdom",
    // scripts/ too: the capability index and its prompt hook live there, and a
    // repo-invariant test that never runs is a comment.
    include: ["src/**/*.test.{js,ts}", "scripts/**/*.test.{js,ts}"],
    setupFiles: ["./vitest-setup.ts"],
    server: {
      deps: {
        inline: ["@testing-library/svelte"],
      },
    },
  },
  resolve: process.env.VITEST ? { conditions: ["browser"] } : undefined,
});
