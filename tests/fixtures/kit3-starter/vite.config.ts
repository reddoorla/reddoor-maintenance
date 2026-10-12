import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";
import kitConfig from "./sveltekit.config.js";

export default defineConfig({ plugins: [sveltekit(kitConfig)] });
