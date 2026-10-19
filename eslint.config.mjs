import js from "@eslint/js";
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
  {
    languageOptions: {
      globals: {
        ...globals.amd,
        ...globals.node,
      },
    },
  },
);
