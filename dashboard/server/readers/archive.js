import fs from "node:fs";
import path from "node:path";

export function json(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function text(file, fallback = "") {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return fallback;
  }
}

export function filesUnder(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

export function runDirectory(store, type, id) {
  if (
    typeof id !== "string" ||
    !id ||
    id.includes("/") ||
    id.includes("\\") ||
    id === "." ||
    id === ".."
  )
    return null;
  if (!new Set(["prototype", "delivery", "system", "refinement"]).has(type))
    return null;
  const directory = path.resolve(store, `${type}-runs`, id);
  const parent = path.resolve(store, `${type}-runs`);
  return directory.startsWith(`${parent}${path.sep}`) ? directory : null;
}
