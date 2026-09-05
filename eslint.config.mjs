import { FlatCompat } from "@eslint/eslintrc";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: directory });

export default [
  {
    ignores: [
      ".next/**",
      "next-env.d.ts",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "tools/media-prototype/assets/livekit-client.umd.js",
      "tools/media-prototype/assets/hls.min.js",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
