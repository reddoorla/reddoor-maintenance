import { createEslintConfig } from "@reddoorla/maintenance/configs/eslint";
import svelteConfig from "./svelte.config.js";

export default createEslintConfig({ svelteConfig });
