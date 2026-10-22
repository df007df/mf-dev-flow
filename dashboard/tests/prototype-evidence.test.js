import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  prototypeEvidenceDocument,
  prototypeEvidenceFeature,
} from "../server/prototype-evidence.js";
import { prototypeSummary } from "../server/readers/sources.js";

test("旧原型投影只移除已知开发信息，保留截图、交互和已确认说明且幂等", () => {
  const evidence =
    "## 页面与交互\n\n| `screenshots/menu.png` | 打开菜单后返回 | observed |\n\n## 待确认问题（已解决，保留记录）\nAgent 回答：确认返回路径。\n";
  const old =
    "# 原型图流程\n\n## 开发与测试回写规则\n开发同步说明\n\n## 开发记录状态枚举与说明\n旧状态表\n\n<!-- mf-dev-flow:leaf-feature-status:start -->\n## 子叶功能点状态\n阶段：pending\n<!-- mf-dev-flow:leaf-feature-status:end -->\n\n" +
    evidence;
  const result = prototypeEvidenceDocument(old);
  assert.ok(result.includes(evidence));
  assert.doesNotMatch(
    result,
    /开发同步说明|旧状态表|阶段：pending|子叶功能点状态/,
  );
  assert.equal(prototypeEvidenceDocument(result), result);
  const incomplete =
    "<!-- mf-dev-flow:leaf-feature-status:start -->\n未闭合的原文";
  assert.equal(prototypeEvidenceDocument(incomplete), incomplete);
  const feature = {
    id: "menu",
    sourceEntries: ["menu-open"],
    prototypeStatus: "covered",
    implementationStatus: "done",
    testStatus: "passed",
    leafFeatureIds: ["leaf"],
    dependsOn: ["other"],
    stages: {},
  };
  assert.deepEqual(prototypeEvidenceFeature(feature), {
    id: "menu",
    sourceEntries: ["menu-open"],
    prototypeStatus: "covered",
  });
  assert.equal(feature.implementationStatus, "done");
});

test("原型接口不依赖功能地图，兼容旧索引且读取不写盘", () => {
  const store = fs.mkdtempSync(
    path.join(os.tmpdir(), "mf-dev-flow-prototype-evidence-"),
  );
  try {
    const directory = path.join(store, "prototype");
    fs.mkdirSync(directory);
    const files = {
      "task.json": JSON.stringify({ source: {} }),
      "feature-index.json": JSON.stringify({
        features: [
          {
            id: "page",
            sourceEntries: ["page"],
            implementationStatus: "done",
            stages: {},
            dependsOn: ["leaf"],
          },
        ],
      }),
      "coverage.json": JSON.stringify({
        coverage: [
          {
            id: "page",
            status: "covered",
            evidence: [
              {
                path: "screenshots/page.png",
                level: "observed",
                action: "进入页面",
              },
            ],
          },
        ],
      }),
      "原型图流程.md":
        "# 原型图流程\n\n## 页面\n说明与截图 `screenshots/page.png`\n",
    };
    for (const [file, content] of Object.entries(files))
      fs.writeFileSync(path.join(directory, file), content);
    const result = prototypeSummary(store);
    assert.equal(result.coverage.covered, 1);
    assert.deepEqual(result.features, [
      { id: "page", sourceEntries: ["page"] },
    ]);
    assert.equal(result.flowContent, files["原型图流程.md"]);
    assert.ok(!("developmentRecords" in result));
    assert.ok(!("deliveryCandidates" in result));
    for (const [file, content] of Object.entries(files))
      assert.equal(
        fs.readFileSync(path.join(directory, file), "utf8"),
        content,
      );
  } finally {
    fs.rmSync(store, { recursive: true, force: true });
  }
});
