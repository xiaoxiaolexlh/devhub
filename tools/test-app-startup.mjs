import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create } from "zustand";
import ts from "typescript";

const require = createRequire(import.meta.url);
const rootUrl = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, rootUrl), "utf8");
const bootScript = read("index.html").match(/<script>([\s\S]*?)<\/script>/)[1];

function loadModule(path, mocks, globals = {}) {
  const { outputText } = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  const load = (name) => {
    if (name in mocks) return mocks[name];
    if (name.startsWith("@/")) throw new Error(`Unexpected native/module access: ${name}`);
    return require(name);
  };
  new Function("require", "exports", ...Object.keys(globals), outputText)(
    load, exports, ...Object.values(globals),
  );
  return exports;
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const settled = () => new Promise((resolve) => setImmediate(resolve));
const editor = (path = "old-path") => ({
  id: "vscode", name: "VS Code", path, process_names: ["code.exe"],
});
const settings = (path = "old-path", theme = "dark") => ({
  theme, source_editor: "vscode", editors: [editor(path)],
});
const snapshot = (value) => value.editors.map((entry) => ({
  editor: { ...entry }, exists: true, extensions: [],
}));

// Run the production store/boot script with browser state and IPC doubles only.
// No WebView, filesystem mutation, application data or native process is used.
function harness({ cacheTheme = "dark", osDark = true, saved = settings(), api: overrides = {} } = {}) {
  let backend = structuredClone(saved);
  const values = new Map([["devhub:last-mode", "tool-manager"]]);
  if (cacheTheme !== null) values.set("devhub:theme", cacheTheme);
  const classes = new Set();
  const root = {
    style: {},
    classList: {
      add: (name) => classes.add(name),
      toggle(name, on) { on ? classes.add(name) : classes.delete(name); },
    },
  };
  const globals = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
    window: { matchMedia: () => ({ matches: osDark }) },
    document: { documentElement: root },
  };
  new Function(...Object.keys(globals), bootScript)(...Object.values(globals));
  const calls = { scans: 0, processes: 0, saves: 0 };
  const api = {
    getSettings: async () => structuredClone(backend),
    saveSettings: async (value) => { calls.saves++; backend = structuredClone(value); },
    scanAll: async () => { calls.scans++; return snapshot(backend); },
    checkRunningProcesses: async () => { calls.processes++; return []; },
    ...overrides,
  };
  const { useApp: store } = loadModule("src/stores/app.ts", {
    zustand: { create }, "@/lib/tauri": { tauri: api },
  }, globals);
  return { store, api, calls, root, classes, values, globals, backend: () => backend };
}

for (const [cacheTheme, osDark, expected] of [
  ["dark", false, "dark"], ["light", true, "light"],
  ["system", true, "dark"], ["system", false, "light"],
]) {
  test(`boot uses ${cacheTheme} theme with OS dark=${osDark}`, () => {
    const h = harness({ cacheTheme, osDark });
    assert.equal(h.root.style.colorScheme, expected);
    assert.equal(h.classes.has("dark"), expected === "dark");
  });
}

test("saving dark -> light -> dark keeps class, inline scheme and cache in sync", async () => {
  const h = harness();
  await h.store.getState().init();
  for (const theme of ["light", "dark"]) {
    await h.store.getState().saveSettings(settings("old-path", theme));
    assert.equal(h.root.style.colorScheme, theme);
    assert.equal(h.classes.has("dark"), theme === "dark");
    assert.equal(h.values.get("devhub:theme"), theme);
  }
  assert.equal(h.calls.scans, 0);
});

test("authoritative settings correct a missing/stale theme cache and inline scheme", async () => {
  for (const cacheTheme of [null, "light"]) {
    const h = harness({ cacheTheme, osDark: false });
    assert.equal(h.root.style.colorScheme, "light");
    await h.store.getState().init();
    assert.equal(h.root.style.colorScheme, "dark");
    assert.equal(h.classes.has("dark"), true);
    assert.equal(h.values.get("devhub:theme"), "dark");
  }
});

test("secondary-window settings and system-theme application also sync the scheme", async () => {
  const h = harness({ cacheTheme: "dark", osDark: false, saved: settings("old-path", "system") });
  await h.store.getState().ensureSettings();
  assert.equal(h.root.style.colorScheme, "light");
  h.store.getState().applyTheme("dark");
  assert.equal(h.root.style.colorScheme, "dark");
  h.store.getState().applyTheme("system");
  assert.equal(h.root.style.colorScheme, "light");
  assert.equal(h.calls.scans, 0);
});

test("theme application works even when writing localStorage fails", () => {
  const h = harness();
  h.globals.localStorage.setItem = () => { throw new Error("storage blocked"); };
  assert.doesNotThrow(() => h.store.getState().applyTheme("light"));
  assert.equal(h.root.style.colorScheme, "light");
  assert.equal(h.classes.has("dark"), false);
});

test("tool-manager becomes ready without scanning or awaiting process detection", async () => {
  const pending = deferred();
  const h = harness({ api: { checkRunningProcesses: () => pending.promise } });
  await h.store.getState().init();
  assert.equal(h.store.getState().ready, true);
  assert.equal(h.store.getState().appMode, "tool-manager");
  assert.equal(h.calls.scans, 0);
  pending.resolve([]);
  await settled();
});

test("mounts share the first scan and reuse the completed snapshot", async () => {
  const pending = deferred();
  const h = harness();
  h.api.scanAll = () => { h.calls.scans++; return pending.promise; };
  await h.store.getState().init();
  const first = h.store.getState().ensureScans();
  const second = h.store.getState().ensureScans();
  await settled();
  assert.equal(h.calls.scans, 1);
  pending.resolve(snapshot(settings()));
  await Promise.all([first, second]);
  await h.store.getState().ensureScans();
  assert.equal(h.calls.scans, 1);
  assert.equal(h.store.getState().scanned, true);
  assert.equal(h.store.getState().loading, false);
});

test("editor changes before visiting extensions stay lazy and use the new path", async () => {
  const h = harness();
  await h.store.getState().init();
  await h.store.getState().saveSettings(settings("new-path"));
  assert.equal(h.calls.scans, 0);
  await h.store.getState().ensureScans();
  assert.equal(h.store.getState().scans[0].editor.path, "new-path");
});

test("saving editor paths during the first scan discards the old result and rescans", async () => {
  const pending = [deferred(), deferred()];
  const h = harness();
  h.api.scanAll = () => {
    const result = snapshot(h.backend());
    return pending[h.calls.scans++].promise.then(() => result);
  };
  await h.store.getState().init();
  const scan = h.store.getState().ensureScans();
  await settled();
  const save = h.store.getState().saveSettings(settings("new-path"));
  await settled();
  pending[0].resolve();
  await settled();
  assert.equal(h.calls.scans, 2);
  assert.deepEqual(h.store.getState().scans, []);
  assert.equal(h.store.getState().scanned, false);
  assert.equal(h.store.getState().loading, true);
  pending[1].resolve();
  await Promise.all([scan, save]);
  assert.equal(h.store.getState().scans[0].editor.path, "new-path");
  assert.equal(h.store.getState().scanned, true);
  assert.equal(h.store.getState().loading, false);
  await h.store.getState().ensureScans();
  assert.equal(h.calls.scans, 2);
});

test("repeated saves discard intermediate results and publish only the latest editors", async () => {
  const pending = [deferred(), deferred(), deferred()];
  const h = harness();
  h.api.scanAll = () => {
    const result = snapshot(h.backend());
    return pending[h.calls.scans++].promise.then(() => result);
  };
  await h.store.getState().init();
  const scan = h.store.getState().ensureScans();
  await settled();
  const save1 = h.store.getState().saveSettings(settings("middle-path"));
  await settled();
  pending[0].resolve();
  await settled();
  const save2 = h.store.getState().saveSettings(settings("last-path"));
  await settled();
  pending[1].resolve();
  await settled();
  assert.equal(h.calls.scans, 3);
  assert.deepEqual(h.store.getState().scans, []);
  pending[2].resolve();
  await Promise.all([scan, save1, save2]);
  assert.equal(h.store.getState().scans[0].editor.path, "last-path");
});

test("manual/post-mutation refreshes coalesce into a follow-up scan, not a stale result", async () => {
  const pending = [deferred(), deferred()];
  const h = harness();
  h.api.scanAll = () => pending[h.calls.scans++].promise;
  await h.store.getState().init();
  const first = h.store.getState().ensureScans();
  await settled();
  const refresh1 = h.store.getState().refresh();
  const refresh2 = h.store.getState().refresh();
  assert.equal(h.calls.scans, 1);
  pending[0].resolve(snapshot(settings("old-path")));
  await settled();
  assert.equal(h.calls.scans, 2);
  assert.deepEqual(h.store.getState().scans, []);
  pending[1].resolve(snapshot(settings("current-path")));
  await Promise.all([first, refresh1, refresh2]);
  assert.equal(h.store.getState().scans[0].editor.path, "current-path");
});

test("a stale scan failure does not replace the current scan with an error", async () => {
  const pending = deferred();
  const h = harness();
  h.api.scanAll = () => ++h.calls.scans === 1 ? pending.promise : Promise.resolve(snapshot(h.backend()));
  await h.store.getState().init();
  const scan = h.store.getState().ensureScans();
  await settled();
  const save = h.store.getState().saveSettings(settings("new-path"));
  await settled();
  pending.reject(new Error("old path failed"));
  await Promise.all([scan, save]);
  assert.equal(h.store.getState().scanError, null);
  assert.equal(h.store.getState().scans[0].editor.path, "new-path");
});

test("changing editor metadata invalidates existing scans and clears old selections", async () => {
  const h = harness();
  await h.store.getState().init();
  await h.store.getState().ensureScans();
  h.store.getState().setSelectedFolders(new Set(["old-extension"]));
  const next = settings();
  next.editors[0].name = "Renamed editor";
  await h.store.getState().saveSettings(next);
  assert.equal(h.calls.scans, 2);
  assert.equal(h.store.getState().scans[0].editor.name, "Renamed editor");
  assert.equal(h.store.getState().selectedFolders.size, 0);
});

test("unrelated settings do not rescan or clear extension selections", async () => {
  const h = harness();
  await h.store.getState().init();
  await h.store.getState().ensureScans();
  h.store.getState().setSelectedFolders(new Set(["extension"]));
  await h.store.getState().saveSettings(settings("old-path", "light"));
  assert.equal(h.calls.scans, 1);
  assert.equal(h.store.getState().selectedFolders.size, 1);
});

test("failed settings persistence keeps the valid scan and previous theme", async () => {
  const h = harness({ api: { saveSettings: async () => { throw new Error("save failed"); } } });
  await h.store.getState().init();
  await h.store.getState().ensureScans();
  await assert.rejects(h.store.getState().saveSettings(settings("new-path", "light")), /save failed/);
  assert.equal(h.calls.scans, 1);
  assert.equal(h.store.getState().scans[0].editor.path, "old-path");
  assert.equal(h.root.style.colorScheme, "dark");
});

test("scan failure clears loading/stale actions, exposes the error and permits retry", async () => {
  const h = harness();
  await h.store.getState().init();
  await h.store.getState().ensureScans();
  h.store.getState().setSelectedFolders(new Set(["old-extension"]));
  h.api.scanAll = async () => { throw new Error("IPC unavailable"); };
  await assert.rejects(h.store.getState().refresh(), /IPC unavailable/);
  assert.equal(h.store.getState().loading, false);
  assert.equal(h.store.getState().scanned, false);
  assert.equal(h.store.getState().selectedFolders.size, 0);
  assert.deepEqual(h.store.getState().scans, []);
  assert.match(h.store.getState().scanError, /IPC unavailable/);
  h.api.scanAll = async () => snapshot(h.backend());
  await h.store.getState().ensureScans();
  assert.equal(h.store.getState().scanError, null);
  assert.equal(h.store.getState().scanned, true);
});

test("a failed rescan does not report successfully persisted settings as a save failure", async () => {
  const h = harness();
  await h.store.getState().init();
  await h.store.getState().ensureScans();
  h.api.scanAll = async () => { throw new Error("new scan failed"); };
  await h.store.getState().saveSettings(settings("new-path"));
  assert.equal(h.backend().editors[0].path, "new-path");
  assert.equal(h.store.getState().settings.editors[0].path, "new-path");
  assert.match(h.store.getState().scanError, /new scan failed/);
});

function renderComponent(path, name, h) {
  const pass = ({ children }) => React.createElement("span", null, children);
  const mocks = {
    "@/stores/app": { useApp: () => h.store.getState() },
    "@/components/ui/Button": { Button: ({ children, disabled }) => React.createElement("button", { disabled }, children) },
    "@/components/ui/Checkbox": { Checkbox: () => null },
    "@/components/ui/Input": { Input: () => null },
    "@/components/ui/Skeleton": { Skeleton: () => React.createElement("i", { "data-skeleton": true }) },
    "@/components/ui/Tooltip": { Tooltip: pass },
    "@/components/OpenWithButton": { OpenWithButton: () => null },
    "@/lib/utils": { cn: (...args) => args.filter((arg) => typeof arg === "string").join(" "), compareVersions: () => 0, formatBytes: String },
    "@/lib/tauri": { iconUrl: () => "" },
  };
  const component = loadModule(path, mocks)[name];
  return renderToStaticMarkup(React.createElement(component, { onOpenSettings() {}, onShowDiff() {} }));
}

test("editor toolbar distinguishes loading, idle, failed and successful scans", async () => {
  const h = harness();
  await h.store.getState().init();
  const render = () => renderComponent("src/components/EditorBar.tsx", "EditorBar", h);
  assert.match(render(), /正在扫描扩展/);
  h.store.setState({ loading: false });
  assert.match(render(), /尚未扫描扩展/);
  h.store.setState({ scanError: "failed" });
  const failed = render();
  assert.match(failed, /扫描失败，请重试/);
  assert.doesNotMatch(failed, /正在扫描扩展|目录不存在/);
  await h.store.getState().refresh();
  assert.match(render(), /0 个扩展/);
});

test("extension table shows error and retry, not an empty-success message or skeleton", async () => {
  const h = harness();
  await h.store.getState().init();
  h.store.setState({ loading: false, scanError: "IPC unavailable" });
  const html = renderComponent("src/components/ExtensionTable.tsx", "ExtensionTable", h);
  assert.match(html, /role="alert"/);
  assert.match(html, /扫描扩展失败/);
  assert.match(html, /IPC unavailable/);
  assert.match(html, /重新扫描/);
  assert.doesNotMatch(html, /源编辑器没有扫描到扩展|data-skeleton/);
});
test("a save completing as a scan finishes cannot miss the required follow-up scan", async () => {
  const pending = deferred();
  const h = harness();
  h.api.scanAll = () => ++h.calls.scans === 1
    ? pending.promise
    : Promise.resolve(snapshot(h.backend()));
  await h.store.getState().init();
  const scan = h.store.getState().ensureScans();
  await settled();
  pending.resolve(snapshot(settings("old-path")));
  const save = h.store.getState().saveSettings(settings("new-path"));
  await Promise.all([scan, save]);
  assert.equal(h.calls.scans, 2);
  assert.equal(h.store.getState().scanned, true);
  assert.equal(h.store.getState().scans[0].editor.path, "new-path");
});

test("a synchronous bridge error also releases the worker so retry can succeed", async () => {
  const h = harness({ api: { scanAll: () => { throw new Error("bridge unavailable"); } } });
  await h.store.getState().init();
  await assert.rejects(h.store.getState().ensureScans(), /bridge unavailable/);
  assert.equal(h.store.getState().loading, false);
  h.api.scanAll = async () => snapshot(h.backend());
  await h.store.getState().ensureScans();
  assert.equal(h.store.getState().scanned, true);
  assert.equal(h.store.getState().scanError, null);
});
