import fs from "node:fs";
import path from "node:path";
const configDir = path.join(process.env.APPDATA, "ai-revolver");
const reg = path.join(configDir, "registry.json");
const act = path.join(configDir, "active.json");
fs.writeFileSync(reg, JSON.stringify({ version: 1, profiles: [] }, null, 2) + "\n");
fs.writeFileSync(act, JSON.stringify({ active: {} }, null, 2) + "\n");
console.log("Registry reset.");
