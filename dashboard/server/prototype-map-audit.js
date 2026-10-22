import fs from "node:fs";
import { indexedProjectionProblems } from "./prototype-index-guard.js";
import { graphProblems } from "../../modules/prototype/core/graph-audit.js";
import path from "node:path";
import { digest, discoverPrototypeSource, sourceMapMarkdown } from "./prototype-source-map.js";
import { STORE_DIRECTORY } from "../../modules/skill-identity.mjs";

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
export function createPrototypeMap({ workspaceRoot, runDirectory }) {
  const runFile = path.join(runDirectory, "run.json");
  const run = read(runFile);
  if (run.type !== "prototype" || !["pending", "in_progress"].includes(run.status)) throw new Error("仅可为尚未取证的进行中原型运行生成地图");
  const coverage = read(path.join(runDirectory, "coverage.json"));
  if (JSON.stringify(coverage).includes('"observed"') || fs.readdirSync(path.join(runDirectory, "screenshots")).length) throw new Error("已有操作证据，不能事后生成分母；请新建原型运行，保留旧记录");
  const names = ["source-map.json", "source-map.md", "interaction-map.json"];
  if (run.sourceMap || names.some((name) => fs.existsSync(path.join(runDirectory, name)))) throw new Error("源码发现地图已存在，不覆盖；源码变化应新建运行");
  const project = read(path.join(workspaceRoot, STORE_DIRECTORY, "project.json"));
  const discovered = discoverPrototypeSource({ workspaceRoot, location: project.prototype?.location });
  const map = { ...discovered, createdAt: new Date().toISOString() };
  const serialized = `${JSON.stringify(map, null, 2)}\n`;
  const hash = digest(serialized);
  const interaction = {
    schemaVersion: 1, sourceMapHash: hash, status: "not_started",
    candidateReviews: [], nodes: [], edges: [], stateSpaces: [],
    runtimeDiscoveries: [], runtimeSweeps: [],
    remainingCandidateIds: map.candidates.map((candidate) => candidate.id),
    remainingEdgeIds: [],
  };
  // All validation/reads occur before creating files. Exclusive writes never replace history.
  fs.writeFileSync(path.join(runDirectory, names[0]), serialized, { flag: "wx" });
  fs.writeFileSync(path.join(runDirectory, names[1]), sourceMapMarkdown(map), { flag: "wx" });
  fs.writeFileSync(path.join(runDirectory, names[2]), `${JSON.stringify(interaction, null, 2)}\n`, { flag: "wx" });
  fs.writeFileSync(runFile, `${JSON.stringify({ ...run, sourceMap: { path: names[0], sha256: hash, createdAt: map.createdAt } }, null, 2)}\n`);
  return { files: names, candidates: map.candidates.length, problems: map.problems };
}

export function prototypeMapProblems({ workspaceRoot, runDirectory, run, coverage }) {
  try {
    const indexedProblems = indexedProjectionProblems(runDirectory);
    if (indexedProblems.length) return indexedProblems;
    const sourceFile = path.join(runDirectory, "source-map.json");
    const graphFile = path.join(runDirectory, "interaction-map.json");
    if (!fs.existsSync(sourceFile) || !fs.existsSync(graphFile)) return ["缺少操作前独立生成的 source-map.json / interaction-map.json；旧截图覆盖率不证明全量交互完整，请新建运行后 prototype map"];
    const sourceBytes = fs.readFileSync(sourceFile);
    const source = JSON.parse(sourceBytes);
    const graph = read(graphFile);
    const project = read(path.join(workspaceRoot, STORE_DIRECTORY, "project.json"));
    const current = discoverPrototypeSource({ workspaceRoot, location: project.prototype?.location });
    return graphProblems({ runDirectory, run, coverage, sourceBytes, source, graph, current });
  } catch (error) { return [`原型地图无法核验：${error.message}`]; }
}
