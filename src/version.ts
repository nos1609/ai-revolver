import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function packageVersion(): string {
  const metadata = require("../package.json") as { version?: unknown };
  if (typeof metadata.version !== "string" || metadata.version.trim() === "") {
    throw new Error("package.json does not declare a valid version");
  }
  return metadata.version;
}
