import type { Config } from "prettier";

export const prettierConfig: Config = {
  trailingComma: "all",
  singleQuote: false,
  printWidth: 100,
  plugins: ["prettier-plugin-svelte"],
  overrides: [{ files: "*.svelte", options: { parser: "svelte" } }],
};

export default prettierConfig;
