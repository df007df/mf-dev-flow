// 项目内 Object Ref（V1）：纯格式层，不读写 .mf-dev-flow。
// Object Ref 与 graph 的 prefix:id 是两个协议；后者只是前者的可建图子集。

import { OBJECT_REF_PREFIX } from "../skill-identity.mjs";

export const OBJECT_REF_SCHEMA_VERSION = 1;

export const OBJECT_KINDS = Object.freeze([
  "project",
  "project-card",
  "prototype-group",
  "prototype-entry",
  "prototype-source",
  "prd-source",
  "prd-batch",
  "system-card",
  "feature-group",
  "feature",
  "run",
  "task",
  "release",
  "code-file",
]);

const OBJECT_KIND_SET = new Set(OBJECT_KINDS);
const CONTROL = /[\u0000-\u001f\u007f]/;

// `prototype` 在 graph 中依赖 entryRefs 再区分 group/entry，故这里保留同一前缀。
export const GRAPH_REF_PREFIX_BY_OBJECT_KIND = Object.freeze({
  "prototype-group": "prototype",
  "prototype-entry": "prototype",
  "prototype-source": "source",
  "prd-source": "prd",
  "system-card": "system",
  "feature-group": "feature-group",
  feature: "feature",
  "code-file": "code",
  project: "project",
  task: "task",
  release: "release",
});

export const GRAPH_REF_PREFIXES = Object.freeze(
  [...new Set(Object.values(GRAPH_REF_PREFIX_BY_OBJECT_KIND))],
);

const GRAPH_REF_PREFIX_SET = new Set(GRAPH_REF_PREFIXES);

function requireKind(kind) {
  if (!OBJECT_KIND_SET.has(kind)) throw new Error(`未知 Object Ref kind：${String(kind)}`);
  return kind;
}

function requireSegment(segment) {
  if (typeof segment !== "string" || !segment || CONTROL.test(segment) || segment === "." || segment === "..")
    throw new Error("非法 Object Ref 键分段");
  if (segment.includes("/")) throw new Error("Object Ref 键分段不能包含 /");
  return segment;
}

function splitKey(key) {
  if (typeof key !== "string" || !key || CONTROL.test(key)) throw new Error("非法 Object Ref 键");
  return key.split("/").map(requireSegment);
}

function encodeSegment(segment) {
  return encodeURIComponent(requireSegment(segment));
}

export function objectRefFor(kind, ...segments) {
  requireKind(kind);
  if (!segments.length) throw new Error("Object Ref 至少需要一个键分段");
  return `${OBJECT_REF_PREFIX}${kind}:${segments.map(encodeSegment).join("/")}`;
}

export function formatObjectRef({ kind, key }) {
  return objectRefFor(requireKind(kind), ...splitKey(key));
}

// 面向历史只读投影：坏的旧键不应让看板或摘要整体失败，也不能被猜测性改写。
export function objectRefOrNull(kind, key) {
  try {
    return formatObjectRef({ kind, key });
  } catch {
    return null;
  }
}

export function parseObjectRef(ref) {
  if (typeof ref !== "string" || CONTROL.test(ref)) return null;
  const match = new RegExp(`^${OBJECT_REF_PREFIX}([a-z][a-z0-9-]*):(.+)$`).exec(ref);
  if (!match) return null;
  const [, kind, encodedKey] = match;
  if (!OBJECT_KIND_SET.has(kind)) return null;
  let segments;
  try {
    segments = encodedKey.split("/").map((encoded) => {
      if (!encoded) throw new Error("empty");
      const decoded = decodeURIComponent(encoded);
      requireSegment(decoded);
      if (encodeURIComponent(decoded) !== encoded) throw new Error("non-canonical");
      return decoded;
    });
  } catch {
    return null;
  }
  const key = segments.join("/");
  if (formatObjectRef({ kind, key }) !== ref) return null;
  return { schemaVersion: OBJECT_REF_SCHEMA_VERSION, kind, key, ref };
}

export function graphRefPrefix(ref) {
  if (typeof ref !== "string" || CONTROL.test(ref)) return null;
  const index = ref.indexOf(":");
  if (index <= 0 || index === ref.length - 1) return null;
  const prefix = ref.slice(0, index);
  const id = ref.slice(index + 1);
  if (!GRAPH_REF_PREFIX_SET.has(prefix) || /\s/.test(id)) return null;
  return prefix;
}

export function graphRefKind(ref) {
  return graphRefPrefix(ref);
}

export function toGraphRef(ref) {
  const parsed = parseObjectRef(ref);
  if (!parsed) return null;
  const prefix = GRAPH_REF_PREFIX_BY_OBJECT_KIND[parsed.kind];
  return prefix ? `${prefix}:${parsed.key}` : null;
}
