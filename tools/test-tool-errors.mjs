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
const { toolStateErrorMessage } = exports;

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
function pageHandlers(api, initialTools = []) {
  const pageUrl = new URL("../src/components/ToolManagerPage.tsx", import.meta.url);
  const source = ts.createSourceFile("ToolManagerPage.tsx", fs.readFileSync(pageUrl, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const page = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "ToolManagerPage");
  const names = new Set(["load", "checkUpdates", "mergeItem", "install"]);
  const handlers = page.body.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
  assert.equal(handlers.length, names.size);
  const printer = ts.createPrinter();
  const { outputText: handlersJs } = ts.transpileModule(handlers.map((node) => printer.printNode(ts.EmitHint.Unspecified, node, source)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  });
  const state = { tools: initialTools, loading: false, notice: null, checkingIds: [], busyIds: [], progressById: {} };
  const bindings = { downloadingRef: { current: new Set() } };
  for (const key of Object.keys(state)) {
    bindings[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => {
      state[key] = typeof value === "function" ? value(state[key]) : value;
    };
  }
  const run = new Function("tauri", "toolStateErrorMessage", "bindings", `
    const { ${Object.keys(bindings).join(", ")} } = bindings;
    ${handlersJs}
    return { load, checkUpdates, install };
  `)(api, toolStateErrorMessage, bindings);
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
