import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import pluginVue from "eslint-plugin-vue";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    ".claude/",
    "artifacts/",
    "build/",
    "chrome/",
    "css/",
    "dist/",
    "edge/",
    "firefox/",
    "release/",
    "scripts/",
    "src/test/",
    "test/",
    "web-ext-artifacts/",
    "webpack.config.js",
    "webpack.dev.js",
    "webpack.prod.js",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  pluginVue.configs["flat/recommended-error"],
  {
    languageOptions: {
      globals: {
        ...globals.amd,
        ...globals.node,
      },
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
    rules: {
      ...tseslint.configs.eslintRecommended.rules,
      "vue/multi-word-component-names": [
        "error",
        { ignores: ["Import", "Options", "Popup"] },
      ],
      "vue/no-mutating-props": ["error", { shallowOnly: true }],
    },
  },
  prettier,
);
