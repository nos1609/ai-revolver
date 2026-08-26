import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requiredFiles = [
  "README.md",
  "README.en.md",
  "CONTRIBUTING.md",
  "CONTRIBUTING.en.md",
  "SECURITY.md",
  "LICENSE",
  "docs/README.md",
  "docs/DOCUMENTATION_STANDARD.md",
  "docs/architecture/overview.md",
  "docs/operations/profile-lifecycle.md",
  "docs/security.md",
  "docs/troubleshooting.md",
  "docs/releasing.md",
  "docs/source-attribution.md",
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(path.join(root, file))) failures.push(`${file}: required file is missing`);
}

const activeMarkdown = requiredFiles.filter((file) => file.endsWith(".md"));
const linkPattern = /!?\[[^\]]*\]\(([^)]+)\)/g;

for (const file of activeMarkdown) {
  const absolute = path.join(root, file);
  if (!existsSync(absolute)) continue;
  const content = readFileSync(absolute, "utf8");
  let inMermaid = false;

  for (const [index, line] of content.split(/\r?\n/).entries()) {
    if (/^```mermaid\s*$/.test(line)) {
      if (inMermaid) failures.push(`${file}:${index + 1}: nested Mermaid fence`);
      inMermaid = true;
    } else if (inMermaid && /^```\s*$/.test(line)) {
      inMermaid = false;
    }
  }
  if (inMermaid) failures.push(`${file}: unclosed Mermaid fence`);

  for (const match of content.matchAll(linkPattern)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    target = target.split(/\s+["']/)[0];
    if (/^(?:https?:|mailto:|#)/i.test(target)) continue;
    if (target.startsWith("/")) {
      failures.push(`${file}: absolute Markdown link is not portable: ${target}`);
      continue;
    }

    const localPath = target.split("#", 1)[0];
    if (!localPath) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(localPath);
    } catch {
      failures.push(`${file}: invalid URL encoding in link: ${target}`);
      continue;
    }
    const resolved = path.resolve(path.dirname(absolute), decoded);
    if (!resolved.startsWith(`${root}${path.sep}`) && resolved !== root) {
      failures.push(`${file}: link escapes repository: ${target}`);
    } else if (!existsSync(resolved) || !statSync(resolved).isFile()) {
      failures.push(`${file}: broken local link: ${target}`);
    }
  }
}

const repositoryFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: root,
    encoding: "buffer",
  },
).toString("utf8").split("\0").filter(Boolean);

const forbiddenTracked = [
  /^coverage\//,
  /^tmp\//,
  /^reports\//,
  /^scripts\/patch-claude-oauth-account\.mjs$/,
  /(?:^|\/)airev-export-.*\.json$/,
  /\.tgz$/,
];

for (const file of repositoryFiles) {
  if (forbiddenTracked.some((pattern) => pattern.test(file))) {
    failures.push(`${file}: local or generated artifact is tracked`);
  }
}

const secretPatterns = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9_]{20,}/],
  ["API token", /sk-[A-Za-z0-9_-]{20,}/],
  ["Bearer token", /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/],
  ["consumer email", /[A-Za-z0-9._%+-]+@(?:gmail\.com|hotmail\.com|outlook\.com|yahoo\.com|yandex\.[A-Za-z]{2,}|mail\.ru)/i],
];

const allowedHomeNames = new Set(["example", "test", "user", "username"]);
const posixHome = /(?:^|[\s`"'(])\/home\/([^/\s`"']+)\//g;
const windowsHome = /(?:^|[\s`"'(])[A-Za-z]:\\Users\\([^\\\s`"']+)\\/g;

for (const file of repositoryFiles) {
  const absolute = path.join(root, file);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) continue;
  const buffer = readFileSync(absolute);
  if (buffer.includes(0)) continue;
  const content = buffer.toString("utf8");

  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) failures.push(`${file}: possible ${label}`);
  }
  for (const pattern of [posixHome, windowsHome]) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      if (!allowedHomeNames.has(match[1].toLowerCase())) {
        failures.push(`${file}: workstation-specific home path`);
        break;
      }
    }
  }
}

const packageJson = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
if (packageJson.license !== "MIT") failures.push("package.json: license must match LICENSE");
if (packageJson.scripts?.["docs:check"] !== "node scripts/check-docs.mjs") {
  failures.push("package.json: docs:check script is missing or unexpected");
}
for (const [packageVersion, allowed] of Object.entries(packageJson.allowScripts ?? {})) {
  if (allowed !== true || !/@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageVersion)) {
    failures.push(`package.json: allowScripts entry must pin an exact reviewed version: ${packageVersion}`);
  }
}
const requiredPackagePaths = [
  "docs/README.md",
  "docs/DOCUMENTATION_STANDARD.md",
  "docs/architecture/",
  "docs/operations/",
  "docs/security.md",
  "docs/troubleshooting.md",
  "docs/releasing.md",
  "docs/source-attribution.md",
  "docs/notes/2026-06-22-qodercli-reverse-engineering.md",
  "README.en.md",
  "CONTRIBUTING.md",
  "CONTRIBUTING.en.md",
  "SECURITY.md",
];
for (const requiredPackagePath of requiredPackagePaths) {
  if (!packageJson.files?.includes(requiredPackagePath)) {
    failures.push(`package.json: files must include ${requiredPackagePath}`);
  }
}

if (failures.length > 0) {
  console.error("Documentation/publication checks failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation/publication checks passed (${activeMarkdown.length} active Markdown files).`);
}
