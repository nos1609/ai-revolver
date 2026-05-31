/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  testRunner: "vitest",
  appendPlugins: ["@stryker-mutator/vitest-runner"],
  // Mutate focused logic plus migration orchestration covered by unit tests.
  // Wave: expanding gradually as B-cleaned files (grab, lock, registry) gain tests.
  mutate: [
    "src/i18n.ts",
    "src/vault/crypto.ts",
    "src/vault/encrypted-file.ts",
    "src/vault/migrate.ts",
    "src/commands/vault.ts",
    "src/commands/grab.ts",
    "src/core/export.ts",
    "src/core/lock.ts",
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
