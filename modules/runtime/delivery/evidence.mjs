// Delivery command family — screenshot / mock / visual acceptance evidence.
// Extracted from runtime/delivery.mjs (structural split; behavior unchanged).

import path from "node:path";

import fs from "node:fs";

import { prototypeArchiveDirectory } from "../../prototype/client.mjs";

import { ADDITIONAL_SCREENSHOT_EVIDENCE } from "../../../dashboard/server/delivery-contract.js";

import {
  API_DELIVERY_ROLE,
  executionIsResumableCheckpoint,
  projectRootForDeliveryTarget,
} from "./helpers.mjs";

import {
  STORE,
  UI_DELIVERY_ROLE,
  additionalScreenshots,
  additionalScreenshotsFile,
  apiMockEvidence,
  apiMockEvidenceFile,
  canonicalTaskPhase,
  deliveryRoles,
  ensureProject,
  ensureWorkPlan,
  executionFile,
  fail,
  fileWithin,
  isContinuousDeliveryTask,
  miniappEvidence,
  miniappEvidenceFile,
  now,
  projectCardFile,
  projectCardId,
  readJson,
  required,
  resolveRun,
  slug,
  syncDeliveryReports,
  taskDeliveryTargetsFor,
  taskHasDeliveryRole,
  validationScreenshotPairProblems,
  validationScreenshotPairs,
  validationScreenshotPairsFile,
  valueFor,
  visualRegionReviewFile,
  visualRegionReviews,
  writeJson,
} from "../shared.mjs";

export function miniappScreenshotDirectory(run) {
  return path.join(run.dir, "screenshots", "wechatide");
}

export function taskE2eEvidencePolicy(task) {
  const target = taskDeliveryTargetsFor(task).find((item) =>
    item.deliveryRoles?.includes(UI_DELIVERY_ROLE),
  );
  if (target?.e2eEvidencePolicy) return target.e2eEvidencePolicy;
  const project = ensureProject();
  const root = projectRootForDeliveryTarget(project, task.deliveryTarget?.path);
  if (!root) return null;
  const cardFile = projectCardFile(projectCardId(root));
  if (!fs.existsSync(cardFile)) return null;
  return readJson(cardFile)?.documentation?.testing?.e2eEvidencePolicy ?? null;
}

export function miniappScreenshotProblems(run, task) {
  const policy = taskE2eEvidencePolicy(task);
  if (policy?.runner !== "wechatide") return [];
  const matching = miniappEvidence(run).evidence.filter(
    (item) => item.taskId === task.id,
  );
  if (!matching.length)
    return [
      `微信小程序任务 ${task.id} 缺少微信开发者工具 simulator_screenshot 证据。`,
    ];
  const problems = [];
  for (const item of matching) {
    const screenshot = path.resolve(run.dir, item.screenshot ?? "");
    if (
      !fileWithin(screenshot, miniappScreenshotDirectory(run)) ||
      !fs.existsSync(screenshot)
    )
      problems.push(
        `微信小程序任务 ${task.id} 的截图不存在或不在 screenshots/wechatide/：${item.screenshot ?? "—"}`,
      );
    if (
      item.runner !== "wechatide" ||
      item.screenshotTool !== "simulator_screenshot"
    )
      problems.push(
        `微信小程序任务 ${task.id} 的截图未声明为微信开发者工具 simulator_screenshot。`,
      );
    if (
      !String(item.page ?? "").trim() ||
      !String(item.selector ?? "").trim() ||
      !String(item.action ?? "").trim()
    )
      problems.push(
        `微信小程序任务 ${task.id} 的截图证据缺少页面、选择器或复现动作。`,
      );
    if (
      !String(item.consoleResult ?? "").trim() ||
      !String(item.networkResult ?? "").trim()
    )
      problems.push(
        `微信小程序任务 ${task.id} 的截图证据缺少 console 或 network 核验结论。`,
      );
  }
  problems.push(
    // 小程序 E2E 会同时保留首页主图和领取成功等流程结果图。只有主验收
    // 状态需要原型/UI 固定截图对；不能把数组最后一张补充结果图误当成主图，
    // 否则已归档的成功态会反过来阻塞首页原型对齐。
    ...validationScreenshotPairProblems(run, task),
  );
  return problems;
}

export function miniappEvidenceCommand() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "delivery") fail("miniapp evidence 只能用于开发运行。");
  const plan = ensureWorkPlan(run);
  const taskId = slug(required("--task"));
  const task = plan.tasks.find((item) => item.id === taskId);
  if (!task) fail(`未规划任务：${taskId}`);
  if (
    !isContinuousDeliveryTask(task) &&
    !["prototype_alignment", "end_to_end_acceptance"].includes(
      canonicalTaskPhase(task.phase),
    )
  )
    fail(`任务 ${taskId} 不属于需要小程序截图的 UI 阶段。`);
  if (
    isContinuousDeliveryTask(task) &&
    !taskHasDeliveryRole(task, UI_DELIVERY_ROLE)
  )
    fail(`连续开发任务 ${taskId} 未绑定 ui-client 项目，不能登记小程序截图。`);
  if (taskE2eEvidencePolicy(task)?.runner !== "wechatide")
    fail(`任务 ${taskId} 的项目卡片未要求微信开发者工具截图。`);
  const execution = fs.existsSync(executionFile(run, taskId))
    ? readJson(executionFile(run, taskId))
    : null;
  if (execution?.status !== "in_progress")
    fail(`任务 ${taskId} 必须已领取且进行中，才能登记小程序截图。`);
  const screenshot = controlledScreenshot(
    required("--screenshot"),
    miniappScreenshotDirectory(run),
    "微信开发者工具模拟器截图",
  );
  const record = {
    id: `${now()}-${taskId}`,
    taskId,
    screenshot: path.relative(run.dir, screenshot),
    runner: "wechatide",
    screenshotTool: "simulator_screenshot",
    page: required("--page"),
    selector: required("--selector"),
    action: required("--action"),
    consoleResult: required("--console"),
    networkResult: required("--network"),
    capturedAt: now(),
  };
  const evidence = miniappEvidence(run);
  evidence.evidence.push(record);
  evidence.updatedAt = record.capturedAt;
  writeJson(miniappEvidenceFile(run), evidence);
  syncDeliveryReports(run);
  console.log(
    `已登记 ${run.id}/${taskId} 的微信开发者工具截图：${record.screenshot}`,
  );
}

export function apiMockScreenshotDirectory(run) {
  return path.join(run.dir, "screenshots", "api-mock");
}

export function controlledMockResponse(file, directory) {
  const target = path.resolve(process.cwd(), file);
  if (
    !fileWithin(target, directory) ||
    !fs.existsSync(target) ||
    !fs.statSync(target).isFile()
  )
    fail(`接口 Mock 完整 JSON 必须是受控目录中的现有文件：${file}`);
  if (path.extname(target).toLowerCase() !== ".json")
    fail(`接口 Mock 完整 JSON 必须使用 .json 文件：${file}`);
  try {
    return { target, value: JSON.parse(fs.readFileSync(target, "utf8")) };
  } catch {
    fail(`接口 Mock 完整 JSON 无法解析：${file}`);
  }
}

function jsonValueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function mockResponseFieldDefinitions(value, fieldPath = "$") {
  const definitions = [{ path: fieldPath, type: jsonValueType(value) }];
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      definitions.push(...mockResponseFieldDefinitions(item, `${fieldPath}[${index}]`));
    });
  } else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => {
      definitions.push(...mockResponseFieldDefinitions(item, `${fieldPath}.${key}`));
    });
  }
  return definitions;
}

function mockResponseProblems(run, task, item) {
  const problems = [];
  if (!Object.hasOwn(item, "response") || !Array.isArray(item.fieldDefinitions))
    return [`接口 Mock 任务 ${task.id} 缺少完整 JSON 响应或字段定义。`];
  if (!String(item.responseFile ?? "").trim())
    return [`接口 Mock 任务 ${task.id} 缺少完整 JSON 响应文件。`];
  const responseFile = path.resolve(run.dir, item.responseFile);
  if (
    !fileWithin(responseFile, apiMockScreenshotDirectory(run)) ||
    !fs.existsSync(responseFile) ||
    path.extname(responseFile).toLowerCase() !== ".json"
  )
    return [`接口 Mock 任务 ${task.id} 的完整 JSON 不在 screenshots/api-mock/：${item.responseFile}`];
  try {
    const response = JSON.parse(fs.readFileSync(responseFile, "utf8"));
    if (JSON.stringify(response) !== JSON.stringify(item.response))
      problems.push(`接口 Mock 任务 ${task.id} 的登记 JSON 与归档响应不一致。`);
    const expected = mockResponseFieldDefinitions(item.response);
    if (JSON.stringify(expected) !== JSON.stringify(item.fieldDefinitions))
      problems.push(`接口 Mock 任务 ${task.id} 的返回字段定义与完整 JSON 不一致。`);
  } catch {
    problems.push(`接口 Mock 任务 ${task.id} 的完整 JSON 无法解析。`);
  }
  return problems;
}

export function controlledScreenshot(file, directory, label) {
  const target = path.resolve(process.cwd(), file);
  if (
    !fileWithin(target, directory) ||
    !fs.existsSync(target) ||
    !fs.statSync(target).isFile()
  )
    fail(`${label}必须是受控截图目录中的现有文件：${file}`);
  if (!/\.(png|jpe?g|webp)$/i.test(target))
    fail(`${label}只支持 PNG、JPEG 或 WebP：${file}`);
  return target;
}

export function validationTask(run, taskId, uiProject) {
  const plan = ensureWorkPlan(run);
  const task = plan.tasks.find((item) => item.id === slug(taskId));
  if (!task) fail(`未规划任务：${taskId}`);
  if (!taskHasDeliveryRole(task, UI_DELIVERY_ROLE))
    fail(`任务 ${task.id} 未绑定 ui-client 项目，不能登记验证截图对。`);
  if (!taskDeliveryTargetsFor(task).some((target) => target.path === uiProject))
    fail(`任务 ${task.id} 未绑定 ui-client 项目 ${uiProject}。`);
  const execution = fs.existsSync(executionFile(run, task.id))
    ? readJson(executionFile(run, task.id))
    : null;
  if (
    execution?.status !== "in_progress" &&
    !executionIsResumableCheckpoint(task, execution)
  )
    fail(`任务 ${task.id} 必须进行中或处于可续做检查点，才能登记验证截图对。`);
  return task;
}

export function validationScreenshotSourceSystem(run, role, uiProject) {
  if (role === "reference") {
    return {
      kind: "prototype-run",
      id: run.run.prototypeRun,
      label: `原型运行 · ${run.run.prototypeRun}`,
    };
  }
  return {
    kind: "ui-client-project",
    id: uiProject,
    label: `ui-client · ${uiProject}`,
  };
}

export function registerValidationScreenshotPair({
  run,
  task,
  state,
  reference,
  result,
  uiProject,
  action,
}) {
  const referencePath = path.relative(STORE, reference);
  const resultPath = path.relative(STORE, result);
  const pairs = validationScreenshotPairs(run);
  const existing = pairs.pairs.find(
    (pair) =>
      pair.taskId === task.id &&
      pair.state === state &&
      pair.uiProject === uiProject &&
      pair.screenshots?.some(
        (shot) => shot.role === "reference" && shot.path === referencePath,
      ) &&
      pair.screenshots?.some(
        (shot) => shot.role === "result" && shot.path === resultPath,
      ),
  );
  if (existing) {
    let changed = false;
    for (const shot of existing.screenshots ?? []) {
      const expected = validationScreenshotSourceSystem(
        run,
        shot.role,
        uiProject,
      );
      if (
        !shot.sourceSystem?.kind ||
        !shot.sourceSystem?.id ||
        !shot.sourceSystem?.label
      ) {
        shot.sourceSystem = expected;
        changed = true;
      }
    }
    if (changed) {
      pairs.updatedAt = now();
      writeJson(validationScreenshotPairsFile(run), pairs);
    }
    return existing;
  }
  const pair = {
    id: `${now()}-${task.id}-${state}`,
    taskId: task.id,
    state,
    uiProject,
    screenshots: [
      {
        role: "reference",
        source: "prototype",
        sourceSystem: validationScreenshotSourceSystem(
          run,
          "reference",
          uiProject,
        ),
        path: referencePath,
      },
      {
        role: "result",
        source: "ui-client",
        sourceSystem: validationScreenshotSourceSystem(
          run,
          "result",
          uiProject,
        ),
        path: resultPath,
      },
    ],
    action,
    capturedAt: now(),
  };
  pairs.pairs.push(pair);
  pairs.updatedAt = pair.capturedAt;
  writeJson(validationScreenshotPairsFile(run), pairs);
  return pair;
}

export function visualArchive() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "delivery") fail("visual archive 只能用于开发运行。");
  const project = ensureProject();
  const uiRoot = projectRootForDeliveryTarget(
    project,
    required("--ui-project"),
  );
  if (!uiRoot || !deliveryRoles(uiRoot).includes(UI_DELIVERY_ROLE))
    fail("--ui-project 必须是登记为 ui-client 的代码根。");
  const task = validationTask(run, required("--task"), uiRoot.path);
  const prototype = controlledScreenshot(
    required("--reference"),
    path.join(
      prototypeArchiveDirectory(STORE, run.run.prototypeRun),
      "screenshots",
    ),
    "原型参考截图",
  );
  const result = controlledScreenshot(
    required("--result"),
    path.join(run.dir, "screenshots"),
    "UI 结果截图",
  );
  const pair = registerValidationScreenshotPair({
    run,
    task,
    state: slug(required("--state")),
    reference: prototype,
    result,
    uiProject: uiRoot.path,
    action: required("--action"),
  });
  syncDeliveryReports(run);
  console.log(
    `已归档验证截图对 ${pair.id}：参考图 ${pair.screenshots[0].path}；结果图 ${pair.screenshots[1].path}`,
  );
}

export function visualArchiveAdditional() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "delivery")
    fail("visual archive-additional 只能用于开发运行。");
  const taskId = slug(required("--task"));
  const task = ensureWorkPlan(run).tasks.find((item) => item.id === taskId);
  if (!task) fail(`未规划任务：${taskId}`);
  const execution = fs.existsSync(executionFile(run, task.id))
    ? readJson(executionFile(run, task.id))
    : null;
  if (
    execution?.status !== "in_progress" &&
    !executionIsResumableCheckpoint(task, execution)
  )
    fail(`任务 ${task.id} 必须进行中或处于可续做检查点，才能登记补充截图。`);
  const screenshot = controlledScreenshot(
    required("--screenshot"),
    path.join(run.dir, "screenshots"),
    "补充截图",
  );
  const records = additionalScreenshots(run);
  const record = {
    id: `${now()}-${task.id}-${slug(required("--state"))}`,
    taskId: task.id,
    state: slug(required("--state")),
    screenshot: path.relative(STORE, screenshot),
    reason: required("--reason"),
    action: required("--action"),
    capturedAt: now(),
  };
  records.screenshots.push(record);
  records.updatedAt = record.capturedAt;
  writeJson(additionalScreenshotsFile(run), records);
  syncDeliveryReports(run);
  console.log(
    `已登记${ADDITIONAL_SCREENSHOT_EVIDENCE.title}：${record.screenshot}`,
  );
}

export function apiMockScreenshotProblems(run, task) {
  const matching = apiMockEvidence(run).evidence.filter(
    (item) => item.taskId === task.id,
  );
  if (!matching.length)
    return [
      `接口 Mock 任务 ${task.id} 缺少已登记的实际响应截图；使用 api-mock evidence 归档并登记。`,
    ];
  const problems = [];
  for (const item of matching) {
    const screenshot = path.resolve(run.dir, item.screenshot ?? "");
    if (
      !fileWithin(screenshot, apiMockScreenshotDirectory(run)) ||
      !fs.existsSync(screenshot)
    )
      problems.push(
        `接口 Mock 任务 ${task.id} 的截图不存在或不在 screenshots/api-mock/：${item.screenshot ?? "—"}`,
      );
    if (!String(item.method ?? "").trim())
      problems.push(
        `接口 Mock 任务 ${task.id} 的截图证据缺少请求方法。`,
      );
    try {
      const url = new URL(String(item.url ?? ""));
      if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
    } catch {
      problems.push(
        `接口 Mock 任务 ${task.id} 的截图证据缺少完整 HTTP(S) Mock URL。`,
      );
    }
    if (
      !Number.isInteger(item.httpStatus) ||
      item.httpStatus < 100 ||
      item.httpStatus > 599
    )
      problems.push(
        `接口 Mock 任务 ${task.id} 的截图证据缺少有效 HTTP 状态码。`,
      );
    if (!String(item.action ?? "").trim())
      problems.push(`接口 Mock 任务 ${task.id} 的截图证据缺少复现动作。`);
    problems.push(...mockResponseProblems(run, task, item));
  }
  return problems;
}

export function apiMockEvidenceCommand() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "delivery") fail("api-mock evidence 只能用于开发运行。");
  const plan = ensureWorkPlan(run);
  const taskId = slug(required("--task"));
  const task = plan.tasks.find((item) => item.id === taskId);
  if (!task) fail(`未规划任务：${taskId}`);
  if (
    !isContinuousDeliveryTask(task) &&
    canonicalTaskPhase(task.phase) !== "api_mock"
  )
    fail(`任务 ${taskId} 不属于接口 Mock 阶段。`);
  if (
    isContinuousDeliveryTask(task) &&
    !taskHasDeliveryRole(task, API_DELIVERY_ROLE)
  )
    fail(
      `连续开发任务 ${taskId} 未绑定 api-provider 项目，不能登记接口 Mock 证据。`,
    );
  const execution = fs.existsSync(executionFile(run, taskId))
    ? readJson(executionFile(run, taskId))
    : null;
  if (execution?.status !== "in_progress")
    fail(`任务 ${taskId} 必须已领取且进行中，才能登记接口 Mock 截图。`);
  const screenshot = controlledScreenshot(
    required("--screenshot"),
    apiMockScreenshotDirectory(run),
    "接口 Mock 响应截图",
  );
  const httpStatus = Number(required("--http-status"));
  if (!Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)
    fail("--http-status 必须是 100-599 的整数。");
  let url;
  try {
    url = new URL(required("--url"));
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error();
  } catch {
    fail("--url 必须是完整的 HTTP(S) Mock URL。");
  }
  const response = controlledMockResponse(
    required("--response-file"),
    apiMockScreenshotDirectory(run),
  );
  const record = {
    id: `${now()}-${taskId}`,
    taskId,
    screenshot: path.relative(run.dir, screenshot),
    method: required("--method").toUpperCase(),
    url: url.toString(),
    endpoint: `${url.pathname}${url.search}`,
    httpStatus,
    action: required("--action"),
    responseFile: path.relative(run.dir, response.target),
    response: response.value,
    fieldDefinitions: mockResponseFieldDefinitions(response.value),
    capturedAt: now(),
  };
  const evidence = apiMockEvidence(run);
  evidence.evidence.push(record);
  evidence.updatedAt = record.capturedAt;
  writeJson(apiMockEvidenceFile(run), evidence);
  syncDeliveryReports(run);
  console.log(
    `已登记 ${run.id}/${taskId} 的接口 Mock 截图：${record.screenshot}`,
  );
}

function retiredPixelCompare() {
  fail("历史像素验收实现已移除；请使用 --region-report 提交逐区识别审查。");
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "delivery") fail("visual compare 只能用于开发运行。");
  const project = ensureProject();
  const uiRoot = projectRootForDeliveryTarget(
    project,
    required("--ui-project"),
  );
  if (!uiRoot || !deliveryRoles(uiRoot).includes(UI_DELIVERY_ROLE))
    fail("--ui-project 必须是登记为 ui-client 的代码根。");
  const task = validationTask(run, required("--task"), uiRoot.path);
  const prototypeBase = path.join(
    prototypeArchiveDirectory(STORE, run.run.prototypeRun),
    "screenshots",
  );
  const prototype = controlledScreenshot(
    required("--prototype"),
    prototypeBase,
    "原型截图",
  );
  const actual = controlledScreenshot(
    required("--ui"),
    path.join(run.dir, "screenshots"),
    "UI 项目截图",
  );
  const prototypeSize = imageSize(prototype);
  const actualSize = imageSize(actual);
  if (
    prototypeSize.width !== actualSize.width ||
    prototypeSize.height !== actualSize.height
  )
    fail(
      `像素对比拒绝不同尺寸截图：原型 ${prototypeSize.width}×${prototypeSize.height}，UI ${actualSize.width}×${actualSize.height}。请用同一设备画布、缩放和状态重新采集。`,
    );
  const configured = Number(project.visualRegression?.maxDiffPixelRatio ?? 0);
  const requestedThreshold = valueFor("--max-diff-ratio");
  const maxDiffPixelRatio = Number(requestedThreshold ?? configured);
  if (
    !Number.isFinite(maxDiffPixelRatio) ||
    maxDiffPixelRatio < 0 ||
    maxDiffPixelRatio > 1
  )
    fail("--max-diff-ratio 必须是 0 到 1 的像素差异比例。");
  if (!Number.isFinite(configured) || configured < 0 || configured > 1)
    fail(
      "项目 visualRegression.maxDiffPixelRatio 必须是 0 到 1 的像素差异比例。",
    );
  if (requestedThreshold !== undefined && maxDiffPixelRatio > configured)
    fail(
      `--max-diff-ratio 只能收紧项目阈值，不能从 ${(configured * 100).toFixed(4)}% 放宽到 ${(maxDiffPixelRatio * 100).toFixed(4)}%。`,
    );
  const state = slug(required("--state"));
  const diff = path.join(
    run.dir,
    "screenshots",
    "visual-diffs",
    `${state}.png`,
  );
  fs.mkdirSync(path.dirname(diff), { recursive: true });
  const overall = compareImageMagickAE(prototype, actual, diff);
  const metricOutput = overall.raw;
  const diffPixels = overall.changedPixelCount;
  const totalPixels = prototypeSize.width * prototypeSize.height;
  const diffPixelRatio = diffPixels / totalPixels;
  const guards = automaticVisualGuards(
    project,
    prototypeSize.width,
    prototypeSize.height,
  );
  const componentAnalysis = changedComponentsFromImageMagick(
    prototype,
    actual,
    guards,
  );
  const oversizedComponents = componentAnalysis.components.filter(
    (component) => component.area / totalPixels > guards.maxComponentAreaRatio,
  );
  const edge = guards.rightEdge;
  const edgeGeometry = `${edge.width}x${edge.height}+${edge.x}+${edge.y}`;
  const edgeComparison = compareImageMagickAE(
    `${prototype}[${edgeGeometry}]`,
    `${actual}[${edgeGeometry}]`,
  );
  const edgeTotalPixels = edge.width * edge.height;
  const edgeDiffPixelRatio = edgeComparison.changedPixelCount / edgeTotalPixels;
  const automaticAnalysis = {
    configuration: guards,
    components: componentAnalysis.components.slice(0, 20).map((component) => ({
      ...component,
      areaRatio: component.area / totalPixels,
      status:
        component.area / totalPixels > guards.maxComponentAreaRatio
          ? "failed"
          : "passed",
    })),
    componentMetricRaw: componentAnalysis.raw,
    oversizedComponentCount: oversizedComponents.length,
    rightEdge: {
      ...edge,
      diffPixels: edgeComparison.changedPixelCount,
      totalPixels: edgeTotalPixels,
      diffPixelRatio: edgeDiffPixelRatio,
      status:
        edgeDiffPixelRatio <= edge.maxDiffPixelRatio ? "passed" : "failed",
      metric: {
        name: "ImageMagick AE",
        raw: edgeComparison.raw,
        changedPixelCount: edgeComparison.changedPixelCount,
      },
    },
  };
  const criticalRegions = criticalRegionsForVisualComparison(
    project,
    state,
    prototypeSize.width,
    prototypeSize.height,
    maxDiffPixelRatio,
  ).map((region) => {
    const geometry = `${region.width}x${region.height}+${region.x}+${region.y}`;
    const comparison = compareImageMagickAE(
      `${prototype}[${geometry}]`,
      `${actual}[${geometry}]`,
    );
    const totalPixels = region.width * region.height;
    const diffPixelRatio = comparison.changedPixelCount / totalPixels;
    return {
      ...region,
      diffPixels: comparison.changedPixelCount,
      totalPixels,
      diffPixelRatio,
      status: diffPixelRatio <= region.maxDiffPixelRatio ? "passed" : "failed",
      metric: {
        name: "ImageMagick AE",
        raw: comparison.raw,
        changedPixelCount: comparison.changedPixelCount,
      },
    };
  });
  const pair = registerValidationScreenshotPair({
    run,
    task,
    state,
    reference: prototype,
    result: actual,
    uiProject: uiRoot.path,
    action: required("--action"),
  });
  const comparison = {
    id: `${now()}-${state}`,
    state,
    status:
      diffPixelRatio <= maxDiffPixelRatio &&
      automaticAnalysis.oversizedComponentCount === 0 &&
      automaticAnalysis.rightEdge.status === "passed" &&
      criticalRegions.every((region) => region.status === "passed")
        ? "passed"
        : "failed",
    pairId: pair.id,
    uiProject: uiRoot.path,
    prototype: path.relative(run.dir, prototype),
    ui: path.relative(run.dir, actual),
    diff: path.relative(run.dir, diff),
    action: required("--action"),
    width: prototypeSize.width,
    height: prototypeSize.height,
    diffPixels,
    totalPixels,
    diffPixelRatio,
    metric: {
      name: "ImageMagick AE",
      raw: metricOutput,
      changedPixelCount: diffPixels,
    },
    automaticAnalysis,
    criticalRegions,
    maxDiffPixelRatio,
    comparedAt: now(),
  };
  const records = visualRegressions(run);
  records.comparisons.push(comparison);
  records.updatedAt = comparison.comparedAt;
  writeJson(visualRegressionFile(run), records);
  syncDeliveryReports(run);
  console.log(
    `${comparison.status} · ${state} · 差异 ${diffPixels}/${totalPixels} (${(diffPixelRatio * 100).toFixed(4)}%) · ${path.relative(process.cwd(), diff)}`,
  );
  if (comparison.status !== "passed") process.exitCode = 1;
}

const REGION_CHECK_KINDS = new Set([
  "presence",
  "order",
  "layout",
  "copy",
  "visual",
  "interaction",
]);

const REGION_CHECK_STATUSES = new Set([
  "passed",
  "failed",
  "not_applicable",
  "uncertain",
]);

// 两个对比维度可独立使用：vision=图片理解逐区（默认，兼容旧报告缺省）；dom=结构抽取逐区（开发阶段原型 HTML 与运行 DOM 可比时）。
const REGION_DIMENSIONS = new Set(["vision", "dom"]);

function regionReportText(value, label) {
  if (typeof value !== "string" || !value.trim())
    fail(`逐区报告缺少 ${label}。`);
  return value.trim();
}

function normaliseRegionReport(raw, state) {
  if (!raw || raw.schemaVersion !== 1 || typeof raw !== "object")
    fail("逐区报告 schemaVersion 必须为 1。");
  const dimension =
    raw.dimension === undefined || raw.dimension === null || raw.dimension === ""
      ? "vision"
      : String(raw.dimension);
  if (!REGION_DIMENSIONS.has(dimension))
    fail("逐区报告 dimension 只能是 vision（图片理解）或 dom（结构抽取）；缺省视为 vision。");
  const analyzer = raw.analyzer;
  if (!analyzer || typeof analyzer !== "object")
    fail("逐区报告缺少 analyzer。请记录实际使用的识别能力（图片理解模型或结构抽取工具）。 ");
  const normalizedAnalyzer = {
    provider: regionReportText(analyzer.provider, "analyzer.provider"),
    model: regionReportText(analyzer.model, "analyzer.model"),
  };
  const capture = raw.capture;
  if (!capture || typeof capture !== "object" || capture.comparable !== true)
    fail("逐区报告必须声明 capture.comparable 为 true。 ");
  const baseline = capture.baseline;
  if (!baseline || typeof baseline !== "object")
    fail("逐区报告缺少 capture.baseline。 ");
  const normalizedCapture = {
    comparable: true,
    baseline: {
      device: regionReportText(baseline.device, "capture.baseline.device"),
      scale: regionReportText(baseline.scale, "capture.baseline.scale"),
      canvas: regionReportText(baseline.canvas, "capture.baseline.canvas"),
    },
    reference: {
      state: regionReportText(capture.reference?.state, "capture.reference.state"),
      source: regionReportText(capture.reference?.source, "capture.reference.source"),
    },
    result: {
      state: regionReportText(capture.result?.state, "capture.result.state"),
      source: regionReportText(capture.result?.source, "capture.result.source"),
    },
  };
  if (
    slug(normalizedCapture.reference.state) !== state ||
    slug(normalizedCapture.result.state) !== state
  )
    fail(
      `逐区报告的参考图与结果图必须同为状态 ${state}；状态不一致时应补采截图，不得比较。`,
    );

  const excludedRegions = raw.excludedRegions ?? [];
  if (!Array.isArray(excludedRegions)) fail("excludedRegions 必须是数组。 ");
  const normalizedExcluded = excludedRegions.map((region, index) => ({
    id: slug(region?.id ?? "") || fail(`排除区 #${index + 1} 缺少 id。`),
    reason: regionReportText(region?.reason, `排除区 #${index + 1}.reason`),
  }));
  const excludedIds = new Set(normalizedExcluded.map((region) => region.id));
  if (excludedIds.size !== normalizedExcluded.length)
    fail("排除区 id 不可重复。 ");

  if (!Array.isArray(raw.regions) || !raw.regions.length)
    fail("逐区报告至少要有一个业务区块。 ");
  const seenIds = new Set();
  let lastOrder = 0;
  const regions = raw.regions.map((region, index) => {
    const id = slug(region?.id ?? "");
    if (!id || seenIds.has(id)) fail(`业务区块 #${index + 1} 的 id 为空或重复。`);
    if (excludedIds.has(id)) fail(`业务区块 ${id} 不可同时列为排除区。`);
    seenIds.add(id);
    const order = Number(region?.order);
    if (!Number.isInteger(order) || order <= lastOrder)
      fail(`业务区块 ${id} 的 order 必须按从上到下严格递增。`);
    lastOrder = order;
    if (region?.scope !== "business")
      fail(`业务区块 ${id} 的 scope 必须是 business；原生与演示内容应写入 excludedRegions。`);
    const checks = region?.checks;
    if (!Array.isArray(checks)) fail(`业务区块 ${id} 缺少 checks。`);
    const seenKinds = new Set();
    const normalizedChecks = checks.map((check) => {
      const kind = String(check?.kind ?? "");
      const checkStatus = String(check?.status ?? "");
      if (!REGION_CHECK_KINDS.has(kind) || seenKinds.has(kind))
        fail(`业务区块 ${id} 的检查项必须唯一且属于 ${[...REGION_CHECK_KINDS].join("、")}。`);
      if (!REGION_CHECK_STATUSES.has(checkStatus))
        fail(`业务区块 ${id}/${kind} 的 status 无效。`);
      seenKinds.add(kind);
      if (
        kind === "copy" &&
        checkStatus !== "not_applicable" &&
        check?.sourceVerified !== true
      )
        fail(`业务区块 ${id} 的文案检查必须以原型/实现源码交叉核实。`);
      return {
        kind,
        status: checkStatus,
        detail: regionReportText(check?.detail, `业务区块 ${id}/${kind}.detail`),
        ...(kind === "copy" ? { sourceVerified: check?.sourceVerified === true } : {}),
      };
    });
    for (const kind of REGION_CHECK_KINDS) {
      if (!seenKinds.has(kind))
        fail(`业务区块 ${id} 缺少 ${kind} 检查；不适用时明确写 not_applicable。`);
    }
    if (normalizedChecks.every((check) => check.status === "not_applicable"))
      fail(`业务区块 ${id} 不能全部标记为 not_applicable。`);
    const status = normalizedChecks.some((check) => check.status === "failed")
      ? "failed"
      : normalizedChecks.some((check) => check.status === "uncertain")
        ? "uncertain"
        : "passed";
    const domEvidence =
      dimension === "dom"
        ? {
            reference: {
              locator: regionReportText(region?.domEvidence?.reference?.locator, `业务区块 ${id}.domEvidence.reference.locator`),
              excerpt: regionReportText(region?.domEvidence?.reference?.excerpt, `业务区块 ${id}.domEvidence.reference.excerpt`),
            },
            result: {
              locator: regionReportText(region?.domEvidence?.result?.locator, `业务区块 ${id}.domEvidence.result.locator`),
              excerpt: regionReportText(region?.domEvidence?.result?.excerpt, `业务区块 ${id}.domEvidence.result.excerpt`),
            },
          }
        : null;
    return {
      id,
      order,
      scope: "business",
      reference: { summary: regionReportText(region?.reference?.summary, `业务区块 ${id}.reference.summary`) },
      result: { summary: regionReportText(region?.result?.summary, `业务区块 ${id}.result.summary`) },
      ...(domEvidence ? { domEvidence } : {}),
      checks: normalizedChecks,
      status,
    };
  });
  return {
    dimension,
    analyzer: normalizedAnalyzer,
    capture: normalizedCapture,
    excludedRegions: normalizedExcluded,
    regions,
    status: regions.some((region) => region.status === "failed")
      ? "failed"
      : regions.some((region) => region.status === "uncertain")
        ? "uncertain"
        : "passed",
  };
}

export function visualCompare() {
  ensureProject();
  const run = resolveRun(required("--run"));
  if (run.type !== "delivery") fail("visual compare 只能用于开发运行。 ");
  const project = ensureProject();
  const uiRoot = projectRootForDeliveryTarget(project, required("--ui-project"));
  if (!uiRoot || !deliveryRoles(uiRoot).includes(UI_DELIVERY_ROLE))
    fail("--ui-project 必须是登记为 ui-client 的代码根。 ");
  const task = validationTask(run, required("--task"), uiRoot.path);
  const state = slug(required("--state"));
  const prototype = controlledScreenshot(
    required("--prototype"),
    path.join(prototypeArchiveDirectory(STORE, run.run.prototypeRun), "screenshots"),
    "原型截图",
  );
  const actual = controlledScreenshot(
    required("--ui"),
    path.join(run.dir, "screenshots"),
    "UI 项目截图",
  );
  const reportPath = path.resolve(required("--region-report"));
  if (!fs.existsSync(reportPath)) fail(`逐区报告不存在：${reportPath}`);
  let report;
  try {
    report = normaliseRegionReport(readJson(reportPath), state);
  } catch (error) {
    if (error instanceof Error) throw error;
    fail("逐区报告无法解析。 ");
  }
  const pair = registerValidationScreenshotPair({
    run,
    task,
    state,
    reference: prototype,
    result: actual,
    uiProject: uiRoot.path,
    action: required("--action"),
  });
  const review = {
    id: `${now()}-${state}`,
    taskId: task.id,
    state,
    status: report.status,
    dimension: report.dimension,
    pairId: pair.id,
    uiProject: uiRoot.path,
    prototype: path.relative(run.dir, prototype),
    ui: path.relative(run.dir, actual),
    action: required("--action"),
    analyzer: report.analyzer,
    capture: report.capture,
    excludedRegions: report.excludedRegions,
    regions: report.regions,
    reviewedAt: now(),
  };
  const records = visualRegionReviews(run);
  records.reviews.push(review);
  records.updatedAt = review.reviewedAt;
  writeJson(visualRegionReviewFile(run), records);
  syncDeliveryReports(run);
  const counts = Object.groupBy(review.regions, (region) => region.status);
  console.log(
    `${review.status} · ${state} · ${report.dimension === "dom" ? "DOM 结构" : "图片理解"}逐区 · 业务区块 ${review.regions.length} 个（通过 ${counts.passed?.length ?? 0}、偏差 ${counts.failed?.length ?? 0}、不确定 ${counts.uncertain?.length ?? 0}）`,
  );
  if (review.status !== "passed") process.exitCode = 1;
}

// 独立逐区报告校验：不依赖开发运行/任务/截图归档，供 e2e、原型回归等场景按同一 schema 核验并自行归档。
export function visualValidateReport() {
  const reportPath = path.resolve(required("--region-report"));
  if (!fs.existsSync(reportPath)) fail(`逐区报告不存在：${reportPath}`);
  let raw;
  try {
    raw = readJson(reportPath);
  } catch {
    fail("逐区报告无法解析为 JSON。 ");
  }
  let state = valueFor("--state");
  if (state && state.startsWith("--")) fail("缺少 --state 的值。");
  if (state) state = slug(state);
  else {
    const reference = raw?.capture?.reference?.state;
    const result = raw?.capture?.result?.state;
    if (!reference || !result)
      fail("缺 --state，且报告未声明 capture.reference/result 状态。");
    if (slug(reference) !== slug(result))
      fail("参考与结果状态不一致；应补采同状态截图，不得比较。");
    state = slug(reference);
  }
  const report = normaliseRegionReport(raw, state);
  const counts = Object.groupBy(report.regions, (region) => region.status);
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: 1, command: "visual validate-report", state, ...report })}\n`,
  );
  console.error(
    `${report.status} · ${state} · ${report.dimension === "dom" ? "DOM 结构" : "图片理解"}逐区 · 业务区块 ${report.regions.length} 个（通过 ${counts.passed?.length ?? 0}、偏差 ${counts.failed?.length ?? 0}、不确定 ${counts.uncertain?.length ?? 0}）`,
  );
  if (report.status !== "passed") process.exitCode = 1;
}
