export function pathSegments(path: string): string[] {
  const segments: string[] = [];
  let i = 0;

  while (i < path.length) {
    if (path[i] === ".") {
      i++;
      continue;
    }

    if (path[i] === "[") {
      const quote = path[i + 1];
      if (quote !== "'" && quote !== "\"") {
        throw new Error(`Invalid bracket path segment in "${path}"`);
      }
      let j = i + 2;
      let value = "";
      let escaped = false;
      while (j < path.length) {
        const ch = path[j];
        if (escaped) {
          value += ch;
          escaped = false;
          j++;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          j++;
          continue;
        }
        if (ch === quote) {
          break;
        }
        value += ch;
        j++;
      }
      if (path[j] !== quote || path[j + 1] !== "]") {
        throw new Error(`Unterminated bracket path segment in "${path}"`);
      }
      segments.push(value);
      i = j + 2;
      continue;
    }

    let j = i;
    while (j < path.length && path[j] !== "." && path[j] !== "[") j++;
    segments.push(path.slice(i, j));
    i = j;
  }

  return segments.filter(Boolean);
}
