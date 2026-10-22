// 内容对比通用 CLI：hash 指纹与两份文本的变更判定/分块差异。
// 自包含最小功能单元：只依赖 Node 内置模块；能力经命令路由暴露，由 Agent 组合调用，不作为库供其它模块 import。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const fail = (message) => {
  console.error(`mf-dev-flow: ${message}`);
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

export function contentHash() {
  const file = path.resolve(required("--file"));
  if (!fs.existsSync(file) || !fs.statSync(file).isFile())
    fail(`文件不存在或不是普通文件：${file}`);
  const bytes = fs.readFileSync(file);
  const digest = sha256(bytes);
  if (process.argv.includes("--json")) {
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: 1, command: "content hash", file: displayPath(file), bytes: bytes.length, sha256: digest })}\n`,
    );
    return;
  }
  console.log(
    `${digest}  ${displayPath(file)}  (${bytes.length} bytes)`,
  );
}

// 保守归一：NFC、CRLF→LF、行尾空白、连续空行折叠与首尾空行。语义字符与行内空格不动。
const foldText = (text) =>
  text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u3000]+$/u, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");

const looksBinary = (bytes) => bytes.length > 0 && bytes.includes(0);

// 工作区外的路径保留绝对形式，不输出 ../ 长串。
const displayPath = (file) => {
  const rel = path.relative(process.cwd(), file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : file;
};

const MAX_LCS_CELLS = 2_000_000;
const COARSE_CHUNK = 32;
const SNIPPET_LINES = 10;

// 行级差异：公共前后缀剥离 → LCS 精确对齐（规模超限退化为分块粗比对）。
function diffBlocks(aLines, bLines, maxBlocks) {
  let start = 0;
  while (
    start < aLines.length &&
    start < bLines.length &&
    aLines[start] === bLines[start]
  )
    start++;
  let endA = aLines.length;
  let endB = bLines.length;
  while (
    endA > start &&
    endB > start &&
    aLines[endA - 1] === bLines[endB - 1]
  ) {
    endA--;
    endB--;
  }
  const middleA = aLines.slice(start, endA);
  const middleB = bLines.slice(start, endB);
  const ops = [];
  let granularity = "exact";
  if (!middleA.length && !middleB.length) {
    // 仅空白差异，折叠后等价。
  } else if (middleA.length * middleB.length > MAX_LCS_CELLS) {
    granularity = "coarse";
    const chunkCount = Math.max(
      Math.ceil(middleA.length / COARSE_CHUNK),
      Math.ceil(middleB.length / COARSE_CHUNK),
    );
    for (let c = 0; c < chunkCount; c++) {
      const aSlice = middleA.slice(c * COARSE_CHUNK, (c + 1) * COARSE_CHUNK);
      const bSlice = middleB.slice(c * COARSE_CHUNK, (c + 1) * COARSE_CHUNK);
      if (aSlice.join("\n") === bSlice.join("\n")) continue;
      ops.push({ type: "changed", aStart: start + c * COARSE_CHUNK, aLines: aSlice, bStart: start + c * COARSE_CHUNK, bLines: bSlice });
    }
  } else {
    const n = middleA.length;
    const m = middleB.length;
    const table = new Uint16Array((n + 1) * (m + 1));
    const at = (i, j) => i * (m + 1) + j;
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[at(i, j)] =
          middleA[i] === middleB[j]
            ? table[at(i + 1, j + 1)] + 1
            : Math.max(table[at(i + 1, j)], table[at(i, j + 1)]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && middleA[i] === middleB[j]) {
        i++;
        j++;
      } else if (j < m && (i === n || table[at(i, j + 1)] >= table[at(i + 1, j)])) {
        const from = j;
        while (
          j < m &&
          !(i < n && j < m && middleA[i] === middleB[j]) &&
          (i === n || table[at(i, j + 1)] >= table[at(i + 1, j)])
        )
          j++;
        ops.push({ type: "added", aStart: start + i, aLines: [], bStart: start + from, bLines: middleB.slice(from, j) });
      } else {
        const from = i;
        while (
          i < n &&
          !(i < n && j < m && middleA[i] === middleB[j]) &&
          !(j < m && (i === n || table[at(i, j + 1)] >= table[at(i + 1, j)]))
        )
          i++;
        ops.push({ type: "removed", aStart: start + from, aLines: middleA.slice(from, i), bStart: start + j, bLines: [] });
      }
    }
  }
  // 相邻编辑合并为块：两侧区间都紧贴即并成同一块（删除+新增相邻即“修改”）。
  const blocks = [];
  for (const op of ops) {
    const last = blocks.at(-1);
    if (last && op.aStart === last.aEnd && op.bStart === last.bEnd) {
      last.op = "changed";
      last.aLines = [...last.aLines, ...op.aLines];
      last.aEnd = op.aStart + op.aLines.length;
      last.bLines = [...last.bLines, ...op.bLines];
      last.bEnd = op.bStart + op.bLines.length;
      continue;
    }
    blocks.push({
      op: op.type === "removed" ? "removed" : op.type === "added" ? "added" : "changed",
      aStart: op.aStart,
      aLines: op.aLines,
      aEnd: op.aStart + op.aLines.length,
      bStart: op.bStart,
      bLines: op.bLines,
      bEnd: op.bStart + op.bLines.length,
    });
  }
  return { granularity, blocks, maxBlocks };
}

const cap = (lines) => ({
  lines: lines.slice(0, SNIPPET_LINES),
  truncated: lines.length > SNIPPET_LINES,
});

export function contentCompare() {
  const fileA = path.resolve(required("--a"));
  const fileB = path.resolve(required("--b"));
  const strict = process.argv.includes("--strict");
  const maxBlocks = Math.max(1, Number(valueFor("--max-blocks") ?? 40) || 40);
  for (const [name, file] of [["--a", fileA], ["--b", fileB]]) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile())
      fail(`${name} 文件不存在或不是普通文件：${file}`);
  }
  const bytesA = fs.readFileSync(fileA);
  const bytesB = fs.readFileSync(fileB);
  const side = (file, bytes) => ({
    file: displayPath(file),
    bytes: bytes.length,
    sha256: sha256(bytes),
  });
  const a = side(fileA, bytesA);
  const b = side(fileB, bytesB);
  const identical = a.sha256 === b.sha256;
  let changed = !identical;
  let normalizedIdentical = false;
  let diff = null;
  let note = null;
  if (!identical) {
    if (looksBinary(bytesA) || looksBinary(bytesB)) {
      note = "存在二进制内容，仅字节哈希可比，不提供行级差异。";
    } else {
      const foldA = foldText(bytesA.toString("utf8"));
      const foldB = foldText(bytesB.toString("utf8"));
      if (!strict && foldA === foldB) {
        normalizedIdentical = true;
        changed = false;
      } else {
        diff = diffBlocks(foldA ? foldA.split("\n") : [], foldB ? foldB.split("\n") : [], maxBlocks);
        // 差异块全部只由空白行构成：视为未变（保留 diff 供追溯）。
        if (
          !strict &&
          diff.blocks.every((x) =>
            [...x.aLines, ...x.bLines].every((line) => !line.trim()),
          )
        ) {
          normalizedIdentical = true;
          changed = false;
        }
      }
    }
  }
  const result = {
    schemaVersion: 1,
    command: "content compare",
    mode: strict ? "strict" : "normalized",
    a,
    b,
    identical,
    normalizedIdentical,
    changed,
    ...(note ? { note } : {}),
    ...(diff
      ? {
          diff: {
            granularity: diff.granularity,
            addedLines: diff.blocks.reduce((s, x) => s + (x.op !== "removed" ? x.bLines.length : 0), 0),
            removedLines: diff.blocks.reduce((s, x) => s + (x.op !== "added" ? x.aLines.length : 0), 0),
            blockCount: diff.blocks.length,
            truncated: diff.blocks.length > maxBlocks,
            blocks: diff.blocks.slice(0, maxBlocks).map((x) => ({
              op: x.op,
              a: { from: x.aStart + 1, to: x.aEnd, ...cap(x.aLines) },
              b: { from: x.bStart + 1, to: x.bEnd, ...cap(x.bLines) },
            })),
          },
        }
      : {}),
  };
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (identical) {
    console.log("相同（字节级一致）。");
  } else if (normalizedIdentical) {
    console.log("仅空白/行尾差异，内容视为未变（--strict 可按字节判定）。");
  } else if (note) {
    console.log(`内容不同：${note}`);
  } else {
    console.log(
      `内容已变化：${diff.blocks.length} 个差异块（粒度 ${diff.granularity}；${diff.granularity === "exact" ? "详见 --json 的 blocks" : "行数超上限，块级粗对比"}）。`,
    );
  }
  if (changed && process.argv.includes("--fail-on-changed")) process.exitCode = 1;
}
