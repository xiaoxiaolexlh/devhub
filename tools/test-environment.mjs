import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const helpers = {};
new Function("exports", transpile(read("src/lib/environment.ts")))(helpers);
const { pathToLines, linesToPath, validateEnvironmentVariable } = helpers;
const variable = (name = "Path", value = "%JAVA_HOME%\\bin;C:\\工具;", value_type = 2) => ({ name, value, value_type });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

test("Path line editing preserves references, spaces, Unicode, duplicates and empty entries", () => {
  for (const value of ["", ";", ";;", "C:\\bin;;C:\\bin;", " %JAVA_HOME%\\bin;C:\\工具; "]) {
    assert.equal(linesToPath(pathToLines(value)), value);
  }
  assert.equal(linesToPath("C:\\a\r\nC:\\b\r\n"), "C:\\a;C:\\b;");
});

test("validation accepts empty values and rejects invalid names, NUL and UTF-16 overflow", () => {
  assert.equal(validateEnvironmentVariable(variable("EMPTY", "", 1)), null);
  assert.equal(validateEnvironmentVariable(variable("A", "a".repeat(32766))), null);
  for (const entry of [variable(" "), variable("A=B"), variable("A\0B"), variable("A", "a\0b"),
    variable("A", "😀".repeat(16384)), variable("A", "", 3)]) {
    assert.ok(validateEnvironmentVariable(entry));
  }
});

// Execute the production handlers with state/native IPC doubles. No registry,
// real process environment, app data or external programs are changed.
const source = ts.createSourceFile("EnvironmentVariablesSettings.tsx",
  read("src/components/EnvironmentVariablesSettings.tsx"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "EnvironmentVariablesSettings");
const printer = ts.createPrinter();
const handlers = component.body.statements.filter(ts.isFunctionDeclaration);
const load = component.body.statements.filter(ts.isVariableStatement)
  .flatMap((node) => [...node.declarationList.declarations]).find((node) => node.name.getText(source) === "load");
const code = transpile([
  `const load = ${printer.printNode(ts.EmitHint.Expression, load.initializer.arguments[0], source)};`,
  ...handlers.map((node) => printer.printNode(ts.EmitHint.Unspecified, node, source)),
].join("\n"));

function harness(api = {}, overrides = {}) {
  const original = variable();
  const state = {
    scope: "user", snapshot: { writable: true, variables: [original] }, loading: false,
    loadError: null, notice: null, editor: { scope: "user", original, readOnly: false },
    draft: variable("Path", "%NEW_HOME%\\bin;;C:\\工具;"), pathLines: true,
    deletion: null, actionError: null, busy: false,
    busyRef: { current: false }, loadSequence: { current: 0 }, ...overrides,
  };
  const calls = [];
  const context = {
    ...state, ...helpers,
    scopeLabel: (scope) => scope === "user" ? "用户变量" : "系统变量",
    tauri: {
      environmentList: async (scope) => { calls.push(["list", scope]); return { writable: true, variables: [] }; },
      environmentSave: async (...args) => { calls.push(["save", ...args]); return { notification_sent: true }; },
      environmentDelete: async (...args) => { calls.push(["delete", ...args]); return { notification_sent: true }; },
      ...api,
    },
  };
  for (const key of Object.keys(state)) {
    context[`set${key[0].toUpperCase()}${key.slice(1)}`] = (value) => {
      context[key] = typeof value === "function" ? value(context[key]) : value;
    };
  }
  const render = new Function("context", `with (context) { ${code}; return { load, save, remove, openEditor, switchScope }; }`);
  // Like a React render, handlers capture state values; refs and setters remain shared.
  const run = Object.fromEntries(["load", "save", "remove", "openEditor", "switchScope"]
    .map((name) => [name, (...args) => render({ ...context })[name](...args)]));
  return { ...run, state: context, calls };
}

test("create passes null expectation and preserves an empty value", async () => {
  const h = harness({}, { editor: { scope: "user", original: null, readOnly: false }, draft: variable("EMPTY", "", 1) });
  await h.save();
  assert.deepEqual(h.calls[0], ["save", "user", variable("EMPTY", "", 1), null]);
  assert.equal(h.state.editor, null);
  assert.equal(h.state.notice.tone, "success");
});

test("editing sends the captured scope and original raw value/type", async () => {
  const original = variable();
  const h = harness({}, { scope: "system", editor: { scope: "user", original, readOnly: false } });
  await h.save();
  assert.deepEqual(h.calls[0], ["save", "user", h.state.draft, original]);
  assert.deepEqual(h.calls[1], ["list", "user"]);
  assert.equal(h.state.busy, false);
});

test("deletion sends the exact selected variable and scope", async () => {
  const selected = variable("DELETEME", "original", 1);
  const h = harness({}, { deletion: { scope: "system", variable: selected } });
  await h.remove();
  assert.deepEqual(h.calls[0], ["delete", "system", selected]);
  assert.equal(h.state.deletion, null);
});

test("read-only variables and invalid input cannot call save", async () => {
  const h = harness({}, { editor: { scope: "system", original: variable(), readOnly: true } });
  await h.save();
  assert.equal(h.calls.length, 0);
  h.state.editor.readOnly = false;
  h.state.draft.name = "A=B";
  await h.save();
  assert.equal(h.calls.length, 0);
  assert.match(h.state.actionError, /变量名/);
});

test("permission/conflict errors preserve the editor draft for correction", async () => {
  for (const error of ["权限不足", "变量已被其他操作修改或删除"]) {
    const h = harness({ environmentSave: async () => { throw error; } });
    const draft = { ...h.state.draft };
    await h.save();
    assert.equal(h.state.actionError, error);
    assert.ok(h.state.editor);
    assert.deepEqual(h.state.draft, draft);
    assert.equal(h.state.busyRef.current, false);
  }
});

test("delete failure keeps confirmation open and clears busy state", async () => {
  const h = harness({ environmentDelete: async () => { throw "删除失败"; } }, { deletion: { scope: "user", variable: variable() } });
  await h.remove();
  assert.ok(h.state.deletion);
  assert.equal(h.state.actionError, "删除失败");
  assert.equal(h.state.busy, false);
});

test("repeated clicks while saving trigger only one mutation", async () => {
  const pending = deferred();
  let count = 0;
  const h = harness({ environmentSave: async () => { count++; return pending.promise; } });
  const saving = h.save();
  await h.save();
  assert.equal(count, 1);
  h.switchScope("system");
  assert.equal(h.state.scope, "user");
  pending.resolve({ notification_sent: true });
  await saving;
});

test("notification timeout reports saved data without retrying", async () => {
  const h = harness({ environmentSave: async () => ({ notification_sent: false }) });
  await h.save();
  assert.equal(h.state.editor, null);
  assert.equal(h.state.notice.tone, "warning");
  assert.match(h.state.notice.text, /已修改.*未响应/);
});

test("refresh failure after successful save does not masquerade as a save failure", async () => {
  const h = harness({ environmentList: async () => { throw "读取失败"; } });
  await h.save();
  assert.equal(h.state.editor, null);
  assert.equal(h.state.notice.tone, "success");
  assert.equal(h.state.loadError, "读取失败");
  assert.equal(h.state.snapshot, null);
});

test("a stale list result cannot replace the newly selected scope", async () => {
  const user = deferred();
  const system = deferred();
  const h = harness({ environmentList: (scope) => scope === "user" ? user.promise : system.promise });
  const first = h.load("user");
  const second = h.load("system");
  const latest = { writable: false, variables: [variable("SYSTEM_ONLY")] };
  system.resolve(latest);
  await second;
  user.resolve({ writable: true, variables: [variable("STALE")] });
  await first;
  assert.equal(h.state.snapshot, latest);
  assert.equal(h.state.loading, false);
});

test("the IPC wrapper uses the registered commands with structured arguments", async () => {
  const exports = {};
  const calls = [];
  const mockRequire = (name) => {
    if (name === "@tauri-apps/api/core") return { invoke: (...args) => { calls.push(args); return Promise.resolve({}); } };
    if (name === "@tauri-apps/api/event") return {};
    return require(name);
  };
  new Function("require", "exports", transpile(read("src/lib/tauri.ts")))(mockRequire, exports);
  const entry = variable("QUOTED", '"%TEST%"; $() ` &', 1);
  await exports.tauri.environmentList("system");
  await exports.tauri.environmentSave("user", entry, null);
  await exports.tauri.environmentDelete("user", entry);
  assert.deepEqual(calls, [
    ["environment_list", { scope: "system" }],
    ["environment_save", { scope: "user", variable: entry, expected: null }],
    ["environment_delete", { scope: "user", expected: entry }],
  ]);
});
