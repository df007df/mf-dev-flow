import fs from "node:fs";
import path from "node:path";
import { json } from "./readers/archive.js";
import { taskSummary, runSummary } from "./readers/runs.js";
import {
  prototypeSummary,
  systemSummary,
  projectCardsSummary,
} from "./readers/sources.js";
import { planningSummary } from "./readers/planning.js";
import { prdSummary } from "./readers/prd.js";
import { objectRefOrNull } from "../../modules/kernel/object-ref.mjs";
export {
  prototypeQuestionProblems,
  prototypeQuestions,
} from "./readers/questions.js";
export { runDetail } from "./readers/runs.js";

export function dashboardState(store) {
  const project = json(path.join(store, "project.json"));
  const current = json(path.join(store, "current.json"), { active: null });
  const prototype = prototypeSummary(store);
  const system = systemSummary(store);
  const projectCards = projectCardsSummary(store);
  const planning = planningSummary(store);
  const prd = prdSummary(store);
  const compaction = json(path.join(store, "compaction", "index.json"));
  const runs = ["prototype", "delivery", "system", "refinement"]
    .flatMap((type) => {
      const root = path.join(store, `${type}-runs`);
      if (!fs.existsSync(root)) return [];
      return fs
        .readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => runSummary(store, type, entry.name))
        .filter(Boolean);
    })
    .sort((left, right) =>
      String(right.updatedAt).localeCompare(String(left.updatedAt)),
    );
  const allTasks = runs.flatMap((run) =>
    Object.entries(run.taskCounts).flatMap(([status, count]) =>
      Array(count).fill(status),
    ),
  );
  return {
    project: project
      ? { ...project, ref: objectRefOrNull("project", "project") }
      : project,
    current,
    generatedAt: new Date().toISOString(),
    summary: {
      runs: runs.length,
      activeRuns: runs.filter((run) =>
        ["pending", "in_progress", "blocked"].includes(run.status),
      ).length,
      tasks: taskSummary(allTasks.map((status) => ({ status }))),
    },
    prototype,
    projectCards,
    system,
    planning,
    prd,
    compaction,
    runs,
  };
}
