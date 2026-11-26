// Production frontend in an isolated Edge profile; IPC doubles never launch tools
// or read/write real application settings. All browser data stays in the workspace.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "src-tauri/target/launcher-ui");
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(output, "profile-"));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const server = http.createServer((request, response) => {
  const relative = new URL(request.url, "http://localhost").pathname;
  const file = path.resolve(root, "dist", relative === "/" ? "index.html" : `.${relative}`);
  if (!file.startsWith(path.join(root, "dist") + path.sep)) { response.writeHead(403).end(); return; }
  const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml" };
  try { response.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(fs.readFileSync(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const reserve = net.createServer();
await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
const debugPort = reserve.address().port;
await new Promise((resolve) => reserve.close(resolve));
const executable = process.env.DEVHUB_TEST_BROWSER ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = spawn(executable, ["--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
  `--disk-cache-dir=${path.join(profile, "cache")}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking",
  "--disable-component-update", "--disable-crash-reporter", "--disable-features=msEdgeSidebarV2", "about:blank"], {
  windowsHide: true, env: { ...process.env, TEMP: profile, TMP: profile }, stdio: "ignore",
});
browser.on("error", (error) => { console.error(error); });
let socket;
const results = [];
const exceptions = [];
try {
  let tabs;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { tabs = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json(); if (tabs.length) break; } catch { /* startup */ }
    await delay(100);
  }
  assert(tabs?.length, "Isolated browser did not start");
  socket = new WebSocket(tabs.find((tab) => tab.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const pair = pending.get(message.id); pending.delete(message.id); message.error ? pair.reject(message.error) : pair.resolve(message.result); }
    if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.text + ": " + (message.params.exceptionDetails.exception?.description ?? ""));
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression) => {
    const result = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const wait = async (expression) => {
    for (let attempt = 0; attempt < 100; attempt++) { if (await evaluate(`!!(${expression})`)) return; await delay(50); }
    console.log(await evaluate(`JSON.stringify({ shown: __shown, calls: __calls.slice(-12), text: document.body.innerText.slice(0, 1000), focused: document.activeElement.id })`));
    throw new Error(`Timed out: ${expression}`);
  };
  const check = (name) => { results.push(name); console.log(`PASS ${name}`); };
  const fill = (value, selector = 'input[aria-label="搜索模式或工具"]') => evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); input.focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const show = async () => { await evaluate(`window.__shown = true; window.__emit('devhub:launcher-shown');`); await delay(50); };
  const navigate = (mode, toolId = null) => evaluate(`window.__navigation = ${JSON.stringify({ mode, toolId })}; window.__emit('devhub:navigate');`);
  const selectedId = () => evaluate(`document.querySelector('[data-selected="true"]')?.id`);
  const expectSelected = (id) => wait(`document.getElementById(${JSON.stringify(`launcher-${id}`)})?.dataset.selected === 'true'`);
  const focusEntry = async (id) => {
    await evaluate(`document.getElementById(${JSON.stringify(`launcher-${id}`)}).querySelector('[data-launcher-entry]').focus();`);
    await expectSelected(id);
  };
  const press = async (key, modifiers = 0) => {
    const keyCode = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Home: 36, End: 35, Tab: 9 }[key];
    await cdp("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers, ...(key === "Enter" ? { text: "\r" } : {}) });
    await cdp("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
    await delay(50);
  };
  const fixture = function () {
    localStorage.clear();
    const callbacks = new Map();
    const listeners = new Map();
    let id = 0;
    const standalone = new URLSearchParams(location.search).has("launcher");
    window.__calls = [];
    window.__shown = true;
    window.__delay = 0;
    window.__failure = null;
    window.__catalogFailure = false;
    window.__navigation = null;
    window.__jobs = [];
    window.__confirm = false;
    window.__settings = {
      settings_version: 2, theme: "dark", editors: [], source_editor: "vscode", conflict_strategy: "ask", backup_days: 7,
      project_config_dirs: [".vscode"], project_roots: [], hbuilderx_cli_dir: "", hbuilderx_projects: [], hbuilderx_project_groups: [],
      ai_config_tools: [], node_services: [], terminal_projects: [], terminal_ai_tools: [], terminal_env_enabled: false,
      terminal_env_groups: [], terminal_env_active_group_ids: [], open_methods: [], default_open_method_id: "explorer",
      custom_tools: [{ id: "custom-demo", name: "自定义工具示例", exe_path: "D:\\Tools\\demo.exe" }],
      launcher: { enabled: true, shortcut: "Ctrl+Alt+Space", close_to_tray: true },
    };
    const item = (id, name, extra = {}) => ({ id, name, description: "工具示例", groupName: "系统工具", exePath: `D:\\Tools\\${id}.exe`, kind: "tool", available: true, status: "打开工具", ...extra });
    window.__catalog = [item("everything", "Everything"), item("geek", "Geek"), item("missing", "待安装工具", { available: false, status: "未安装" }),
      item("manual", "官网下载工具", { available: false, status: "官网下载" }), item("custom-demo", "自定义工具示例", { kind: "custom", exePath: "D:\\Tools\\demo.exe" })];
    window.__emit = async (event, payload = null) => {
      for (const listener of [...listeners.values()].filter((listener) => listener.event === event)) {
        await callbacks.get(listener.handler)?.({ event, payload, id: listener.id });
      }
    };
    window.__listenerCount = (event) => [...listeners.values()].filter((listener) => listener.event === event).length;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: standalone ? "launcher" : "main" }, currentWebview: { label: standalone ? "launcher" : "main" } },
      transformCallback: (callback) => { const value = ++id; callbacks.set(value, callback); return value; },
      unregisterCallback: (id) => callbacks.delete(id), convertFileSrc: (value) => value,
      invoke: async (command, args = {}) => {
        window.__calls.push({ command, args });
        if (command === "plugin:event|listen") { const value = ++id; listeners.set(value, { id: value, ...args }); return value; }
        if (command === "plugin:event|unlisten") { listeners.delete(args.eventId); return; }
        if (command === "plugin:event|emit") return window.__emit(args.event, args.payload);
        if (command === "get_settings") return structuredClone(window.__settings);
        if (command === "save_settings") { window.__settings = structuredClone(args.settings); await window.__emit("devhub:settings-changed"); return; }
        if (command === "launcher_catalog") { if (window.__catalogFailure) throw new Error("tools.json 损坏"); return structuredClone(window.__catalog); }
        if (command === "launcher_status") return { registered: true, error: null, trayAvailable: true };
        if (command === "launcher_take_navigation") { const value = window.__navigation; window.__navigation = null; return value; }
        if (command === "launcher_hide") { window.__shown = false; return window.__emit("devhub:launcher-hidden"); }
        if (command === "tool_launch" || command === "custom_tool_open") { await new Promise((resolve) => setTimeout(resolve, window.__delay)); if (window.__failure) throw new Error(window.__failure); return "focused"; }
        if (command === "plugin:window|is_visible") return window.__shown;
        if (command === "plugin:window|close") return window.__emit("tauri://close-requested");
        if (command === "get_hbuilderx_web_runs") return window.__jobs;
        if (command === "plugin:dialog|message") return window.__confirm ? args.buttons?.OkCancelCustom?.[0] ?? "Ok" : args.buttons?.OkCancelCustom?.[1] ?? "Cancel";
        if (command === "tool_is_elevated") return false;
        if (command === "tool_list") return window.__catalog.filter((tool) => tool.kind === "tool").map((tool) => ({ ...tool, group: "system", manualDownload: tool.status === "官网下载", installed: tool.available, version: "1", hasUpdate: false, changelog: [] }));
        if (command === "tool_check_updates") return { hasUpdate: false, latestVersion: "1", changelog: [] };
        if (["check_running_processes", "node_service_list_tasks", "scan_all", "stop_all_hbuilderx_web_runs", "node_service_stop_service", "list_terminal_sessions"].includes(command)) return [];
        return null;
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: (_event, eventId) => listeners.delete(eventId) };
  };
  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `(${fixture.toString()})()` });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 760, height: 560, deviceScaleFactor: 1, mobile: false });
  const address = process.env.DEVHUB_UI_URL ?? `http://127.0.0.1:${server.address().port}`;
  await cdp("Page.navigate", { url: `${address}/?launcher` });
  await wait(`document.getElementById('launcher-tool:everything')`);
  assert.equal(await evaluate(`document.querySelectorAll('[id^="launcher-mode:"]').length`), 11);
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), "搜索模式或工具");
  fs.writeFileSync(path.join(output, "panel.png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  check("mode/tool grid and automatic input focus");

  await evaluate(`localStorage.setItem('devhub:launcher-history', JSON.stringify({ pinned: [], recent: ['tool:geek', 'tool:everything', 'mode:settings'] }));`);
  await show();
  await expectSelected("tool:geek");
  await press("ArrowLeft"); await expectSelected("mode:settings");
  await press("ArrowRight"); await expectSelected("tool:geek");
  await press("ArrowUp"); await expectSelected("tool:missing");
  await press("ArrowDown"); await expectSelected("tool:geek");
  await press("ArrowRight"); await press("ArrowRight");
  await expectSelected("mode:settings");
  await press("ArrowRight");
  await expectSelected("tool:geek");
  await press("ArrowLeft"); await expectSelected("mode:settings");
  await press("ArrowDown"); await expectSelected("mode:hbuilderx-cli");
  fs.writeFileSync(path.join(output, "keyboard-grid.png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await press("ArrowUp"); await expectSelected("mode:settings");
  await press("ArrowDown"); await press("ArrowDown"); await expectSelected("mode:tool-manager");
  await press("ArrowDown"); await expectSelected("custom:custom-demo");
  assert(await evaluate(`document.getElementById('launcher-custom:custom-demo').closest('.overflow-y-auto').scrollTop > 0`));
  await press("ArrowDown"); await expectSelected("mode:settings");
  assert(await evaluate(`(() => { const item = document.getElementById('launcher-mode:settings'); const rect = item.getBoundingClientRect(); const viewport = item.closest('.overflow-y-auto').getBoundingClientRect(); return rect.top >= viewport.top && rect.bottom <= viewport.bottom; })()`));
  await press("ArrowUp"); await expectSelected("custom:custom-demo");
  await press("Home"); await expectSelected("tool:geek");
  await press("End"); await expectSelected("custom:custom-demo");
  await press("ArrowUp"); await expectSelected("mode:tool-manager");
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), "搜索模式或工具");
  check("arrows wrap within rows and between end rows, retain input focus and scroll; Home/End jump explicitly");

  await focusEntry("mode:ai-configs");
  await press("ArrowDown"); await expectSelected("mode:system-settings");
  await press("ArrowDown"); await expectSelected("custom:custom-demo");
  await press("ArrowDown"); await expectSelected("mode:settings");
  await press("ArrowDown"); await expectSelected("mode:ai-configs");
  await press("ArrowUp"); await expectSelected("mode:settings");
  await press("ArrowUp"); await expectSelected("custom:custom-demo");
  await press("ArrowUp"); await expectSelected("mode:system-settings");
  await press("ArrowUp"); await expectSelected("mode:ai-configs");
  assert.equal(await evaluate(`document.activeElement.dataset.launcherEntry`), "mode:ai-configs");
  await press("ArrowDown"); await press("ArrowLeft"); await press("ArrowUp");
  await expectSelected("mode:hbuilderx-cli");
  check("a full cycle in either direction preserves the original column through short rows, scrolling and focus");

  const hoverPoint = await evaluate(`(() => { const rect = document.getElementById('launcher-mode:extensions').getBoundingClientRect(); return { x: rect.left + 40, y: rect.top + 40 }; })()`);
  await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverPoint });
  await delay(50);
  await expectSelected("mode:hbuilderx-cli");
  await press("ArrowDown"); await expectSelected("mode:tool-manager");
  await press("ArrowDown"); await expectSelected("custom:custom-demo");
  await press("ArrowUp"); await expectSelected("mode:tool-manager");
  check("mouse hover and scrolling under a stationary pointer never replace keyboard selection");

  await cdp("Emulation.setDeviceMetricsOverride", { width: 420, height: 560, deviceScaleFactor: 1, mobile: false });
  await focusEntry("mode:hbuilderx-cli");
  await press("ArrowRight"); await expectSelected("mode:extensions");
  await press("ArrowLeft"); await expectSelected("mode:hbuilderx-cli");
  await press("ArrowDown"); await expectSelected("mode:ai-configs");
  await press("ArrowUp"); await expectSelected("mode:hbuilderx-cli");
  assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`));
  fs.writeFileSync(path.join(output, "keyboard-narrow.png"), Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
  // Leave a remembered third-column anchor, then resize without changing selection.
  await cdp("Emulation.setDeviceMetricsOverride", { width: 760, height: 560, deviceScaleFactor: 1, mobile: false });
  await press("ArrowDown"); await expectSelected("mode:tool-manager");
  await press("ArrowUp"); await expectSelected("mode:hbuilderx-cli");
  check("responsive three-column layout and resize use current card positions and reset stale anchors");

  await evaluate(`localStorage.setItem('devhub:launcher-history', JSON.stringify({ pinned: ['tool:everything'], recent: ['tool:geek', 'mode:settings'] }));`);
  await show();
  await expectSelected("tool:everything");
  await press("ArrowDown"); await expectSelected("tool:geek");
  await press("ArrowRight"); await expectSelected("mode:settings");
  await press("ArrowDown"); await expectSelected("mode:project-configs");
  await press("ArrowUp"); await expectSelected("mode:settings");
  await press("ArrowUp"); await expectSelected("tool:everything");
  await press("ArrowDown"); await expectSelected("mode:settings");
  check("native vertical arrows remember the intended column through a one-item pinned section");

  await focusEntry("mode:extensions");
  await press("ArrowLeft"); await expectSelected("mode:ai-configs");
  assert.equal(await evaluate(`document.activeElement.getAttribute('data-launcher-entry')`), "mode:ai-configs");
  await press("ArrowRight"); await expectSelected("mode:extensions");
  await press("ArrowRight"); await expectSelected("mode:project-configs");
  assert.equal(await evaluate(`document.activeElement.getAttribute('data-launcher-entry')`), "mode:project-configs");
  const modeCount = await evaluate(`__calls.filter(call => call.command === 'launcher_open_mode').length`);
  await press("Enter"); await wait(`!__shown`);
  assert.deepEqual(await evaluate(`__calls.filter(call => call.command === 'launcher_open_mode').slice(${modeCount}).map(call => call.args.mode)`), ["project-configs"]);
  check("native card arrows retain matching focus and Enter opens the highlighted mode once");

  await show();
  const beforePin = await selectedId();
  await evaluate(`document.querySelector('button[aria-label="固定扩展同步"]').focus();`);
  await press("ArrowRight");
  assert.equal(await selectedId(), beforePin);
  await press("Enter");
  await wait(`JSON.parse(localStorage.getItem('devhub:launcher-history')).pinned.includes('mode:extensions')`);
  await expectSelected("mode:extensions");
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), "搜索模式或工具");
  assert.equal(await evaluate(`__calls.filter(call => call.command === 'launcher_open_mode').length`), modeCount + 1);
  check("pin Enter retains selection through regrouping and restores input focus without launching");
  await evaluate(`document.querySelector('button[aria-label="打开应用设置"]').focus();`);
  const beforeHeaderArrow = await selectedId();
  await press("ArrowDown");
  assert.equal(await selectedId(), beforeHeaderArrow);
  await press("Enter"); await wait(`!__shown`);
  assert.equal(await evaluate(`__calls.filter(call => call.command === 'launcher_open_mode').at(-1).args.mode`), "settings");
  check("header buttons keep their native keyboard behavior");

  await show(); await fill("管理");
  await wait(`document.querySelector('section h2')?.textContent === '搜索结果'`);
  const firstSearchResult = await selectedId();
  await evaluate(`document.querySelector('input[aria-label="搜索模式或工具"]').setSelectionRange(2, 2);`);
  await press("ArrowLeft");
  assert.equal(await evaluate(`document.activeElement.selectionStart`), 1);
  assert.equal(await selectedId(), firstSearchResult);
  await press("ArrowRight");
  assert.equal(await evaluate(`document.activeElement.selectionStart`), 2);
  await press("ArrowLeft", 8);
  assert.deepEqual(await evaluate(`[document.activeElement.selectionStart, document.activeElement.selectionEnd]`), [1, 2]);
  assert.equal(await selectedId(), firstSearchResult);
  await press("Home");
  assert.equal(await evaluate(`document.activeElement.selectionStart`), 0);
  await press("End");
  assert.equal(await evaluate(`document.activeElement.selectionStart`), 2);
  assert.equal(await selectedId(), firstSearchResult);
  await press("ArrowDown");
  assert.notEqual(await selectedId(), firstSearchResult);
  await press("ArrowUp");
  assert.equal(await selectedId(), firstSearchResult);
  const lastSearchResult = await evaluate(`[...document.querySelectorAll('[data-launcher-entry]')].at(-1).closest('[id^="launcher-"]').id`);
  await press("ArrowUp");
  assert.equal(await selectedId(), lastSearchResult);
  await press("ArrowDown");
  assert.equal(await selectedId(), firstSearchResult);
  await focusEntry(firstSearchResult.replace("launcher-", ""));
  await press("End"); assert.equal(await selectedId(), lastSearchResult);
  await press("ArrowDown"); assert.equal(await selectedId(), firstSearchResult);
  await press("ArrowUp"); assert.equal(await selectedId(), lastSearchResult);
  await press("Home"); assert.equal(await selectedId(), firstSearchResult);
  await evaluate(`document.querySelector('input[aria-label="搜索模式或工具"]').focus();`);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', isComposing: true, bubbles: true }));`);
  assert.equal(await selectedId(), firstSearchResult);
  check("search wraps at both ends with input or card focus, preserves cursor editing and leaves IME arrows untouched");

  await focusEntry(firstSearchResult.replace("launcher-", ""));
  await press("ArrowDown");
  const selectedSearchId = (await selectedId()).replace("launcher-", "");
  assert.equal(await evaluate(`document.querySelectorAll('[data-launcher-entry][tabindex="0"]').length`), 1);
  await press("Tab");
  assert.equal(await evaluate(`document.activeElement.closest('[data-selected="true"]').id`), `launcher-${selectedSearchId}`);
  assert(await evaluate(`document.activeElement.hasAttribute('aria-pressed')`));
  check("Tab reaches the selected entry's pin without traversing every result");
  await fill("不存在的入口");
  await wait(`document.querySelectorAll('[data-launcher-entry]').length === 0`);
  const callsBeforeEmptyEnter = await evaluate(`__calls.length`);
  await press("ArrowDown"); await press("ArrowUp"); await press("Enter");
  assert.equal(await evaluate(`__shown`), true);
  assert.equal(await evaluate(`__calls.length`), callsBeforeEmptyEnter);
  check("empty search results ignore navigation and Enter safely");

  await evaluate(`localStorage.removeItem('devhub:launcher-history'); __calls = [];`);
  await show();
  await fill("EVERYTHING");
  await wait(`document.querySelectorAll('[id^="launcher-tool:"]').length === 1`);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }));`);
  await delay(50);
  assert.equal(await evaluate(`__calls.filter(call => call.command === 'tool_launch').length`), 0);
  check("Chinese composition Enter does not activate a tool");
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); __delay = 100; document.getElementById('launcher-tool:everything').querySelector('button').click(); document.getElementById('launcher-tool:everything').querySelector('button').click();`);
  await wait(`!__shown`);
  assert.equal(await evaluate(`__calls.filter(call => call.command === 'tool_launch').length`), 1);
  check("single-result arrow navigation and repeated clicks launch once");
  await show(); await fill("Everything");
  await focusEntry("tool:everything");
  await evaluate(`__delay = 150; __failure = '工具启动失败示例'; document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await wait(`document.querySelector('[data-launcher-entry]').disabled`);
  await wait(`document.querySelector('[role="alert"]')?.textContent.includes('工具启动失败示例')`);
  assert.equal(await evaluate(`__shown`), true);
  assert.equal(await evaluate(`document.activeElement.dataset.launcherEntry`), "tool:everything");
  const failedLaunches = await evaluate(`__calls.filter(call => call.command === 'tool_launch').length`);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));`);
  await delay(50);
  assert.equal(await evaluate(`__calls.filter(call => call.command === 'tool_launch').length`), failedLaunches);
  check("failed activation retains card focus and held Enter does not repeatedly launch");
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await wait(`document.querySelector('[data-launcher-entry]').disabled`);
  await evaluate(`document.querySelector('input[aria-label="搜索模式或工具"]').focus();`);
  await wait(`!document.querySelector('[data-launcher-entry]').disabled`);
  assert.equal(await evaluate(`document.activeElement.getAttribute('aria-label')`), "搜索模式或工具");
  check("failed activation does not steal focus if the user moved back to search while waiting");
  await evaluate(`__failure = null; __delay = 0`); await fill("自定义工具示例");
  await wait(`document.getElementById('launcher-custom:custom-demo')`);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await wait(`!__shown`);
  assert.equal(await evaluate(`__calls.find(call => call.command === 'custom_tool_open').args.exePath`), "D:\\Tools\\demo.exe");
  check("custom tool reuses the native open/focus command");
  await show(); await fill("待安装工具");
  await wait(`document.getElementById('launcher-tool:missing')`);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await wait(`!__shown`);
  assert.deepEqual(await evaluate(`__calls.find(call => call.command === 'launcher_open_mode').args`), { mode: "tool-manager", toolId: "tool:missing" });
  check("unavailable tool navigates to its management card");
  await show(); await fill(""); await delay(30);
  await evaluate(`document.querySelector('button[aria-label="固定Everything"]').click();`);
  await wait(`document.querySelector('section')?.textContent.includes('已固定')`);
  check("pinning updates the grid and persisted history");
  await evaluate(`__catalog[0].name = 'Everything 新名称'; __emit('devhub:settings-changed');`);
  await wait(`document.getElementById('launcher-tool:everything')?.textContent.includes('新名称')`);
  check("configuration events refresh renamed tool entries");
  await evaluate(`__catalogFailure = true; __emit('devhub:tools-changed');`);
  await wait(`document.querySelector('[role="alert"]')?.textContent.includes('tools.json')`);
  assert.equal(await evaluate(`document.querySelectorAll('[id^="launcher-mode:"]').length`), 11);
  assert.equal(await evaluate(`document.querySelectorAll('[id^="launcher-tool:"]').length`), 0);
  check("catalog failures clear stale tools while keeping modes usable");
  await evaluate(`document.querySelector('input[aria-label="搜索模式或工具"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  await wait(`!__shown`);
  check("Escape hides the standalone panel");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: `${address}/` });
  await wait(`__listenerCount('devhub:navigate') > 0`);
  await navigate("settings");
  await wait(`document.querySelector('input[placeholder="Ctrl+Alt+Space"]')`);
  await fill("Ctrl+Alt+K", 'input[placeholder="Ctrl+Alt+Space"]');
  await navigate("tool-manager"); await wait(`document.getElementById('tool-card-tool:everything')`);
  await navigate("settings"); await wait(`document.querySelector('[aria-hidden="false"] input[placeholder="Ctrl+Alt+Space"]')`);
  assert.equal(await evaluate(`document.querySelector('[aria-hidden="false"] input[placeholder="Ctrl+Alt+Space"]').value`), "Ctrl+Alt+K");
  assert.equal(await evaluate(`__listenerCount('tauri://drag-drop')`), 0);
  check("mode navigation retains unsaved settings and disables hidden drag listeners");
  await navigate("tool-manager", "tool:missing");
  await wait(`document.activeElement.id === 'tool-card-tool:missing'`);
  check("management navigation selects and focuses the requested card");
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));`);
  await wait(`document.querySelector('[role="dialog"] input[aria-label="搜索模式或工具"]')`);
  await focusEntry("mode:extensions");
  await press("ArrowRight"); await expectSelected("mode:project-configs");
  assert.equal(await evaluate(`document.activeElement.getAttribute('data-launcher-entry')`), "mode:project-configs");
  check("in-app Ctrl+K grid keeps native card focus aligned with selection");
  await fill("Everything");
  await wait(`document.querySelector('[role="dialog"] [id="launcher-tool:everything"]')`);
  await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));`);
  await wait(`!document.querySelector('[role="dialog"]')`);
  assert.equal(await evaluate(`__calls.filter(call => call.command === 'tool_launch').length`), 1);
  check("in-app Ctrl+K shares the same tool launch behavior");
  await evaluate(`__emit('tauri://close-requested');`);
  await wait(`__calls.some(call => call.command === 'launcher_hide_main')`);
  assert.equal(await evaluate(`__calls.filter(call => call.command === 'launcher_exit').length`), 0);
  check("ordinary close hides the main window without terminating tasks");
  await evaluate(`__jobs = [{ running: true }];`); await navigate("exit");
  await wait(`__calls.some(call => call.command === 'plugin:dialog|message')`);
  assert.equal(await evaluate(`__calls.filter(call => call.command === 'launcher_exit').length`), 0);
  assert.equal(await evaluate(`__calls.filter(call => call.command === 'stop_all_hbuilderx_web_runs').length`), 0);
  check("canceling tray exit preserves running tasks");
  await evaluate(`__confirm = true`); await navigate("exit");
  await wait(`__calls.some(call => call.command === 'launcher_exit')`);
  assert.equal(await evaluate(`__calls.filter(call => call.command === 'stop_all_hbuilderx_web_runs').length`), 1);
  check("confirmed exit stops tasks before exiting");
  assert.deepEqual(exceptions, []);
  fs.writeFileSync(path.join(output, "results.json"), JSON.stringify({ passed: results, exceptions }, null, 2));
  console.log(`Passed ${results.length} UI checks. Screenshot: ${path.join(output, "panel.png")}`);
  await cdp("Browser.close");
} finally {
  socket?.close();
  if (browser.exitCode === null) { await delay(500); if (browser.exitCode === null) browser.kill(); }
  server.close();
}
