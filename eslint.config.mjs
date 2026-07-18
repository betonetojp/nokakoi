import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        NostrTools: "readonly",
        qrcode: "readonly",
        __nostrState: "writable",
        __customEmojis: "writable"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "no-undef": "error",
      "no-empty": ["error", { "allowEmptyCatch": true }]
    }
  }
];
