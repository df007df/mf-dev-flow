import { STORE_DIRECTORY } from "../../../modules/skill-identity.mjs";

const archiveRoot = /^(?:prototype|planning|system|projects|compaction|(?:prototype|delivery|system|refinement)-runs)\//;
const storePrefix = `${STORE_DIRECTORY}/`;

// Resolve Markdown relative to its archived document, never the dashboard URL.
export function documentAssetUrl(href, { documentPath = "", assetBase = "" } = {}) {
  if (/^\/files\/?\?path=/.test(href)) return href;
  if (/^(?:https?:|mailto:)/i.test(href) || href.startsWith("#")) return href;
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("/")) return null;
  const [raw, fragment] = href.split("#", 2);
  let file;
  try { file = decodeURIComponent(raw); } catch { return null; }
  if (!file || /[\\\0]/.test(file) || file.startsWith("/")) return null;
  let base = documentPath ? documentPath.split("/").slice(0, -1).join("/") : assetBase;
  if (file.startsWith(storePrefix)) { file = file.slice(storePrefix.length); base = ""; }
  else if (archiveRoot.test(file)) base = "";
  else if (file.startsWith("screenshots/") && assetBase) base = assetBase;
  const segments = [];
  for (const part of `${base}/${file}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!segments.length) return null; segments.pop(); }
    else segments.push(part);
  }
  if (!segments.length) return null;
  return `/files/?path=${encodeURIComponent(segments.join("/"))}${fragment ? `#${fragment}` : ""}`;
}

export function isArchiveImage(url) {
  if (!url || !/^\/files\/?\?path=/.test(url)) return false;
  const file = new URL(url, "http://archive.local").searchParams.get("path") ?? "";
  return /\.(?:gif|jpe?g|png|svg|webp)$/i.test(file);
}
