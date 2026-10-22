import fs from "node:fs";
import path from "node:path";
import { json } from "./archive.js";
import { checkFindings } from "../../../modules/runtime/prd.mjs";
import { objectRefOrNull } from "../../../modules/kernel/object-ref.mjs";

const SAFE_ID = /^[\p{L}\p{N}._-]{1,240}$/u;

function statIso(file) {
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return null;
  }
}

function documentInfo(file, relative) {
  let content;
  let exists = false;
  let updatedAt = null;
  try {
    content = fs.readFileSync(file, "utf8");
    exists = true;
    updatedAt = fs.statSync(file).mtime.toISOString();
  } catch {
    content = "";
  }
  return { path: relative, exists, updatedAt, content };
}

function tally(items, kinds) {
  const rows = items.filter((item) => kinds.includes(item?.kind));
  const severity = (level) => rows.filter((row) => row.severity === level).length;
  return {
    items: rows.length,
    high: severity("high"),
    medium: severity("medium"),
    low: severity("low"),
    quotes: rows.reduce(
      (count, row) => count + (Array.isArray(row?.evidence) ? row.evidence.length : 0),
      0,
    ),
  };
}

export function prdSummary(store) {
  const directory = path.join(store, "prd");
  const manifestFile = path.join(directory, "manifest.json");
  if (!fs.existsSync(manifestFile)) return null;
  const manifest = json(manifestFile);
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources))
    return { error: "prd/manifest.json 形状不符（schemaVersion/sources），看板无法核验。", sourceCount: 0, batches: [], batch: null };
  const analysesDirectory = path.join(directory, "analyses");
  const batches = fs.existsSync(analysesDirectory)
    ? fs
        .readdirSync(analysesDirectory, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            SAFE_ID.test(entry.name) &&
            fs.existsSync(path.join(analysesDirectory, entry.name, "findings.json")),
        )
        .map((entry) => ({
          id: entry.name,
          ref: objectRefOrNull("prd-batch", entry.name),
          updatedAt: statIso(path.join(analysesDirectory, entry.name, "findings.json")),
        }))
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
    : [];
  const summary = {
    sourceCount: manifest.sources.length,
    sources: manifest.sources.map((entry) => ({
      id: entry.id,
      ref: objectRefOrNull("prd-source", entry.id),
      title: entry.title,
      kind: entry.origin?.kind ?? null,
      ingestedAt: entry.ingestedAt ?? null,
    })),
    batches,
    batch: null,
  };
  if (!batches.length) return summary;
  const latest = batches[0];
  const batchDirectory = path.join(analysesDirectory, latest.id);
  const findings = json(path.join(batchDirectory, "findings.json"));
  if (!findings || typeof findings !== "object" || Array.isArray(findings))
    return { ...summary, batch: { id: latest.id, updatedAt: latest.updatedAt, parseError: "findings.json 解析失败，无法展示统计与核验。" } };
  const sourceText = (id) => {
    if (typeof id !== "string" || !SAFE_ID.test(id) || id.includes("..")) return null;
    try {
      return fs.readFileSync(path.join(directory, "sources", `${id}.md`), "utf8");
    } catch {
      return null;
    }
  };
  let check = null;
  let checkError = null;
  try {
    check = checkFindings(findings, manifest, { sourceText });
  } catch (error) {
    checkError = `核验执行异常：${error?.message || error}`;
  }
  const items = Array.isArray(findings.items) ? findings.items : [];
  const byKind = (kind) => items.filter((item) => item?.kind === kind).length;
  summary.batch = {
    id: findings.batchId || latest.id,
    ref: objectRefOrNull("prd-batch", findings.batchId || latest.id),
    updatedAt: latest.updatedAt,
    title: findings.title ?? null,
    summary: findings.summary ?? {},
    usedSourceCount: Array.isArray(findings.sources) ? findings.sources.length : 0,
    items: {
      contradiction: byKind("contradiction"),
      ambiguity: byKind("ambiguity"),
      principle: byKind("principle"),
      redline: byKind("redline"),
    },
    quotes: items.reduce(
      (count, item) => count + (Array.isArray(item?.evidence) ? item.evidence.length : 0),
      0,
    ),
    check,
    checkError,
    documents: {
      contradictions: documentInfo(
        path.join(batchDirectory, "contradictions.md"),
        `prd/analyses/${latest.id}/contradictions.md`,
      ),
      redlines: documentInfo(
        path.join(batchDirectory, "redlines.md"),
        `prd/analyses/${latest.id}/redlines.md`,
      ),
    },
  };
  summary.batch.documents.contradictions.tally = tally(items, ["contradiction", "ambiguity"]);
  summary.batch.documents.redlines.tally = tally(items, ["principle", "redline"]);
  return summary;
}
