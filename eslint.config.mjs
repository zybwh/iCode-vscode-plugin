// Promise-safety lint on top of `tsc`. Rules are limited to async correctness:
// a dropped promise hides failures in ACP calls, webview handlers and file I/O.
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "tests/**", "src/__tests__/**", "*.mjs"] },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: ["./tsconfig.json", "./tsconfig.webview.json"], tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: true }],
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false, attributes: false } }],
      "@typescript-eslint/await-thenable": "error",
    },
  },
);
