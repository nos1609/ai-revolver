import chalk from "chalk";
import { describe, expect, it } from "vitest";
import { clipText, renderTable, stripAnsi, tableWidths, visibleWidth } from "../../src/ui/table.js";

describe("tui table helpers", () => {
  it("measures colored text by visible width", () => {
    const text = chalk.green("codex");

    expect(stripAnsi(text)).toBe("codex");
    expect(visibleWidth(text)).toBe(5);
  });

  it("clips long text with an ellipsis", () => {
    expect(clipText("very-long-profile-name", 10)).toBe("very-long…");
  });

  it("shrinks low-priority columns to fit narrow terminals", () => {
    const columns = [
      { key: "name", header: "PROFILE", min: 6, max: 20, priority: 0 },
      { key: "provider", header: "PROVIDER", min: 8, max: 16, priority: 1 },
      { key: "created", header: "CREATED", min: 10, max: 10, priority: 9 },
    ];
    const rows = [
      { name: "very-long-profile-name", provider: "anthropic", created: "2026-04-29" },
    ];

    expect(tableWidths(columns, rows, 32, "  ")).toEqual([7, 9, 10]);
  });

  it("renders lines within the requested width", () => {
    const lines = renderTable(
      [
        { key: "name", header: "PROFILE", min: 6, max: 20, priority: 0 },
        { key: "status", header: "STATUS", min: 6, max: 20, priority: 1 },
      ],
      [{ name: "very-long-profile-name", status: { text: "stale", color: chalk.yellow } }],
      { width: 28 },
    );

    expect(lines.every((line) => visibleWidth(line) <= 28)).toBe(true);
    expect(stripAnsi(lines.at(-1) ?? "")).toContain("…");
  });
});
