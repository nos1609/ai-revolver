import chalk from "chalk";

// eslint-disable-next-line no-control-regex -- ANSI escape sequence detection for terminal width calculation
const ANSI_RE = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const DEFAULT_TERMINAL_WIDTH = 100;
const MAX_TABLE_WIDTH = 120;
const MIN_TABLE_WIDTH = 44;

export interface TableColumn {
  key: string;
  header: string;
  min: number;
  max?: number;
  priority?: number;
}

export interface TableCell {
  text: string;
  color?: (s: string) => string;
}

export type TableRow = Record<string, string | TableCell>;

export interface RenderTableOptions {
  indent?: string;
  width?: number;
  header?: boolean;
  separator?: boolean;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export function visibleWidth(text: string): number {
  let width = 0;
  const plain = stripAnsi(text);

  for (let i = 0; i < plain.length; i++) {
    const code = plain.charCodeAt(i);
    if (code === 0xfe0f) continue;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < plain.length) {
      const next = plain.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        width += 2;
        i++;
        continue;
      }
    }
    if (code >= 0x2600 && code <= 0x27bf) {
      width += 2;
      continue;
    }
    width++;
  }

  return width;
}

export function terminalWidth(): number {
  const columns = process.stdout.columns;
  if (!columns || !Number.isFinite(columns)) return DEFAULT_TERMINAL_WIDTH;
  return Math.max(MIN_TABLE_WIDTH, Math.min(MAX_TABLE_WIDTH, columns));
}

export function clipText(text: string, width: number): string {
  if (width <= 0) return "";
  if (visibleWidth(text) <= width) return text;
  if (width === 1) return "…";

  let out = "";
  let used = 0;
  const plain = stripAnsi(text);
  for (let i = 0; i < plain.length; i++) {
    const char = plain[i] ?? "";
    const code = plain.charCodeAt(i);
    let next = char;
    let charWidth = 1;

    if (code === 0xfe0f) continue;
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < plain.length) {
      const nextCode = plain.charCodeAt(i + 1);
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        next = plain.slice(i, i + 2);
        charWidth = 2;
        i++;
      }
    } else if (code >= 0x2600 && code <= 0x27bf) {
      charWidth = 2;
    }

    if (used + charWidth > width - 1) break;
    out += next;
    used += charWidth;
  }

  return `${out}…`;
}

export function fitText(text: string, width: number, color?: (s: string) => string): string {
  const clipped = clipText(text, width);
  const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  return `${color ? color(clipped) : clipped}${padding}`;
}

export function tableWidths(columns: TableColumn[], rows: TableRow[], width = terminalWidth(), indent = "  "): number[] {
  const gutters = Math.max(0, columns.length - 1) * 2;
  const available = Math.max(1, width - visibleWidth(indent) - gutters);

  const widths = columns.map((column) => {
    const content = rows.reduce((max, row) => {
      const cell = normalizeCell(row[column.key]);
      return Math.max(max, visibleWidth(cell.text));
    }, visibleWidth(column.header));
    return Math.max(column.min, Math.min(column.max ?? content, content));
  });

  let total = widths.reduce((sum, value) => sum + value, 0);
  if (total > available) {
    const order = columns
      .map((column, index) => ({ index, priority: column.priority ?? 0 }))
      .sort((a, b) => a.priority - b.priority);

    while (total > available) {
      const candidate = order.find(({ index }) => widths[index] > columns[index].min);
      if (!candidate) break;
      widths[candidate.index]--;
      total--;
    }
  }

  return widths;
}

export function renderTable(
  columns: TableColumn[],
  rows: TableRow[],
  options: RenderTableOptions = {},
): string[] {
  const indent = options.indent ?? "  ";
  const widths = tableWidths(columns, rows, options.width ?? terminalWidth(), indent);
  const lines: string[] = [];

  if (options.header !== false) {
    lines.push(renderCells(columns.map((column) => ({ text: column.header, color: chalk.bold })), widths, indent));
  }
  if (options.separator) {
    lines.push(chalk.dim(`${indent}${widths.map((width) => "─".repeat(width)).join("  ")}`));
  }

  for (const row of rows) {
    lines.push(renderCells(columns.map((column) => normalizeCell(row[column.key])), widths, indent));
  }

  return lines;
}

export function renderCells(cells: TableCell[], widths: number[], indent = "  "): string {
  return `${indent}${cells.map((cell, index) => fitText(cell.text, widths[index] ?? 0, cell.color)).join("  ")}`;
}

function normalizeCell(cell: string | TableCell | undefined): TableCell {
  if (!cell) return { text: "" };
  return typeof cell === "string" ? { text: cell } : cell;
}
