import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { archivedFile } from "../server/workspace.js";

test("归档文件接口拒绝路径穿越、目录和越界符号链接", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "mf-dev-flow-next-files-"));
  try {
    const store = path.join(temporary, ".mf-dev-flow");
    fs.mkdirSync(store);
    fs.writeFileSync(path.join(store, "evidence.png"), "image");
    fs.writeFileSync(path.join(temporary, "outside.txt"), "private");
    fs.symlinkSync(
      path.join(temporary, "outside.txt"),
      path.join(store, "escape.txt"),
    );
    assert.equal(
      archivedFile(store, "evidence.png"),
      fs.realpathSync(path.join(store, "evidence.png")),
    );
    for (const file of [
      "../outside.txt",
      "escape.txt",
      ".",
      "",
      null,
      "missing.png",
      "bad\0name",
    ])
      assert.equal(archivedFile(store, file), null);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
