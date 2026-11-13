import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const url = new URL("../src/lib/toolErrors.ts", import.meta.url);
const { outputText } = ts.transpileModule(fs.readFileSync(url, "utf8"), {
  fileName: fileURLToPath(url),
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
});
const exports = {};
new Function("require", "exports", outputText)(createRequire(url), exports);
const { toolStateErrorMessage, toolInstallErrorMessage } = exports;
const updateCode = ts.transpileModule(fs.readFileSync(new URL("../src/lib/toolUpdate.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const updateExports = {};
new Function("exports", updateCode)(updateExports);
const { updateToolSafely } = updateExports;

test("state read, lock and save errors are shown with the backend message", () => {
  for (const message of ["工具安装记录损坏 tools.json", "无法锁定工具安装记录", "无法保存工具安装记录"]) {
    assert.equal(toolStateErrorMessage({ kind: "state", message }), message);
  }
});

test("network lookup errors remain silent", () => {
  assert.equal(toolStateErrorMessage({ kind: "update", message: "request timed out" }), null);
  assert.equal(toolStateErrorMessage("request timed out"), null);
});

test("unexpected error payloads cannot break the update-check handler", () => {
  for (const error of [undefined, null, 0, true, {}, { kind: "state" }, { kind: "state", message: 1 }]) {
    assert.equal(toolStateErrorMessage(error), null);
  }
});

// Execute the production page handlers with state/API doubles; no React DOM or native IPC is started.
function pageHandlers(api, initialTools = [], openUrl = async () => {}, confirm = async () => true) {
  const pageUrl = new URL("../src/components/ToolManagerPage.tsx", import.meta.url);
  const source = ts.createSourceFile("ToolManagerPage.tsx", fs.readFileSync(pageUrl, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const page = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ToolManagerPage");
  const names = new Set(["load", "checkUpdates", "mergeItem", "install", "openHomepage"]);
  const handlers = page.body.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
  assert.equal(handlers.length, names.size);
  const printer = ts.createPrinter();
  const { outputText: handlersJs } = ts.transpileModule(handlers.map((node) => printer.printNode(ts.EmitHint.Unspecified, node, source)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  });
  const state = { tools: initialTools, loading: false, notice: null, checkingIds: [], busyIds: [], progressById: {} };
  const bindings = { downloadingRef: { current: new Set() }, tools: initialTools };
  for (const key of Object.keys(state)) {
    bindings[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
    };
  }
  const run = new Function("tauri", "toolStateErrorMessage", "toolInstallErrorMessage", "updateToolSafely", "bindings", "openUrl", "confirm", `
    const { ${Object.keys(bindings).join(", ")} } = bindings;
    ${handlersJs}
    return { load, checkUpdates, install, openHomepage };
  `)(api, toolStateErrorMessage, toolInstallErrorMessage, updateToolSafely, bindings, openUrl, confirm);
  return { ...run, state };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

test("a broken config shows its error and clears stale tool actions instead of starting checks", async () => {
  let checks = 0;
  const page = pageHandlers({
    toolList: async () => { throw "工具安装记录损坏 tools.json"; },
    toolCheckUpdates: async () => { checks++; },
  }, [{ id: "argus", installed: true }]);
  await page.load();
  assert.deepEqual(page.state.tools, []);
  assert.equal(page.state.loading, false);
  assert.deepEqual(page.state.notice, { tone: "error", text: "工具安装记录损坏 tools.json" });
  assert.equal(checks, 0);
});

test("background state errors remain visible after loading installed tools", async () => {
  const tools = [{ id: "argus", installed: true }];
  const page = pageHandlers({
    toolList: async () => tools,
    toolCheckUpdates: async () => { throw { kind: "state", message: "无法保存工具安装记录" }; },
  });
  await page.load();
  await settled();
  assert.deepEqual(page.state.tools, tools);
  assert.deepEqual(page.state.notice, { tone: "error", text: "无法保存工具安装记录" });
  assert.deepEqual(page.state.checkingIds, []);
});

test("background network failures do not hide installed tools or display a config error", async () => {
  const tools = [{ id: "argus", installed: true }];
  const page = pageHandlers({
    toolList: async () => tools,
    toolCheckUpdates: async () => { throw { kind: "update", message: "timeout" }; },
  });
  await page.load();
  await settled();
  assert.deepEqual(page.state.tools, tools);
  assert.equal(page.state.notice, null);
  assert.deepEqual(page.state.checkingIds, []);
});

test("download success cannot overwrite a subsequent installation-state error", async () => {
  const page = pageHandlers({
    toolDownload: async () => ({ id: "argus", installed: true, version: "0.3.4" }),
    toolCheckUpdates: async () => { throw { kind: "state", message: "工具安装记录正被其它任务使用" }; },
  }, [{ id: "argus", installed: false }]);
  await page.install("argus", "download");
  assert.equal(page.state.tools[0].installed, true);
  assert.deepEqual(page.state.notice, { tone: "error", text: "工具安装记录正被其它任务使用" });
  assert.deepEqual(page.state.busyIds, []);
  assert.deepEqual(page.state.progressById, {});
});

test("successful checks still merge update metadata and allow installing", async () => {
  const page = pageHandlers({
    toolDownload: async () => ({ id: "argus", installed: true, version: "0.3.4" }),
    toolCheckUpdates: async () => ({ hasUpdate: false, latestVersion: "0.3.4", changelog: [] }),
  }, [{ id: "argus", installed: false }]);
  await page.install("argus", "download");
  assert.equal(page.state.tools[0].latestVersion, "0.3.4");
  assert.deepEqual(page.state.notice, { tone: "success", text: "下载完成" });
});


test("loading and refreshing keeps manual tools but never checks their versions", async () => {
  const tools = [
    { id: "argus", manualDownload: false, installed: false },
    { id: "tbtool", manualDownload: true, installed: false },
  ];
  const checks = [];
  const page = pageHandlers({
    toolList: async () => tools,
    toolCheckUpdates: async (id) => {
      checks.push(id);
      return { hasUpdate: false, latestVersion: "1.0", changelog: [] };
    },
  });
  await page.load();
  await settled();
  await page.load();
  await settled();
  assert.deepEqual(checks, ["argus", "argus"]);
  assert.deepEqual(page.state.tools[1], tools[1]);
  assert.equal(page.state.tools[0].latestVersion, "1.0");
  assert.deepEqual(page.state.checkingIds, []);
});

test("opening a manual tool uses its exact URL without invoking managed installation", async () => {
  const urls = [];
  const page = pageHandlers({}, [], async (url) => { urls.push(url); });
  page.state.notice = { tone: "error", text: "已有安装记录错误" };
  await page.openHomepage({ name: "图吧工具箱", homepage: "https://www.tbtool.cn", manualDownload: true });
  assert.deepEqual(urls, ["https://www.tbtool.cn"]);
  assert.deepEqual(page.state.notice, { tone: "error", text: "已有安装记录错误" });
});

test("an external browser failure is surfaced instead of becoming an unhandled rejection", async () => {
  const page = pageHandlers({}, [], async () => { throw new Error("browser failed"); });
  await page.openHomepage({ name: "图吧工具箱", homepage: "https://www.tbtool.cn", manualDownload: true });
  assert.deepEqual(page.state.notice, {
    tone: "error", text: "无法打开「图吧工具箱」官网: Error: browser failed",
  });
});

test("updating a stopped tool checks its processes without asking to close anything", async () => {
  const calls = [];
  const page = pageHandlers({
    toolRunningProcesses: async (id) => { calls.push(["check", id]); return []; },
    toolUpdate: async (id, close) => { calls.push(["update", id, close]); return { id, installed: true, version: "2" }; },
    toolCheckUpdates: async () => ({ hasUpdate: false, latestVersion: "2", changelog: [] }),
  }, [{ id: "argus", installed: true, version: "1" }], undefined, async () => { assert.fail("unexpected confirmation"); });
  await page.install("argus", "update");
  assert.deepEqual(calls, [["check", "argus"], ["update", "argus", false]]);
  assert.equal(page.state.tools[0].version, "2");
  assert.equal(page.state.notice.text, "已更新到最新版本");
});

test("canceling close-and-update leaves the old installation and clears busy state", async () => {
  const tool = { id: "argus", installed: true, version: "1" };
  const page = pageHandlers({
    toolRunningProcesses: async () => [{ pid: 42, name: "argus.exe" }],
    toolUpdate: async () => { assert.fail("cancellation must not update or close"); },
  }, [tool], undefined, async (message, options) => {
    assert.match(message, /保存/);
    assert.match(message, /正常关闭/);
    assert.equal(options.okLabel, "关闭并更新");
    assert.equal(options.cancelLabel, "暂不更新");
    return false;
  });
  await page.install("argus", "update");
  assert.deepEqual(page.state.tools, [tool]);
  assert.equal(page.state.notice, null);
  assert.deepEqual(page.state.busyIds, []);
  assert.deepEqual(page.state.progressById, {});
});

test("a pending confirmation prevents a duplicate update and only consents after the answer", async () => {
  let answer;
  const pending = new Promise((resolve) => { answer = resolve; });
  const calls = [];
  const page = pageHandlers({
    toolRunningProcesses: async () => [{ pid: 42 }],
    toolUpdate: async (id, close) => { calls.push(close); return { id, installed: true, version: "2" }; },
    toolCheckUpdates: async () => ({ hasUpdate: false, latestVersion: "2", changelog: [] }),
  }, [{ id: "argus", installed: true, version: "1" }], undefined, () => pending);
  const install = page.install("argus", "update");
  await settled();
  await page.install("argus", "update");
  assert.deepEqual(calls, []);
  assert.deepEqual(page.state.busyIds, ["argus"]);
  answer(true);
  await install;
  assert.deepEqual(calls, [true]);
  assert.deepEqual(page.state.busyIds, []);
});

test("a tool started during download requires confirmation before retrying", async () => {
  const calls = [];
  let confirmations = 0;
  const page = pageHandlers({
    toolRunningProcesses: async () => [],
    toolUpdate: async (id, close) => {
      calls.push(close);
      if (!close) throw { kind: "running", message: "工具正在运行", processes: [{ pid: 42 }] };
      return { id, installed: true, version: "2" };
    },
    toolCheckUpdates: async () => ({ hasUpdate: false, latestVersion: "2", changelog: [] }),
  }, [{ id: "argus", installed: true, version: "1" }], undefined, async () => { confirmations++; return true; });
  await page.install("argus", "update");
  assert.deepEqual(calls, [false, true]);
  assert.equal(confirmations, 1);
  assert.equal(page.state.tools[0].version, "2");
});

test("canceling a confirmation after a download race never retries the update", async () => {
  let updates = 0;
  const page = pageHandlers({
    toolRunningProcesses: async () => [],
    toolUpdate: async () => { updates++; throw { kind: "running", message: "工具正在运行" }; },
  }, [{ id: "argus", version: "1" }], undefined, async () => false);
  await page.install("argus", "update");
  assert.equal(updates, 1);
  assert.equal(page.state.tools[0].version, "1");
  assert.equal(page.state.notice, null);
});

test("failure to exit keeps the old version and displays the backend message", async () => {
  let updates = 0;
  const message = "工具尚未退出，已停止更新。请处理保存提示";
  const page = pageHandlers({
    toolRunningProcesses: async () => [{ pid: 42 }],
    toolUpdate: async () => { updates++; throw { kind: "failure", message }; },
  }, [{ id: "argus", version: "1" }]);
  await page.install("argus", "update");
  assert.equal(updates, 1);
  assert.equal(page.state.tools[0].version, "1");
  assert.deepEqual(page.state.notice, { tone: "error", text: message });
  assert.deepEqual(page.state.busyIds, []);
});

test("a failed runtime check refuses to update and releases the busy state", async () => {
  const page = pageHandlers({
    toolRunningProcesses: async () => { throw "无法读取安装记录"; },
    toolUpdate: async () => { assert.fail("cannot update without checking"); },
  });
  await page.install("argus", "update");
  assert.deepEqual(page.state.notice, { tone: "error", text: "无法读取安装记录" });
  assert.deepEqual(page.state.busyIds, []);
});
