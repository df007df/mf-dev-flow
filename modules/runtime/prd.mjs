// PRD 阅读与取证：来源冻结、只读分析产物与逐字引文门禁。独立模块，不加载产品运行库。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { SKILL_ID, STORE_DIRECTORY } from "../skill-identity.mjs";

const store = () => path.join(process.cwd(), STORE_DIRECTORY, "prd");
const manifestFile = () => path.join(store(), "manifest.json");
const sourcesDir = () => path.join(store(), "sources");
const analysesDir = () => path.join(store(), "analyses");
const sourceFile = (id) => path.join(sourcesDir(), `${id}.md`);
const batchDir = (id) => path.join(analysesDir(), id);

const fail = (message) => {
  console.error(`${SKILL_ID}: ${message}`);
  process.exit(1);
};
const valueFor = (name) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};
const required = (name) => {
  const value = valueFor(name);
  if (!value || value.startsWith("--")) fail(`缺少 ${name}`);
  return value;
};
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const slug = (value) =>
  String(value)
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "prd";
const validId = (value) => typeof value === "string" && /^[\p{L}\p{N}._-]{1,240}$/u.test(value);
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.${process.pid}.tmp`, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(`${file}.${process.pid}.tmp`, file);
};
const readManifest = () => {
  if (!fs.existsSync(manifestFile())) return { schemaVersion: 1, sources: [] };
  const manifest = JSON.parse(fs.readFileSync(manifestFile(), "utf8"));
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.sources))
    fail("prd/manifest.json 形状不符（schemaVersion/sources）。");
  return manifest;
};
const sourceById = (manifest, id) => manifest.sources.find((entry) => entry.id === id) ?? null;
const nowIso = () => new Date().toISOString();

// 引文比对：NFC 归一后小写；空白先折叠为单格再试整删，容忍跨行/缩进重排，不容忍转述。
const normalizeText = (value) =>
  String(value)
    .normalize("NFC")
    .replace(/[\s　]+/gu, " ")
    .trim()
    .toLowerCase();
const stripText = (value) =>
  String(value)
    .normalize("NFC")
    .replace(/[\s　]+/gu, "")
    .toLowerCase();

const TEXT_SUFFIXES = new Set([".md", ".markdown", ".txt"]);
const DOCX_SUFFIX = ".docx";

const xmlUnescape = (value) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&amp;/g, "&");

function paragraphText(paragraphXml) {
  const withBreaks = paragraphXml.replace(/<w:tab\/>/g, " ").replace(/<w:br\s*\/>/g, " ");
  const runs = withBreaks.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) ?? [];
  return xmlUnescape(runs.map((run) => run.replace(/<[^>]*>/g, "")).join(""));
}

function paragraphHeadingLevel(paragraphXml) {
  const style = paragraphXml.match(/<w:pStyle\s+w:val="([^"]+)"/);
  if (!style) return 0;
  const heading = style[1].match(/^(?:Heading|heading|标题)([1-9])$/);
  if (heading) return Number(heading[1]);
  return /^[1-9]$/.test(style[1]) ? Number(style[1]) : 0;
}

export function docxToText(documentXml) {
  const start = documentXml.indexOf("<w:body>");
  const body = start === -1 ? documentXml : documentXml.slice(start + "<w:body>".length);
  const limit = body.indexOf("</w:body>");
  const content = limit === -1 ? body : body.slice(0, limit);
  const lines = [];
  const tokens = content
    .split(/(<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>)/g)
    .filter(Boolean);
  for (const token of tokens) {
    if (/^<w:p(\s|>)/.test(token)) {
      const text = paragraphText(token);
      const level = paragraphHeadingLevel(token);
      lines.push(level > 0 && text.trim() ? `${"#".repeat(level)} ${text}` : text);
    } else if (token.startsWith("<w:tbl>")) {
      for (const row of token.match(/<w:tr(?:\s|>)[\s\S]*?<\/w:tr>/g) ?? []) {
        const cells = (row.match(/<w:tc(?:\s|>)[\s\S]*?<\/w:tc>/g) ?? []).map((cell) => paragraphText(cell));
        if (cells.length) lines.push(cells.join(" | "));
      }
    }
  }
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function extractDocx(file) {
  const probe = spawnSync("unzip", ["-p", file, "word/document.xml"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
  if (probe.error && probe.error.code === "ENOENT")
    fail("缺少 unzip：Word 文档无法解包。可先在 Word/钉钉导出为文本，再用 prd ingest --snapshot 登记。");
  if (probe.status !== 0)
    fail(`无法从 ${path.basename(file)} 读取 word/document.xml（不是有效 .docx？）：${(probe.stderr ?? Buffer.from("")).toString().slice(0, 200)}`);
  return probe.stdout;
}

function registerSource({ origin, format, originalBytes, snapshotText, title }) {
  const text = snapshotText.replace(/\r\n/g, "\n").trim() + "\n";
  if (!text.trim()) fail(`来源正文为空：${title ?? origin.path ?? origin.url ?? ""}`);
  const entry = {
    id: `${slug(title ?? path.basename(origin.path ?? origin.url ?? "prd"))}-${sha256(text).slice(0, 12)}`,
    title: title ?? (origin.path ? path.basename(origin.path) : (origin.url ?? "prd")),
    origin,
    format,
    ingestedAt: nowIso(),
    sourceSha256: sha256(originalBytes),
    snapshotSha256: sha256(text),
    bytes: Buffer.byteLength(text),
  };
  const manifest = readManifest();
  const previous = sourceById(manifest, entry.id);
  manifest.sources = manifest.sources.filter((s) => s.id !== entry.id);
  manifest.sources.push(entry);
  manifest.updatedAt = nowIso();
  const file = sourceFile(entry.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.${process.pid}.tmp`, text);
  fs.renameSync(`${file}.${process.pid}.tmp`, file);
  writeJson(manifestFile(), manifest);
  return { id: entry.id, title: entry.title, format: entry.format, reused: Boolean(previous), sourceSha256: entry.sourceSha256 };
}

function ingestFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) fail(`文件不存在：${filePath}`);
  const suffix = path.extname(resolved).toLowerCase();
  const originalBytes = fs.readFileSync(resolved);
  if (suffix === DOCX_SUFFIX)
    return registerSource({ origin: { kind: "word", path: resolved }, format: "docx", originalBytes, snapshotText: docxToText(extractDocx(resolved).toString("utf8")), title: path.basename(resolved, suffix) });
  if (!TEXT_SUFFIXES.has(suffix))
    fail(`暂不支持 ${suffix || "无扩展名"}；v1 支持 .md/.markdown/.txt/.docx，其它格式请先导出为文本再用 --snapshot 登记。`);
  return registerSource({ origin: { kind: "file", path: resolved }, format: "text", originalBytes, snapshotText: originalBytes.toString("utf8"), title: path.basename(resolved, suffix) });
}

function walkDirectory(dir) {
  const rootDir = path.resolve(dir);
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) fail(`目录不存在：${dir}`);
  const found = [];
  const visit = (current) => {
    for (const item of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith(".") || item.name.startsWith("~$")) continue;
      const child = path.join(current, item.name);
      const suffix = path.extname(item.name).toLowerCase();
      if (item.isDirectory()) visit(child);
      else if (TEXT_SUFFIXES.has(suffix) || suffix === DOCX_SUFFIX) found.push(child);
      if (found.length > 500) fail("目录内候选文件超过 500，请先收窄 --dir 范围。");
    }
  };
  visit(rootDir);
  return found;
}

export function prdIngest() {
  const snapshot = valueFor("--snapshot");
  let sources;
  if (snapshot) {
    const url = required("--url");
    if (!/^https?:\/\//i.test(url)) fail("--url 必须是 http(s) 链接（在线文档快照）。");
    const raw = fs.readFileSync(path.resolve(snapshot));
    sources = [
      registerSource({
        origin: { kind: /alidocs\.dingtalk\.com/i.test(url) ? "dingtalk" : "remote", url },
        format: "text",
        originalBytes: raw,
        snapshotText: raw.toString("utf8"),
        title: valueFor("--title") ?? new URL(url).hostname,
      }),
    ];
  } else if (valueFor("--dir")) {
    const files = walkDirectory(valueFor("--dir"));
    if (!files.length) fail(`目录内没有 .md/.markdown/.txt/.docx 来源：${valueFor("--dir")}`);
    sources = files.map((file) => ingestFile(file));
  } else {
    sources = [ingestFile(required("--file"))];
  }
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, command: "prd ingest", sources, note: `PRD 原件只读；冻结快照与哈希保存在 ${STORE_DIRECTORY}/prd/。` })}\n`);
}

function driftOf(entry) {
  if (entry.origin?.kind === "dingtalk" || entry.origin?.kind === "remote")
    return { state: "unverifiable", note: "在线快照无法核验原文变化；会前重取快照并重新 ingest。" };
  const file = entry.origin?.path;
  if (!file || !fs.existsSync(file)) return { state: "missing", note: "原始文件已不在登记路径。" };
  return sha256(fs.readFileSync(file)) === entry.sourceSha256
    ? { state: "clean" }
    : { state: "modified", note: "PRD 原件在冻结后被修改；结论需重跑。" };
}

export function prdStatus() {
  const manifest = readManifest();
  const batches = fs.existsSync(analysesDir())
    ? fs
        .readdirSync(analysesDir(), { withFileTypes: true })
        .filter((item) => item.isDirectory() && fs.existsSync(path.join(batchDir(item.name), "findings.json")))
        .map((item) => item.name)
        .sort()
    : [];
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: 1,
      command: "prd status",
      store: `${STORE_DIRECTORY}/prd/`,
      sources: manifest.sources.map((entry) => ({ id: entry.id, title: entry.title, kind: entry.origin?.kind, origin: entry.origin?.url ?? entry.origin?.path ?? null, ingestedAt: entry.ingestedAt, bytes: entry.bytes, drift: driftOf(entry) })),
      batches,
      next: batches.length ? "prd check --batch <ID> --json；会议材料用 prd render --batch <ID>。" : "先 prd ingest 冻结来源，再按 flows/prd/protocol.md 写 findings.json。",
    })}\n`,
  );
}

const KINDS = new Set(["contradiction", "ambiguity", "principle", "redline"]);
const SEVERITIES = new Set(["high", "medium", "low"]);

function loadFindings(batchId) {
  if (!validId(batchId) || batchId === ".." || batchId === ".") fail("批次 ID 非法（仅允许字母、数字、._-，≤240）。");
  const resolved = path.resolve(batchDir(batchId));
  if (path.dirname(resolved) !== path.resolve(analysesDir()) || !fs.existsSync(path.join(resolved, "findings.json")))
    fail(`批次不存在或缺 findings.json：prd/analyses/${batchId}/`);
  let findings;
  try {
    findings = JSON.parse(fs.readFileSync(path.join(resolved, "findings.json"), "utf8"));
  } catch (error) {
    fail(`findings.json 解析失败：${error.message}`);
  }
  return { dir: resolved, findings };
}

// 门禁核心：逐字引文必须存在于冻结快照；失败项精确到条目路径，不整批静默。
// options.sourceText(id) 允许调用方（如看板只读展示）替换快照读取；返回 null 记为该来源快照缺失。
export function checkFindings(findings, manifest, options = {}) {
  const readSnapshot =
    options.sourceText ?? ((id) => fs.readFileSync(sourceFile(id), "utf8"));
  const problems = [];
  const warnings = [];
  const requireText = (value, at) => {
    const text = String(value ?? "");
    if (!text.trim()) problems.push({ path: at, message: "必填非空。" });
    return text;
  };
  if (!findings || typeof findings !== "object" || Array.isArray(findings) || findings.schemaVersion !== 1)
    problems.push({ path: "$", message: "需要 schemaVersion: 1 的对象。" });
  if (!validId(findings?.batchId)) problems.push({ path: "batchId", message: "batchId 缺失或非法。" });
  requireText(findings?.title, "title");
  const known = new Set(manifest.sources.map((entry) => entry.id));
  const used = new Set();
  if (!Array.isArray(findings?.sources) || !findings.sources.length) problems.push({ path: "sources", message: "sources 至少一个已摄取来源 ID。" });
  for (const id of findings?.sources ?? []) {
    if (!known.has(id)) problems.push({ path: `sources[${id}]`, message: "未摄取的来源 ID；先 prd ingest。" });
    else used.add(id);
  }
  const cache = new Map();
  const normalizedFor = (id) => {
    if (!cache.has(id)) {
      let snapshot;
      try {
        const text = readSnapshot(id);
        if (typeof text !== "string") throw new Error("快照不可读为文本。");
        snapshot = { collapse: normalizeText(text), strip: stripText(text) };
      } catch (error) {
        problems.push({
          path: `sources[${id}]`,
          message: `来源快照缺失或不可读：${error?.message || error} 先补跑 prd ingest。`,
        });
        snapshot = { collapse: "", strip: "" };
      }
      cache.set(id, snapshot);
    }
    return cache.get(id);
  };
  const items = Array.isArray(findings?.items) ? findings.items : [];
  if (!items.length) problems.push({ path: "items", message: "items 不能为空。" });
  const ids = new Set();
  let checkedQuotes = 0;
  items.forEach((item, index) => {
    const at = `items[${item?.id || `#${index}`}]`;
    const id = requireText(item?.id, `${at}.id`);
    if (id && !/^[\p{L}\p{N}._-]{1,40}$/u.test(id)) problems.push({ path: `${at}.id`, message: "条目 ID 需为 ≤40 的字母数字._-。" });
    if (ids.has(id)) problems.push({ path: `${at}.id`, message: `条目 ID 重复：${id}` });
    ids.add(id);
    if (!KINDS.has(item?.kind)) problems.push({ path: `${at}.kind`, message: "kind 只能是 contradiction/ambiguity/principle/redline。" });
    requireText(item?.title, `${at}.title`);
    requireText(item?.statement, `${at}.statement`);
    if (!SEVERITIES.has(item?.severity)) problems.push({ path: `${at}.severity`, message: "severity 只能是 high/medium/low。" });
    if (!Array.isArray(item?.evidence) || !item.evidence.length) problems.push({ path: `${at}.evidence`, message: "每条结论必须至少一条逐字引文证据。" });
    (item?.evidence ?? []).forEach((evidence, eIndex) => {
      const eAt = `${at}.evidence[${eIndex}]`;
      requireText(evidence?.locator, `${eAt}.locator`);
      const quote = requireText(evidence?.quote, `${eAt}.quote`);
      if (!used.has(evidence?.source)) {
        problems.push({ path: `${eAt}.source`, message: "证据来源不在本批 sources 或未摄取。" });
        return;
      }
      checkedQuotes += 1;
      if (quote.trim()) {
        const snapshot = normalizedFor(evidence.source);
        const found = snapshot.collapse.includes(normalizeText(quote)) || snapshot.strip.includes(stripText(quote));
        if (!found) problems.push({ path: `${eAt}.quote`, message: "引文不是来源快照的逐字原文（禁止转述）。" });
      }
    });
    for (const [cIndex, target] of (item?.conflictsWith ?? []).entries()) {
      if (target === item?.id) problems.push({ path: `${at}.conflictsWith[${cIndex}]`, message: "不能关联自身。" });
      else if (!items.some((other) => other?.id === target)) problems.push({ path: `${at}.conflictsWith[${cIndex}]`, message: `关联条目不存在：${target}` });
    }
  });
  for (const id of used)
    if (!items.some((item) => (item?.evidence ?? []).some((evidence) => evidence?.source === id)))
      warnings.push({ path: "sources", message: `来源 ${id} 未被任何证据引用。` });
  if (!String(findings?.summary?.background ?? "").trim()) warnings.push({ path: "summary.background", message: "缺产品背景理解；会议要求可补。" });
  if (!String(findings?.summary?.direction ?? "").trim()) warnings.push({ path: "summary.direction", message: "缺发展/方向理解。" });
  return { ok: problems.length === 0, batchId: findings?.batchId ?? null, items: items.length, checkedQuotes, problems, warnings };
}

export function prdCheck() {
  const { findings } = loadFindings(required("--batch"));
  const manifest = readManifest();
  const against = valueFor("--against");
  const sourceArg = valueFor("--source");
  if (against && !sourceArg) fail("--against 需要同时 --source <ID> 指明候选替换哪个来源。");
  if (sourceArg && !against) fail("--source 仅与 --against 搭配用于候选快照复核。");
  if (against) {
    if (!validId(sourceArg) || sourceArg === ".." || sourceArg === ".") fail("来源 ID 非法。");
    if (!sourceById(manifest, sourceArg)) fail(`来源 ID 不在 manifest：${sourceArg}`);
    const candidateFile = path.resolve(against);
    if (!fs.existsSync(candidateFile) || !fs.statSync(candidateFile).isFile()) fail(`候选快照文件不存在：${against}`);
    // 与 registerSource 相同的快照折叠，保证与冻结快照字节可比。
    const candidateText = fs.readFileSync(candidateFile, "utf8").replace(/\r\n/g, "\n").trim() + "\n";
    if (!candidateText.trim()) fail("候选快照为空。");
    let frozenText;
    try {
      frozenText = fs.readFileSync(sourceFile(sourceArg), "utf8");
    } catch {
      fail("冻结快照缺失：先补跑 prd ingest。");
    }
    const snapshotChanged = sha256(candidateText) !== sha256(frozenText);
    const baseline = checkFindings(findings, manifest);
    const candidate = checkFindings(findings, manifest, {
      sourceText: (id) => (id === sourceArg ? candidateText : fs.readFileSync(sourceFile(id), "utf8")),
    });
    // 影响面 = 候选下新增失效项；既有结构问题不混入（先修 baseline 再复核）。
    const baselinePaths = new Set(baseline.problems.map((problem) => problem.path));
    const newlyFailed = candidate.problems.filter((problem) => !baselinePaths.has(problem.path));
    const impactedItems = [...new Set(newlyFailed.flatMap((problem) => {
      const match = /^items\[([^\]]+)\]/u.exec(problem.path);
      return match ? [match[1]] : [];
    }))];
    process.exitCode = newlyFailed.length ? 1 : 0;
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        command: "prd check",
        mode: "against-candidate",
        batchId: findings?.batchId ?? null,
        source: sourceArg,
        snapshotChanged,
        candidate: { bytes: Buffer.byteLength(candidateText), sha256: sha256(candidateText) },
        baselineOk: baseline.ok,
        candidateOk: candidate.ok,
        impactedItems,
        newlyFailed,
        checkedQuotes: candidate.checkedQuotes,
      })}\n`,
    );
    return;
  }
  const result = checkFindings(findings, manifest);
  process.exitCode = result.ok ? 0 : 1;
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, command: "prd check", ...result })}\n`);
}

const severityOrder = { high: 0, medium: 1, low: 2 };

function renderGroup(findings, manifest, { heading, kinds, intro }) {
  const titleOf = (id) => manifest.sources.find((entry) => entry.id === id)?.title ?? id;
  const items = findings.items
    .filter((item) => kinds.includes(item.kind))
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || String(a.id).localeCompare(String(b.id)));
  const lines = [`# ${heading}`, "", intro, ""];
  lines.push(`- 来源：${findings.sources.map((id) => `《${titleOf(id)}》（\`${id}\`）`).join("；")}`);
  lines.push("- 核验：本文件由 `prd render` 从 `findings.json` 生成；每条引文已通过 `prd check` 与冻结快照逐字比对。", "");
  for (const item of items) {
    lines.push(`## [${item.id}] ${item.title}`, "", `- 类别：${item.kind}｜严重度：${item.severity}`, "", item.statement, "");
    for (const evidence of item.evidence) {
      lines.push(`证据 · 《${titleOf(evidence.source)}》· ${evidence.locator}`, "");
      lines.push(...evidence.quote.trim().split("\n").map((line) => `> ${line}`), "");
    }
    if (item.question) lines.push(`待确认：${item.question}`, "");
    if (item.conflictsWith?.length) lines.push(`关联：${item.conflictsWith.map((id) => `[${id}]`).join(" ")}`, "");
  }
  if (!items.length) lines.push("（本批暂无该类条目。）", "");
  return lines.join("\n");
}

export function prdRender() {
  const { dir, findings } = loadFindings(required("--batch"));
  const manifest = readManifest();
  const result = checkFindings(findings, manifest);
  if (!result.ok)
    fail(`render 拒绝：check 未通过（${result.problems.length} 项）。引文不成立的结论不得进入会议材料；先跑 prd check 修正。`);
  const summary = [
    findings.summary?.background && `背景：${findings.summary.background}`,
    findings.summary?.direction && `方向：${findings.summary.direction}`,
  ].filter(Boolean);
  const header = [`> PRD：${findings.title}`, "", ...summary.map((line) => `> ${line}`), ""].join("\n");
  const files = {
    "contradictions.md": `${header}${renderGroup(findings, manifest, {
      heading: "PRD 矛盾与不清楚清单",
      kinds: ["contradiction", "ambiguity"],
      intro: "业务逻辑互相冲突（contradiction）与口径不清楚（ambiguity）的完整清单；每条附冻结快照中的逐字引文。开会逐项确认，未确认前不视为共识。",
    })}`,
    "redlines.md": `${header}${renderGroup(findings, manifest, {
      heading: "PRD 核心原则与红线证据索引",
      kinds: ["principle", "redline"],
      intro: "核心原则（principle）与红线（redline）索引；每条含原则原文与出处，供后续讨论引用与变更复评作证据。",
    })}`,
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  process.stdout.write(`${JSON.stringify({ schemaVersion: 1, command: "prd render", batchId: findings.batchId, files: Object.keys(files), checkedQuotes: result.checkedQuotes, note: "会议文档为派生产物；修改只改 findings.json，再重跑 check/render。" })}\n`);
}
