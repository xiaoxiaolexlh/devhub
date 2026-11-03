import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

// Run the production TypeScript modules in Node 20 without emitting build files.
function loadTypeScript(relativePath) {
  const url = new URL(relativePath, import.meta.url);
  const source = fs.readFileSync(url, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: fileURLToPath(url),
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const exports = {};
  new Function("require", "exports", outputText)(createRequire(url), exports);
  return exports;
}

const { useHBuilderXPublish: store, publishTaskKey } = loadTypeScript("../src/stores/hbuilderxPublish.ts");
const { defaultPublishCloudPackConfig, buildPublishCloudPackDisplayCommand } = loadTypeScript("../src/lib/hbuilderxCloudPack.ts");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function success(stdout) {
  return {
    success: true,
    command_success: true,
    exit_code: 0,
    stdout,
    stderr: "",
    command: "cli pack",
    error: null,
    copy_result: null,
  };
}

test.beforeEach(() => store.setState({ tasks: {}, latestTask: null }));

test("a pending publish and its download result survive page unsubscribe and resubscribe", async () => {
  const pending = deferred();
  const unsubscribe = store.subscribe(() => {});
  const invocation = store.getState().runPublish("project-a", "cloud-app", () => pending.promise);
  const key = publishTaskKey("project-a", "cloud-app");
  unsubscribe();
  assert.equal(store.getState().tasks[key].running, true);
  assert.deepEqual(store.getState().latestTask, { projectId: "project-a", platform: "cloud-app" });

  pending.resolve(success("下载地址: https://example.com/app.apk"));
  await invocation;
  const resubscribe = store.subscribe(() => {});
  assert.equal(store.getState().tasks[key].running, false);
  assert.equal(store.getState().tasks[key].result.stdout, "下载地址: https://example.com/app.apk");
  resubscribe();
});

test("rapid repeated clicks and another publish platform cannot submit the same project twice", async () => {
  const pending = deferred();
  const invocation = store.getState().runPublish("project-a", "cloud-app", () => pending.promise);
  let duplicateCalls = 0;
  for (const platform of ["cloud-app", "mp-alipay", "local-app-resource"]) {
    const result = await store.getState().runPublish("project-a", platform, async () => {
      duplicateCalls += 1;
      return success("duplicate");
    });
    assert.equal(result, null);
  }
  assert.equal(duplicateCalls, 0);
  pending.resolve(success("first"));
  await invocation;
});

test("results and running status are isolated by both project and publish platform", async () => {
  const local = success("local resources");
  const cloud = success("cloud download");
  const other = success("other project's result");
  await store.getState().runPublish("project-a", "local-app-resource", async () => local);
  assert.equal(store.getState().tasks[publishTaskKey("project-a", "cloud-app")], undefined);
  await store.getState().runPublish("project-a", "cloud-app", async () => cloud);
  await store.getState().runPublish("project-b", "cloud-app", async () => other);
  assert.equal(store.getState().tasks[publishTaskKey("project-a", "local-app-resource")].result, local);
  assert.equal(store.getState().tasks[publishTaskKey("project-a", "cloud-app")].result, cloud);
  assert.equal(store.getState().tasks[publishTaskKey("project-b", "cloud-app")].result, other);
});

test("an invocation failure is retained and releases the project for a retry", async () => {
  const failed = await store.getState().runPublish("project-a", "cloud-app", async () => {
    throw new Error("CLI unavailable");
  });
  const key = publishTaskKey("project-a", "cloud-app");
  assert.equal(failed.success, false);
  assert.match(failed.error, /CLI unavailable/);
  assert.equal(store.getState().tasks[key].running, false);

  const retry = deferred();
  const invocation = store.getState().runPublish("project-a", "cloud-app", () => retry.promise);
  assert.equal(store.getState().tasks[key].result, undefined);
  retry.resolve(success("retry completed"));
  await invocation;
  assert.equal(store.getState().tasks[key].result.success, true);
});

test("concurrent projects retain both results when they finish in reverse order", async () => {
  const first = deferred();
  const second = deferred();
  const a = store.getState().runPublish("project-a", "cloud-app", () => first.promise);
  const b = store.getState().runPublish("project-b", "mp-alipay", () => second.promise);
  second.resolve(success("B"));
  await b;
  assert.equal(store.getState().tasks[publishTaskKey("project-a", "cloud-app")].running, true);
  first.resolve(success("A"));
  await a;
  assert.equal(store.getState().tasks[publishTaskKey("project-a", "cloud-app")].result.stdout, "A");
  assert.equal(store.getState().tasks[publishTaskKey("project-b", "mp-alipay")].result.stdout, "B");
});

test("Android preview masks both passwords without changing the request options", () => {
  const options = defaultPublishCloudPackConfig();
  Object.assign(options.android, {
    packagename: "com.example.app",
    androidpacktype: "0",
    certalias: "alias",
    certfile: "D:/cert.keystore",
    certpassword: " certificate-secret ",
    storepassword: " store-secret ",
  });
  const command = buildPublishCloudPackDisplayCommand("D:/HBuilderX", "D:/project", options);
  assert.doesNotMatch(command, /certificate-secret|store-secret/);
  assert.ok(command.includes("--android.certpassword ******"));
  assert.ok(command.includes("--android.storepassword ******"));
  assert.equal(options.android.certpassword, " certificate-secret ");
  assert.equal(options.android.storepassword, " store-secret ");
});

test("iOS preview masks the password and treats spaces as part of a supplied password", () => {
  const options = defaultPublishCloudPackConfig();
  options.platform = "ios";
  options.ios.bundle = "com.example.app";
  for (const password of [" ios-secret ", "   "]) {
    options.ios.certpassword = password;
    const command = buildPublishCloudPackDisplayCommand("D:/HBuilderX", "D:/project", options);
    assert.doesNotMatch(command, /ios-secret/);
    assert.ok(command.includes("--ios.certpassword ******"));
    assert.equal(options.ios.certpassword, password);
  }
});
