import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
<<<<<<< HEAD

    coverage: {
      provider: "v8",
      // Coverage is opt-in via `vitest --coverage` or `npm run coverage`.
      // Keeping it disabled by default keeps `npm test` fast.
      enabled: false,
      reporter: ["text", "json", "html"],
      reportsDirectory: "reports/coverage",

      // Reasonable starting strict thresholds after the quality wave.
      // Will be raised over time as tests improve.
      thresholds: {
        statements: 55,
        lines: 55,
        branches: 70,
        functions: 62,
      },

      // Exclude platform-specific and hard-to-test files.
      exclude: [
        "**/node_modules/**",
        "dist/**",
        "scripts/**",
        "**/*.config.*",
        "src/vault/keyring-*.ts",
        "src/vault/store.ts",
        "src/index.ts",
        "src/types/index.ts",
        "tests/**",
      ],
    },
  },
});
