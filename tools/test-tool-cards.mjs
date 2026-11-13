import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Render the production card branches with lightweight UI/hook doubles. Native
// IPC and the browser opener are never started by these tests.
const require = createRequire(import.meta.url);
const source = ts.createSourceFile("ToolManagerPage.tsx",
  fs.readFileSync(new URL("../src/components/ToolManagerPage.tsx", import.meta.url), "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["ToolCard", "StatusBadge"]);
const declarations = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text));
assert.equal(declarations.length, names.size);
const printer = ts.createPrinter();
const code = ts.transpileModule([
  ...declarations.map((node) => printer.printNode(ts.EmitHint.Unspecified, node, source)),
  "export { ToolCard };",
].join("\n"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const Button = ({ variant, size, ...props }) => createElement("button", props);
const Icon = () => createElement("svg");
const bindings = {
  useState: (value) => [value, () => {}],
  cn: (...classes) => classes.filter(Boolean).join(" "),
  Button,
  ...Object.fromEntries(["Package", "Loader2", "ExternalLink", "Download", "Play", "FolderOpen", "ChevronDown", "ChevronRight"]
    .map((name) => [name, Icon])),
};
const exports = {};
new Function("require", "exports", "bindings", `const { ${Object.keys(bindings).join(", ")} } = bindings;\n${code}`)(require, exports, bindings);
const { ToolCard } = exports;
const manualTool = {
  id: "tbtool", name: "图吧工具箱", group: "system", groupName: "系统工具",
  description: "请前往官网自行下载。", homepage: "https://www.tbtool.cn", manualDownload: true,
  installed: false, version: "", exePath: "", installedAt: "", lastChecked: "",
  hasUpdate: false, latestVersion: "", changelog: [],
};
const children = (node) => [node?.props?.children].flat(Infinity).filter(Boolean);
const text = (node) => typeof node === "string" || typeof node === "number"
  ? String(node) : children(node).map(text).join("");
const buttons = (node) => node?.type === Button ? [node] : children(node).flatMap(buttons);
function card(tool = {}, props = {}) {
  const calls = [];
  const tree = ToolCard({
    checking: false, busy: false, progress: null,
    ...Object.fromEntries(["Download", "Update", "Launch", "OpenDir", "Homepage"]
      .map((name) => [`on${name}`, () => calls.push(name)])),
    ...props, tool: { ...manualTool, ...tool },
  });
  return { calls, buttons: buttons(tree), html: renderToStaticMarkup(tree) };
}

test("managed tools show a waiting state before download progress arrives", () => {
  const view = card({ manualDownload: false, installed: true }, { busy: true });
  assert.match(view.html, /正在准备/);
  assert.doesNotMatch(view.html, /下载中/);
  assert.deepEqual(view.buttons.map(text), ["主页"]);
});

test("manual tool has a single official-site action and a custom-tool hint", () => {
  const view = card();
  assert.match(view.html, /图吧工具箱/);
  assert.match(view.html, /手动下载/);
  assert.match(view.html, /自定义工具/);
  assert.deepEqual(view.buttons.map(text), ["前往官网下载"]);
  assert.equal(view.buttons[0].props.title, "https://www.tbtool.cn");
  view.buttons[0].props.onClick();
  assert.deepEqual(view.calls, ["Homepage"]);
  assert.doesNotMatch(view.html, /未下载|已安装|已是最新版本|打开目录|检查更新中/);
});

test("manual tools cannot show stale managed versions, progress, or update actions", () => {
  const view = card({
    installed: true, version: "old-version", hasUpdate: true, latestVersion: "new-version",
    changelog: ["stale changelog"], description: "",
  }, { checking: true, busy: true, progress: { percent: 50 } });
  assert.deepEqual(view.buttons.map(text), ["前往官网下载"]);
  assert.notEqual(view.buttons[0].props.disabled, true);
  assert.match(view.html, /请前往官网自行下载/);
  assert.doesNotMatch(view.html, /old-version|new-version|下载中|检查更新中|更新内容|已是最新版本|本应用数据目录/);
  assert.doesNotMatch(card({}, { checking: true }).html, /检查更新中/);
});

test("an uninstalled managed tool still exposes homepage and automatic download", () => {
  const view = card({ manualDownload: false });
  assert.match(view.html, /未下载/);
  assert.deepEqual(view.buttons.map(text), ["主页", "下载"]);
  view.buttons[1].props.onClick();
  assert.deepEqual(view.calls, ["Download"]);
});

test("an installed managed tool keeps launch, directory, and up-to-date status", () => {
  const view = card({ manualDownload: false, installed: true, version: "1.0", latestVersion: "1.0" });
  assert.match(view.html, /已安装 1.0/);
  assert.match(view.html, /已是最新版本/);
  assert.deepEqual(view.buttons.map(text), ["主页", "打开", "打开目录"]);
  view.buttons[1].props.onClick();
  view.buttons[2].props.onClick();
  assert.deepEqual(view.calls, ["Launch", "OpenDir"]);
});

test("managed updates retain their action and changelog disclosure", () => {
  const view = card({ manualDownload: false, installed: true, hasUpdate: true, latestVersion: "2.0", changelog: ["fix"] });
  assert.match(view.html, /有更新 2.0/);
  assert.match(view.html, /更新内容/);
  assert.deepEqual(view.buttons.map(text), ["主页", "打开", "打开目录", "更新"]);
  view.buttons[3].props.onClick();
  assert.deepEqual(view.calls, ["Update"]);
  assert.doesNotMatch(view.html, /已是最新版本/);
});

test("managed download progress and version checking remain visible", () => {
  const view = card({ manualDownload: false }, { busy: true, checking: true, progress: { percent: 50 } });
  assert.match(view.html, /下载中/);
  assert.match(view.html, /50%/);
  assert.match(view.html, /检查更新中/);
  assert.deepEqual(view.buttons.map(text), ["主页"]);
});
