import { defineConfig } from 'tsup';
export default defineConfig({
  noExternal: [/^commander$/, /^@aws-sdk\//, /^@smithy\//, /^@easyaigc\/canvas-cli$/, /^open$/, /^ws$/, /^tslib$/],
  external: ['keytar', 'sharp'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; import { fileURLToPath as __fileURLToPath } from 'node:url'; import { dirname as __pathDirname } from 'node:path'; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __pathDirname(__filename);" },
});
