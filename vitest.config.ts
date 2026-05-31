import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    coverage: {
      // Wave prep: thresholds will be raised iteratively (statements/lines first,
      // then branches ~65-70+, functions). Enabled only via `vitest --coverage`
      // or the future "check:full" script. Excludes keep platform/keyring noise out.
      enabled: false,
      provider: "v8",
      reportsDirectory: "reports/coverage",
      reporter: ["text", "html", "json"],
      // Starter numbers — will be bumped in subsequent wave steps once baseline is green.
      thresholds: {
        statements: 58,
        lines: 58,
        branches: 62,
        functions: 65,
      },
      exclude: [
        "src/platform/keyring-*.ts",
        "src/scripts/**",
        "tests/**",
      ],
    },
  },
});
