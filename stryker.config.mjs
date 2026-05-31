/**
 * Stryker Mutator configuration for ai-revolver.
 *
 * Mutation testing strategy:
 * - We deliberately do NOT mutate the entire codebase (too slow and noisy).
 * - We only target the most critical, high-risk modules that have solid tests.
 * - Priority: security, data integrity, locking, identity/satellite logic,
 *   and complex stateful commands.
 *
 * This helps catch "govnokod" that normal tests miss (especially after big merges).
 *
 * Commands:
 *   npm run test:mutation          # full focused mutation run
 *   npm run test:mutation:html     # generate nice HTML report
 *
 * Full quality gate (recommended before push):
 *   npm run check          # lint (--max-warnings=0) + type-check + test
 *
 * Mutation testing (enforces thresholds below):
 *   npm run test:mutation
 */
export default {
  // Test runner
  testRunner: "vitest",
  appendPlugins: [
    "@stryker-mutator/vitest-runner",
    "@stryker-mutator/typescript-checker",
  ],

  // Focused mutation on high-risk areas. Expanded during quality work.
  mutate: [
    "src/i18n.ts",
    "src/vault/crypto.ts",
    "src/vault/encrypted-file.ts",
    "src/vault/migrate.ts",
    "src/commands/vault.ts",
    "src/core/identity.ts",
    "src/core/lock.ts",
    "src/core/satellite.ts",
    "src/core/registry.ts",
    "src/providers/loader.ts",
    "src/commands/grab.ts",
    "src/commands/switch.ts",
    "src/commands/sync.ts",
    "src/core/usage.ts",
    "src/core/export.ts",
  ],

  // We don't need to copy these into the mutation sandbox
  ignorePatterns: [
    "dist/**",
    "docs/**",
    "tmp/**",
    "local/**",
    "scripts/**",
    "reports/**",
    // Note: providers/ is intentionally NOT ignored because some usage tests load the YAML files directly
  ],

  // Reporters
  reporters: ["clear-text", "progress", "html", "json"],

  // Where to put the HTML report
  htmlReporter: {
    fileName: "reports/mutation/mutation.html",
  },

  jsonReporter: {
    fileName: "reports/mutation/mutation.json",
  },

  // Performance & correctness settings
  coverageAnalysis: "off", // Vitest + Stryker works better with this off
  disableTypeChecks: false,
  concurrency: 2, // Keep low on developer machines

  // Use our existing Vitest config
  vitest: {
    configFile: "vitest.config.ts",
  },

  // Enable TypeScript checker for better mutant killing on type-level issues
  checkers: ["typescript"],

  // Temporary working directory
  tempDirName: "tmp/stryker-tmp",

  // Useful for CI later (can be overridden via --incremental)
  // incremental: true,
  // incrementalFile: "reports/stryker-incremental.json",

  /**
   * Mutation score thresholds (enforced when running `npm run test:mutation`).
   *
   * Current baseline (May 2026): 49.12%
   *
   * "Нормальное" жёсткое покрытие:
   * - break: 45   → mutation run fails if score drops below this (safety floor)
   * - low: 55     → warning zone
   * - high: 70    → target we should aim for on the focused critical files
   *
   * We will gradually raise these as we improve tests.
   */
  thresholds: {
    high: 70,
    low: 55,
    break: 45,
  },
};
