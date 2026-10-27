import { createEslintConfig } from "@reddoorla/maintenance/configs/eslint";
import svelteConfig from "./sveltekit.config.js";

export default createEslintConfig({ svelteConfig });
