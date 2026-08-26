import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: {
    // tsup's TypeScript 6 declaration worker still injects deprecated baseUrl.
    compilerOptions: { ignoreDeprecations: "6.0" },
  },
  banner: {
    js: "#!/usr/bin/env node",
  },
});
