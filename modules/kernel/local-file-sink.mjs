import fs from "node:fs";
import path from "node:path";
import { validateRunRecord, validateTaskRecord } from "./record.mjs";
import { STORE_DIRECTORY } from "../skill-identity.mjs";

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

export function writeLocalKernelRecords({ projectRoot, runRecord, taskRecords }) {
  const runProblems = validateRunRecord(runRecord);
  if (runProblems.length) throw new Error(`kernel 运行记录非法：${runProblems.join("；")}`);
  for (const taskRecord of taskRecords) {
    const problems = validateTaskRecord(taskRecord);
    if (problems.length)
      throw new Error(`kernel 任务记录非法（${taskRecord.id}）：${problems.join("；")}`);
  }
  const tasksDir = path.join(projectRoot, STORE_DIRECTORY, "tasks");
  writeJsonAtomic(path.join(tasksDir, `${runRecord.id}.json`), runRecord);
  for (const taskRecord of taskRecords) {
    const fileName = taskRecord.runId === runRecord.id
      ? taskRecord.id.slice(runRecord.id.length + 1)
      : taskRecord.id;
    writeJsonAtomic(path.join(tasksDir, runRecord.id, `${fileName}.json`), taskRecord);
  }
}
