import { readFile } from "node:fs/promises";

export async function loadLocalEnv(file, environment = process.env) {
  if (environment.NODE_ENV === "production") return false;
  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw new Error("Could not read the local .env configuration file.");
  }
  if (contents.length > 64_000) throw new Error("The local .env configuration file is too large.");

  for (const [index, rawLine] of contents.replace(/^\uFEFF/, "").split(/\r?\n/).entries()) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!assignment) throw new Error(`Invalid .env entry on line ${index + 1}.`);
    const [, name] = assignment;
    if (environment[name] !== undefined) continue;

    let value = assignment[2].trim();
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0];
      if (value.length < 2 || value.at(-1) !== quote) {
        throw new Error(`Unclosed quoted value in .env on line ${index + 1}.`);
      }
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    }
    environment[name] = value;
  }
  return true;
}
