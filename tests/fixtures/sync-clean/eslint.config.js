import { createEslintConfig } from "@reddoor/maintenance/configs/eslint";
import svelteConfig from "./svelte.config.js";

export default createEslintConfig({ svelteConfig });
