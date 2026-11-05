import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(new URL("./release.mjs", import.meta.url));
const conf = JSON.parse(
  readFileSync(fileURLToPath(new URL("../src-tauri/tauri.conf.json", import.meta.url)), "utf8"),
);

// 只生成说明,不构建也不访问 GitHub。
function notesOnly(args = []) {
  return execFileSync(process.execPath, [scriptPath, "--notes-only", ...args], {
    encoding: "utf8",
  }).trim();
}

test("release notes are generated from commits since the previous tag", () => {
  const notes = notesOnly();
  assert.match(notes, new RegExp(`^## DevHub v${conf.version.replace(/\./g, "\\.")}`));
  assert.match(notes, /个提交|自 v\d+\.\d+\.\d+ 之后/);
  // 提交类型前缀与署名不应泄漏到发版说明。
  assert.doesNotMatch(notes, /^(feat|fix|perf|refactor|docs|test|chore)(\(|:)/m);
  assert.doesNotMatch(notes, /Co-Authored-By/i);
  // 说明不能退化成占位文本。
  assert.notEqual(notes, `DevHub v${conf.version}`);
  assert.ok(notes.split("\n").length > 2);
});

test("manual notes override the generated ones", () => {
  assert.equal(notesOnly(["--notes", "手写发版说明"]), "手写发版说明");
});

test("an existing version tag bounds the notes to that release", () => {
  // 版本 tag 已存在时说明应稳定,不会因为发布后又提交了新改动而变长。
  const first = notesOnly();
  assert.equal(notesOnly(), first);
  assert.match(first, /^## DevHub v/);
});

test("--notes and --notes-file are mutually exclusive", () => {
  assert.throws(() => notesOnly(["--notes", "a", "--notes-file", "b.md"]));
});
