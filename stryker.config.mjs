/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: "vitest",
  appendPlugins: ["@stryker-mutator/vitest-runner"],
  // Mutate only pure-logic modules with tests. Don't waste cycles on
  // I/O-heavy command handlers until their tests catch up.
  mutate: [
    "src/i18n.ts",
    "src/vault/crypto.ts",
    "src/core/export.ts",
    "src/core/usage.ts",
  ],
  ignorePatterns: [
    "dist/**",
    "docs/**",
    "providers/**",
    "tmp/**",
    "local/**",
    "scripts/**",
  ],
  reporters: ["clear-text", "progress"],
  coverageAnalysis: "off",
  disableTypeChecks: false,
  concurrency: 2,
  tempDirName: "tmp/stryker-tmp",
  vitest: {
    configFile: "vitest.config.ts",
  },
};

export default config;
