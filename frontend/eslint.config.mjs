import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // No native browser dialogs in the back office / POS (owner 2026-11-17: the desktop app could not type the cancel
  // reason of an online order after a native confirm). The customer shop (/shop, phones) is not affected.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/app/shop/**"],
    rules: {
      "no-restricted-globals": ["error", ...["prompt", "confirm", "alert"].map((name) => ({ name, message: "Use askReason() / askConfirm() (lib/ask-dialog.ts) or <ReasonDialog>: Electron throws on prompt(), and after a native confirm()/alert() the desktop app stops passing keystrokes to the page." }))],
      "no-restricted-properties": ["error", ...["prompt", "confirm", "alert"].map((property) => ({ object: "window", property, message: "Use askReason() / askConfirm() (lib/ask-dialog.ts) or <ReasonDialog>: Electron throws on prompt(), and after a native confirm()/alert() the desktop app stops passing keystrokes to the page." }))],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
