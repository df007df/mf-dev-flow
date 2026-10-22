// Object Ref 的公共只读定位器。它只读取既有真源，绝不分配编号或回填记录。
import fs from "node:fs";
import path from "node:path";

import { parseObjectRef } from "../kernel/object-ref.mjs";
import { hasPrototypeCatalog, planningPrototype } from "../prototype/client.mjs";
import { STORE_DIRECTORY } from "../skill-identity.mjs";

const MAX_JSON_BYTES = 2 * 1024 * 1024;

class LocateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const invalidRef = (message) => new LocateError("invalid_ref", message);
const invalidStore = (message) => new LocateError("invalid_store", message);
const notFound = (ref) => new LocateError("not_found", `找不到对象：${ref}`);

function inside(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function workspaceRoot(root) {
  try {
    const resolved = fs.realpathSync(root);
    if (!fs.statSync(resolved).isDirectory()) throw new Error("not a directory");
    return resolved;
  } catch {
    throw invalidStore("工作区根目录不可访问");
  }
}

function publicRelative(root, file) {
  const relative = path.relative(root, file);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`))
    throw invalidStore("真源路径越出工作区");
  return relative.split(path.sep).join("/");
}

function existingFile(root, relative) {
  const requested = path.resolve(root, relative);
  if (!inside(root, requested)) throw invalidStore("真源路径越出工作区");
  let stat;
  try {
    stat = fs.statSync(requested);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw invalidStore(`无法读取真源：${publicRelative(root, requested)}`);
  }
  if (!stat.isFile()) return null;
  let resolved;
  try {
    resolved = fs.realpathSync(requested);
  } catch {
    throw invalidStore(`无法解析真源：${publicRelative(root, requested)}`);
  }
  if (!inside(root, resolved)) throw invalidStore("真源符号链接越出工作区");
  return { file: requested, real: resolved, path: publicRelative(root, requested), bytes: stat.size };
}

function readJson(root, relative) {
  const source = existingFile(root, relative);
  if (!source) return null;
  if (source.bytes > MAX_JSON_BYTES) throw invalidStore(`真源文件超过 ${MAX_JSON_BYTES} bytes：${source.path}`);
  try {
    return { source, value: JSON.parse(fs.readFileSync(source.file, "utf8")) };
  } catch (error) {
    throw invalidStore(`真源 JSON 无法解析：${source.path}（${error.message.slice(0, 160)}）`);
  }
}

function storeFile(root, storage) {
  return path.posix.join(STORE_DIRECTORY, storage);
}

function storeTruth(root, storage, pointer) {
  const source = existingFile(root, storeFile(root, storage));
  if (!source) return null;
  return { storage, pointer, path: source.path };
}

function pointerPart(value) {
  return String(value).replace(/~/g, "~0").replace(/\//g, "~1");
}

function records(value, name) {
  return Array.isArray(value?.[name]) ? value[name] : [];
}

function recordById(value, name, id) {
  return records(value, name).find((record) => record?.id === id) ?? null;
}

function safeRecordPart(value) {
  return typeof value === "string"
    && value.length > 0
    && !value.includes("\\")
    && !value.includes(":")
    && !path.posix.isAbsolute(value)
    && !path.win32.isAbsolute(value);
}

function keyParts(object, expected) {
  const parts = object.key.split("/");
  if (parts.length !== expected || parts.some((part) => !safeRecordPart(part)))
    throw invalidRef(`Object Ref 的 ${object.kind} 键格式无效`);
  return parts;
}

function basicSummary(record, fallbackId) {
  const result = { id: record?.id ?? fallbackId };
  for (const key of ["title", "name", "status", "kind", "parentId", "updatedAt"]) {
    if (record?.[key] !== undefined && record[key] !== null) result[key] = record[key];
  }
  return result;
}

function found(object, truthPointer, summary) {
  if (!truthPointer) return null;
  return { schemaVersion: 1, object, truthPointer, summary };
}

function locateProject(root, object) {
  if (object.key !== "project") throw invalidRef("project 的键必须是 project");
  const source = readJson(root, storeFile(root, "project.json"));
  if (!source) return null;
  const project = source.value?.project ?? source.value ?? {};
  return found(object, storeTruth(root, "project.json", "/"), {
    id: "project",
    name: project.name ?? source.value?.name ?? null,
  });
}

function locateProjectCard(root, object) {
  const [id] = keyParts(object, 1);
  const storage = `projects/${id}.json`;
  const source = readJson(root, storeFile(root, storage));
  if (!source || (source.value?.id && source.value.id !== id)) return null;
  return found(object, storeTruth(root, storage, "/"), basicSummary(source.value, id));
}

function legacyPrototype(root, object) {
  const index = readJson(root, storeFile(root, "prototype/feature-index.json"));
  const coverage = readJson(root, storeFile(root, "prototype/coverage.json"));
  if (object.kind === "prototype-group") {
    const group = recordById(index?.value, "features", object.key);
    return group
      ? found(object, storeTruth(root, "prototype/feature-index.json", `/features/${pointerPart(object.key)}`), basicSummary(group, object.key))
      : null;
  }
  if (object.kind === "prototype-entry") {
    const entry = recordById(coverage?.value?.sourceInventory, "entries", object.key);
    return entry
      ? found(object, storeTruth(root, "prototype/coverage.json", `/sourceInventory/entries/${pointerPart(object.key)}`), basicSummary(entry, object.key))
      : null;
  }
  const source = records(coverage?.value?.sourceInventory, "sourceFiles")
    .find((entry) => entry?.path === object.key) ?? null;
  return source
    ? found(object, storeTruth(root, "prototype/coverage.json", `/sourceInventory/sourceFiles/${pointerPart(object.key)}`), {
      path: source.path,
      title: source.path,
      sha256: source.sha256 ?? null,
    })
    : null;
}

function catalogPrototype(root, object) {
  let view;
  try {
    // 只经 prototype 的公共 transport 读 catalog；runtime 不触碰 SQLite 表。
    view = planningPrototype(root);
  } catch (error) {
    throw invalidStore(`原型 catalog 查询失败：${error.message.slice(0, 240)}`);
  }
  if (object.kind === "prototype-group") {
    const group = (view.features ?? []).find((entry) => entry?.id === object.key) ?? null;
    return group
      ? found(object, storeTruth(root, "prototype/catalog.sqlite", `/semantic/groups/${pointerPart(object.key)}`), basicSummary(group, object.key))
      : null;
  }
  if (object.kind === "prototype-entry") {
    const entry = (view.sourceEntries ?? []).find((item) => item?.id === object.key) ?? null;
    return entry
      ? found(object, storeTruth(root, "prototype/catalog.sqlite", `/semantic/entries/${pointerPart(object.key)}`), basicSummary(entry, object.key))
      : null;
  }
  const source = (view.revision?.sourceFiles ?? []).find((entry) => entry?.path === object.key) ?? null;
  return source
    ? found(object, storeTruth(root, "prototype/catalog.sqlite", `/sourceFiles/${pointerPart(object.key)}`), {
      path: source.path,
      title: source.path,
      sha256: source.sha256 ?? null,
    })
    : null;
}

function locatePrototype(root, object) {
  if (hasPrototypeCatalog(root)) return catalogPrototype(root, object);
  return legacyPrototype(root, object);
}

function locatePrd(root, object) {
  if (object.kind === "prd-source") {
    const [id] = keyParts(object, 1);
    const manifest = readJson(root, storeFile(root, "prd/manifest.json"));
    const source = recordById(manifest?.value, "sources", id);
    return source
      ? found(object, storeTruth(root, "prd/manifest.json", `/sources/${pointerPart(id)}`), basicSummary(source, id))
      : null;
  }
  const [id] = keyParts(object, 1);
  const storage = `prd/analyses/${id}/findings.json`;
  const findings = readJson(root, storeFile(root, storage));
  if (!findings || (findings.value?.batchId && findings.value.batchId !== id)) return null;
  return found(object, storeTruth(root, storage, "/"), {
    id,
    title: findings.value?.title ?? id,
    sourceCount: Array.isArray(findings.value?.sources) ? findings.value.sources.length : 0,
    itemCount: Array.isArray(findings.value?.items) ? findings.value.items.length : 0,
  });
}

function locateSystemCard(root, object) {
  const [id] = keyParts(object, 1);
  const document = readJson(root, storeFile(root, "system/cards.json"));
  const card = recordById(document?.value, "cards", id);
  return card
    ? found(object, storeTruth(root, "system/cards.json", `/cards/${pointerPart(id)}`), basicSummary(card, id))
    : null;
}

function locateFeature(root, object) {
  const [id] = keyParts(object, 1);
  const document = readJson(root, storeFile(root, "planning/feature-map.json"));
  const collection = object.kind === "feature-group" ? "groups" : "features";
  const feature = recordById(document?.value, collection, id);
  return feature
    ? found(object, storeTruth(root, "planning/feature-map.json", `/${collection}/${pointerPart(id)}`), basicSummary(feature, id))
    : null;
}

function locateRun(root, object) {
  const [type, id] = keyParts(object, 2);
  const storage = type === "kernel"
    ? `tasks/${id}.json`
    : `${type}-runs/${id}/run.json`;
  const run = readJson(root, storeFile(root, storage));
  if (!run || (run.value?.id && run.value.id !== id)) return null;
  return found(object, storeTruth(root, storage, "/"), {
    ...basicSummary(run.value, id),
    type: run.value?.type ?? type,
  });
}

function locateTask(root, object) {
  const [type, runId, taskId] = keyParts(object, 3);
  if (type === "kernel") {
    const storage = `tasks/${runId}/${taskId}.json`;
    const task = readJson(root, storeFile(root, storage));
    if (!task || (task.value?.id && task.value.id !== `${runId}/${taskId}`)) return null;
    return found(object, storeTruth(root, storage, "/"), basicSummary(task.value, taskId));
  }
  const runStorage = `${type}-runs/${runId}/run.json`;
  const planStorage = `${type}-runs/${runId}/work-plan.json`;
  const run = readJson(root, storeFile(root, runStorage));
  const plan = readJson(root, storeFile(root, planStorage));
  if (!run || !plan || (run.value?.id && run.value.id !== runId)) return null;
  const task = recordById(plan.value, "tasks", taskId);
  if (!task) return null;
  const execution = readJson(root, storeFile(root, `${type}-runs/${runId}/executions/${taskId}.json`));
  return found(object, storeTruth(root, planStorage, `/tasks/${pointerPart(taskId)}`), {
    ...basicSummary(task, taskId),
    status: execution?.value?.status ?? task.status ?? "pending",
    runId,
  });
}

function locateCodeFile(root, object) {
  const parts = object.key.split("/");
  if (!parts.length || parts.some((part) => !safeRecordPart(part)))
    throw invalidRef("code-file 的键必须是工作区内的 POSIX 相对路径");
  const source = existingFile(root, parts.join(path.sep));
  if (!source) return null;
  return found(object, { storage: source.path, pointer: "/", path: source.path }, {
    path: source.path,
    title: source.path,
    bytes: source.bytes,
    extension: path.extname(source.path) || null,
  });
}

export function locateObject(root, ref) {
  const object = typeof ref === "string" ? parseObjectRef(ref) : ref;
  if (!object || object.schemaVersion !== 1) throw invalidRef("Object Ref 格式无效");
  const workspace = workspaceRoot(root);
  let result;
  switch (object.kind) {
    case "project": result = locateProject(workspace, object); break;
    case "project-card": result = locateProjectCard(workspace, object); break;
    case "prototype-group":
    case "prototype-entry":
    case "prototype-source": result = locatePrototype(workspace, object); break;
    case "prd-source":
    case "prd-batch": result = locatePrd(workspace, object); break;
    case "system-card": result = locateSystemCard(workspace, object); break;
    case "feature-group":
    case "feature": result = locateFeature(workspace, object); break;
    case "run": result = locateRun(workspace, object); break;
    case "task": result = locateTask(workspace, object); break;
    case "code-file": result = locateCodeFile(workspace, object); break;
    // V1 预留 release 的格式，当前 mf-dev-flow 尚没有 release 真源，不能猜目录或伪造定位。
    case "release": result = null; break;
    default: throw invalidRef("Object Ref kind 未注册");
  }
  if (!result) throw notFound(object.ref);
  return result;
}

function argumentValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw invalidRef(`缺少 ${flag}`);
  return value;
}

export function objectLocate() {
  try {
    const ref = argumentValue(process.argv.slice(4), "--ref");
    if (!ref) throw invalidRef("用法：object locate --ref <mf-dev-flow:kind:key> --json");
    process.stdout.write(`${JSON.stringify(locateObject(process.cwd(), ref))}\n`);
  } catch (error) {
    const code = error instanceof LocateError ? error.code : "internal_error";
    const message = String(error?.message ?? error).slice(0, 700);
    process.stdout.write(`${JSON.stringify({ schemaVersion: 1, error: { code, message } })}\n`);
    process.exitCode = 1;
  }
}
