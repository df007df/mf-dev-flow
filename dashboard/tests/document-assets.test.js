import assert from "node:assert/strict";
import test from "node:test";
import { documentAssetUrl, isArchiveImage } from "../app/lib/document-assets.mjs";

const context = { documentPath: "prototype/原型图流程.md", assetBase: "prototype-runs/历史运行" };
const storedPath = (url) => new URL(url, "http://localhost").searchParams.get("path");

test("归档文档按自身目录解析中文图片、追踪和旧截图简写", () => {
  for (const href of ["../prototype-runs/历史运行/screenshots/首页.png", "screenshots/首页.png", ".mf-dev-flow/prototype-runs/历史运行/screenshots/首页.png", "prototype-runs/历史运行/screenshots/首页.png"])
    assert.equal(storedPath(documentAssetUrl(href, context)), "prototype-runs/历史运行/screenshots/首页.png");
  assert.equal(storedPath(documentAssetUrl("../prototype-runs/历史运行/traces/打开.zip", context)), "prototype-runs/历史运行/traces/打开.zip");
  assert.equal(storedPath(documentAssetUrl("analyses/batch/screenshots/page.png", { documentPath: "prototype/report.md", assetBase: "prototype" })), "prototype/analyses/batch/screenshots/page.png");
  assert.equal(storedPath(documentAssetUrl("../screenshots/page.png", { documentPath: "prototype-runs/run/features/flow.md" })), "prototype-runs/run/screenshots/page.png");
  assert.equal(isArchiveImage(documentAssetUrl("screenshots/首页.png", context)), true);
  assert.equal(isArchiveImage("https://example.com/page.png"), false);
});

test("文档链接保留普通外链，拒绝越界和不安全协议", () => {
  for (const href of ["../../outside.png", "%2e%2e/%2e%2e/outside.png", "/etc/passwd", "//outside.test/a.png", "javascript:alert(1)", "data:text/html,test", "file:///tmp/a", "../bad\\path.png"])
    assert.equal(documentAssetUrl(href, context), null, href);
  for (const href of ["https://example.com/guide", "#heading", "/files?path=prototype%2Freport.md"])
    assert.equal(documentAssetUrl(href, context), href);
});
