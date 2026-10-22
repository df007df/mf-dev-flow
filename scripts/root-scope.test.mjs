import assert from "node:assert/strict";
import test from "node:test";

import { scopeCovers } from "../modules/runtime/shared.mjs";

test("dot code roots cover workspace-relative writes without covering external paths", () => {
  assert.equal(scopeCovers("", "src/pages/v2/home/index.tsx"), true);
  assert.equal(scopeCovers(".", "src/api/login.ts"), true);
  assert.equal(scopeCovers("", "../other-repository/file.ts"), false);
  assert.equal(scopeCovers("", "/tmp/outside.ts"), false);
});
