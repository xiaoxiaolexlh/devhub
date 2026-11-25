import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const storage = new Map();
const calls = [];
const api = {
  customToolOpen: async (path) => { calls.push(["custom", path]); return "focused"; },
  toolLaunch: async (id) => { calls.push(["tool", id]); },
};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const { outputText } = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  new Function("require", "exports", "localStorage", outputText)((name) => {
    if (name === "@/lib/tauri") return { tauri: api };
    if (name.startsWith("@/")) return load(`src/${name.slice(2)}.ts`);
    return require(name);
  }, exports, localStorage);
  cache.set(file, exports);
  return exports;
}
const helper = load("src/lib/launcher.ts");
const { APP_MODES } = load("src/lib/modes.ts");
const tool = (patch = {}) => ({ id: "everything", name: "Everything", description: "文件搜索", groupName: "系统工具",
  exePath: "D:\\Tools\\Everything.exe", kind: "tool", available: true, status: "打开工具", ...patch });
const modeCalls = [];
const openMode = async (...args) => { modeCalls.push(args); };
function entry(patch = {}) { return helper.buildLauncherEntries([tool(patch)]).at(-1); }

test("all home modes automatically join the launcher, independently of the tools catalog", () => {
  const entries = helper.buildLauncherEntries([]);
  for (const mode of APP_MODES) {
    const found = entries.find((entry) => entry.mode === mode.mode);
    assert.equal(found.title, mode.title);
    assert.equal(found.icon, mode.icon);
  }
  assert.equal(entries.length, APP_MODES.length + 1);
  assert.equal(entries.find((entry) => entry.mode === "tool-manager").kind, "mode");
});
test("mode, managed and custom ids cannot collide", () => {
  const entries = helper.buildLauncherEntries([tool({ id: "tool-manager" }), tool({ id: "tool-manager", kind: "custom" })]);
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
});
test("search supports Chinese, case-insensitive names, ids and multiple terms", () => {
  const entries = helper.buildLauncherEntries([tool()]);
  assert.equal(helper.filterLauncherEntries(entries, "EVERYTHING 文件")[0].toolId, "everything");
  assert.equal(helper.filterLauncherEntries(entries, "Everything")[0].toolId, "everything");
  assert.equal(helper.filterLauncherEntries(entries, "工具管理")[0].mode, "tool-manager");
  assert.equal(helper.filterLauncherEntries(entries, "hbuilderx-cli")[0].mode, "hbuilderx-cli");
  assert.deepEqual(helper.filterLauncherEntries(entries, "不存在的入口"), []);
});
test("mode clicks navigate and managed tools use the existing launch command", async () => {
  calls.length = 0; modeCalls.length = 0;
  await helper.activateLauncherEntry(helper.buildLauncherEntries([])[0], openMode);
  await helper.activateLauncherEntry(entry(), openMode);
  assert.deepEqual(modeCalls, [[APP_MODES[0].mode]]);
  assert.deepEqual(calls, [["tool", "everything"]]);
});
test("custom entries share the application's focus/running/launch behavior", async () => {
  calls.length = 0;
  await helper.activateLauncherEntry(entry({ kind: "custom" }), openMode);
  assert.deepEqual(calls, [["custom", "D:\\Tools\\Everything.exe"]]);
});
test("missing, uninstalled and manual-download tools navigate to their own management card", async () => {
  for (const status of ["路径失效", "未安装", "官网下载"]) {
    calls.length = 0; modeCalls.length = 0;
    await helper.activateLauncherEntry(entry({ available: false, status }), openMode);
    assert.deepEqual(calls, []);
    assert.deepEqual(modeCalls, [["tool-manager", "tool:everything"]]);
  }
  modeCalls.length = 0;
  await helper.activateLauncherEntry(entry({ kind: "custom", available: false }), openMode);
  assert.deepEqual(modeCalls, [["tool-manager", "custom:everything"]]);
});
test("native launch errors propagate so the panel can remain open", async () => {
  const old = api.toolLaunch;
  api.toolLaunch = async () => { throw new Error("UAC cancelled"); };
  await assert.rejects(helper.activateLauncherEntry(entry(), openMode), /UAC cancelled/);
  api.toolLaunch = old;
});
test("catalog refreshes replace renamed, removed and invalid tool entries", () => {
  const before = helper.buildLauncherEntries([tool()]);
  const after = helper.buildLauncherEntries([tool({ name: "Renamed", exePath: "new.exe", available: false })]);
  assert.equal(before.at(-1).title, "Everything");
  assert.equal(after.at(-1).title, "Renamed");
  assert.equal(after.at(-1).exePath, "new.exe");
  assert.equal(after.at(-1).available, false);
  assert(!helper.buildLauncherEntries([]).some((entry) => entry.id === "tool:everything"));
});
test("history tolerates invalid storage and deduplicates strings", () => {
  for (const value of ["broken json", "null", "[]", "0"]) {
    storage.set(helper.LAUNCHER_HISTORY_KEY, value);
    assert.deepEqual(helper.readLauncherHistory(), { pinned: [], recent: [] });
  }
  storage.set(helper.LAUNCHER_HISTORY_KEY, JSON.stringify({ pinned: ["x", "x", 1], recent: [null, "y", "y"] }));
  assert.deepEqual(helper.readLauncherHistory(), { pinned: ["x"], recent: ["y"] });
});
test("recent history keeps the latest twelve successful entries and preserves pins", () => {
  let history = { pinned: ["fixed"], recent: [] };
  for (let id = 0; id < 20; id++) history = helper.rememberLauncherEntry(history, String(id));
  history = helper.rememberLauncherEntry(history, "15");
  assert.equal(history.recent.length, 12);
  assert.equal(history.recent[0], "15");
  assert.equal(history.recent.filter((id) => id === "15").length, 1);
  assert.deepEqual(history.pinned, ["fixed"]);
  helper.writeLauncherHistory(history);
  assert.deepEqual(helper.readLauncherHistory(), history);
});
