import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { parse as parseJS } from "@babel/parser";
import { parse as parseHTML } from "parse5";
import { STORE_DIRECTORY, temporaryDirectoryName } from "../../skill-identity.mjs";

export const SOURCE_MAP_VERSION = 1;
export const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
// Cache signature includes implementation and the pinned parser dependency manifest.
function parserVersion(name) {
  let directory = path.dirname(fileURLToPath(import.meta.resolve(name)));
  while (true) {
    const manifest = path.join(directory, "package.json");
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (pkg.name === name) return `${name}@${pkg.version}`;
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Parser manifest missing: ${name}`);
    directory = parent;
  }
}
export const EXTRACTOR_REVISION = digest(Buffer.concat([
  fs.readFileSync(fileURLToPath(import.meta.url)),
  fs.readFileSync(new URL("../package-lock.json", import.meta.url)),
  Buffer.from([parserVersion("@babel/parser"), parserVersion("parse5")].join(";")),
])).slice(0, 32);
export const defaultCacheDirectory = () => path.join(os.tmpdir(), `${temporaryDirectoryName("prototype-cache")}-v1`);
const sourceExtensions = /\.(?:html?|[cm]?js|jsx|tsx?|css|json)$/i;

// A conservative inventory, NOT a claim that static analysis proves reachability.
// No prototype code is evaluated and no browser is opened by this module.
export function discoverPrototypeSource({ workspaceRoot, location, cacheDirectory = defaultCacheDirectory(), cacheVersion = EXTRACTOR_REVISION, metrics = {} }) {
  Object.assign(metrics, { files: 0, hits: 0, parsed: 0, sourceBytes: 0 });
  workspaceRoot = fs.realpathSync(workspaceRoot);
  if (!location || /^[a-z]+:\/\//i.test(location)) throw new Error("源码地图需要已登记的本地原型入口");
  const entry = fs.realpathSync(path.resolve(workspaceRoot, location));
  if (!fs.statSync(entry).isFile()) throw new Error("原型入口必须是文件");
  const root = path.dirname(entry);
  const files = [];
  const problems = [];
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if ([".git", "node_modules", STORE_DIRECTORY].includes(item.name)) continue;
      const file = path.join(directory, item.name);
      if (item.isSymbolicLink()) {
        problems.push(`符号链接需核对并改为明确来源：${path.relative(root, file)}`);
      } else if (item.isDirectory()) visit(file);
      else if (sourceExtensions.test(file)) files.push(file);
    }
  }
  visit(root);
  if (!files.includes(entry)) throw new Error("当前源码地图支持 HTML / JS / TS / CSS / JSON 本地来源");
  const candidates = [];
  const candidateIds = new Set();
  const sourceFiles = [];
  for (const absolute of files.sort()) {
    const file = path.relative(workspaceRoot, absolute).split(path.sep).join("/");
    const text = fs.readFileSync(absolute, "utf8");
    const sha256 = digest(text);
    sourceFiles.push({ path: file, sha256 });
    metrics.files++; metrics.sourceBytes += Buffer.byteLength(text);
    const cacheKey = digest(JSON.stringify([file, sha256, cacheVersion]));
    const cachedFile = cacheDirectory && path.join(cacheDirectory, `${cacheKey}.json`);
    try {
      const cached = JSON.parse(fs.readFileSync(cachedFile, "utf8"));
      if (cached.key === cacheKey && digest(JSON.stringify(cached.payload)) === cached.sha256) {
        candidates.push(...cached.payload.candidates);
        problems.push(...cached.payload.problems);
        cached.payload.candidates.forEach(c => candidateIds.add(c.id));
        metrics.hits++; continue;
      }
    } catch { /* Missing/corrupt cache is a miss, never evidence. */ }
    metrics.parsed++;
    const candidateStart = candidates.length, problemStart = problems.length;
    const lineOffsets = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") lineOffsets.push(i + 1);
    function add(kind, offset, snippet, outcomes = ["observed"]) {
      let low = 0, high = lineOffsets.length;
      while (low + 1 < high) { const mid = (low + high) >> 1; if (lineOffsets[mid] <= offset) low = mid; else high = mid; }
      const id = `${kind}-${digest(`${file}:${offset}:${kind}`).slice(0, 16)}`;
      if (candidateIds.has(id)) return;
      candidateIds.add(id);
      candidates.push({
        id, kind, file, line: low + 1, column: offset - lineOffsets[low] + 1,
        snippet: snippet.replace(/\s+/g, " ").slice(0, 240), outcomes,
      });
    }
    function javascript(code, base = 0) {
      let ast;
      try {
        ast = parseJS(code, { sourceType: "unambiguous", plugins: ["jsx", "typescript"], allowReturnOutsideFunction: true });
      } catch (error) {
        problems.push(`无法解析 ${file}:${base}：${error.message}`);
        return;
      }
      const slice = (node) => code.slice(node.start, node.end);
      const member = (node) => node?.property?.name ?? node?.property?.value;
      function walk(node) {
        if (!node || typeof node !== "object") return;
        const emit = (kind, outcomes) => add(kind, base + node.start, slice(node), outcomes);
        if (node.type === "IfStatement" || node.type === "ConditionalExpression") emit("branch", ["true", "false"]);
        if (node.type === "LogicalExpression") emit("branch", ["short-circuit", "right"]);
        if (node.type === "SwitchStatement") emit("branch", [...node.cases.map((c, i) => c.test ? `case-${i}` : "default"), ...(node.cases.some((c) => !c.test) ? [] : ["no-match"])]);
        if (node.type === "VariableDeclarator" && node.init && !/Function/.test(node.init.type)) emit("state", ["reviewed"]);
        if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
          const method = member(node.callee);
          if (["addEventListener", "on", "once"].includes(method)) emit("event");
          if (["getItem", "setItem", "removeItem"].includes(method)) emit("state", ["reviewed"]);
          if (["createElement", "insertAdjacentHTML", "write"].includes(method) || ["eval", "Function"].includes(node.callee?.name)) emit("dynamic");
          if (node.callee?.type === "Import" || node.callee?.name === "require") emit("reference", ["reviewed"]);
        }
        if (node.type === "ImportDeclaration" || node.type === "ImportExpression" || (node.type.startsWith("Export") && node.source)) emit("reference", ["reviewed"]);
        if (node.type === "AssignmentExpression") {
          const property = member(node.left);
          if (/^on[a-z]/i.test(property ?? "")) emit("event");
          if (["innerHTML", "outerHTML"].includes(property)) emit("dynamic");
        }
        if (node.type === "JSXOpeningElement") emit("dynamic");
        // HTML created in strings/templates must be reconciled with runtime elements.
        if ((node.type === "StringLiteral" && /<[a-z][\s\S]*>/i.test(node.value)) || (node.type === "TemplateLiteral" && node.quasis.some((q) => /<[a-z]/i.test(q.value.raw)))) emit("dynamic");
        for (const [key, value] of Object.entries(node)) {
          if (["loc", "comments", "tokens", "extra"].includes(key)) continue;
          if (Array.isArray(value)) value.forEach(walk);
          else if (value && typeof value === "object" && value.type) walk(value);
        }
      }
      walk(ast.program);
    }
    if (/\.html?$/i.test(absolute)) {
      add("page", 0, `入口文件 ${file}`);
      const document = parseHTML(text, { sourceCodeLocationInfo: true });
      function html(node) {
        const attrs = Object.fromEntries((node.attrs ?? []).map((a) => [a.name, a.value]));
        const loc = node.sourceCodeLocation;
        if (loc && node.tagName) {
          const tag = text.slice(loc.startOffset, loc.startTag?.endOffset ?? loc.endOffset);
          if (/\b(page|screen|modal|sheet|dialog|overlay)\b/.test(attrs.class ?? "") || node.tagName === "dialog" || attrs.role === "dialog") add("page", loc.startOffset, tag);
          if (["button", "input", "select", "textarea", "summary"].includes(node.tagName) || (node.tagName === "a" && "href" in attrs) || /button|link|tab|menuitem|checkbox|switch/.test(attrs.role ?? "") || "tabindex" in attrs || Object.keys(attrs).some((a) => /^on/.test(a))) add("control", loc.startOffset, tag);
          for (const [name, value] of Object.entries(attrs)) {
            if (/^on[a-z]+$/.test(name)) {
              const offset = loc.attrs?.[name]?.startOffset ?? loc.startOffset;
              add("event", offset, `${name}=${value}`);
              javascript(value, offset);
            }
          }
          if ((["script", "iframe"].includes(node.tagName) && attrs.src) || (node.tagName === "link" && attrs.href)) add("reference", loc.startOffset, tag, ["reviewed"]);
          if (node.tagName === "script" && !attrs.src && (!attrs.type || /javascript|ecmascript|module/.test(attrs.type))) {
            const begin = loc.startTag.endOffset;
            javascript(text.slice(begin, loc.endTag?.startOffset ?? loc.endOffset), begin);
          }
        }
        for (const child of node.childNodes ?? []) html(child);
        if (node.content) html(node.content);
      }
      html(document);
    } else if (/\.[cm]?jsx?$|\.tsx?$/i.test(absolute)) javascript(text);
    if (cachedFile) {
      const payload = { candidates: candidates.slice(candidateStart), problems: problems.slice(problemStart) };
      // Cache is optional: inability to write it cannot change extraction results.
      try {
        fs.mkdirSync(cacheDirectory, { recursive: true });
        const temporary = `${cachedFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify({ key: cacheKey, sha256: digest(JSON.stringify(payload)), payload }));
        fs.renameSync(temporary, cachedFile);
      } catch { /* read-only environment */ }
    }
  }
  return {
    schemaVersion: SOURCE_MAP_VERSION, extractorVersion: SOURCE_MAP_VERSION,
    origin: { entry: path.relative(workspaceRoot, entry).split(path.sep).join("/"), root: path.relative(workspaceRoot, root).split(path.sep).join("/") },
    sourceFiles, candidates, problems,
  };
}

export function sourceMapMarkdown(map) {
  const cell = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/`/g, "&#96;").replace(/\|/g, "\\|").replace(/[\r\n]/g, " ");
  return ["# 原型源码发现地图", "", "> 这是操作前独立生成的候选分母，不表示已访问或已验证。页面/状态之间的用户操作在 interaction-map.json 中整理；不是开发依赖图。", "",
    ...map.problems.map((problem) => `- 待核验：${problem}`), "",
    "| ID | 类型 | 源码定位 | 候选内容 | 分支 |", "| --- | --- | --- | --- | --- |",
    ...map.candidates.map((c) => `| ${c.id} | ${c.kind} | ${cell(c.file)}:${c.line}:${c.column} | ${cell(c.snippet)} | ${c.outcomes.join(" / ")} |`), "",
  ].join("\n");
}
