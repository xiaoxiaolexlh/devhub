// Build the Windows 11 shell extension. All generated files stay in the project.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") process.exit(0);
if (process.arch !== "x64" || (process.env.TAURI_ENV_TARGET_TRIPLE &&
    process.env.TAURI_ENV_TARGET_TRIPLE !== "x86_64-pc-windows-msvc")) {
  throw new Error("Explorer integration currently requires Windows x64.");
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "src-tauri", "explorer");
const output = join(root, "src-tauri", "target", "explorer");
const resources = join(root, "src-tauri", "resources", "explorer");
const packageDir = join(output, "package");
mkdirSync(join(output, "tmp"), { recursive: true });
mkdirSync(join(packageDir, "Assets"), { recursive: true });
mkdirSync(resources, { recursive: true });
const env = { ...process.env, TEMP: join(output, "tmp"), TMP: join(output, "tmp") };
const run = (exe, args) => execFileSync(exe, args, { cwd: output, env, stdio: "inherit", windowsHide: true });
const vswhere = join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
  "Microsoft Visual Studio", "Installer", "vswhere.exe");
const vcvars = execFileSync(vswhere, ["-latest", "-products", "*", "-requires",
  "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-find", "VC\\Auxiliary\\Build\\vcvars64.bat"],
  { encoding: "utf8", env, windowsHide: true }).trim();
if (!vcvars || !existsSync(vcvars)) throw new Error("Visual Studio C++ x64 build tools are required.");
const sdkRoot = join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
const sdk = readdirSync(sdkRoot).filter(name => /^10\./.test(name))
  .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  .map(name => join(sdkRoot, name, "x64", "makeappx.exe")).find(existsSync);
if (!sdk) throw new Error("Windows SDK MakeAppx.exe is required.");

// Use a batch file so vcvars and cl share their environment. No user data is
// interpolated into commands; project paths are quoted and % is rejected.
if ([root, vcvars].some(path => /[\r\n%]/.test(path))) throw new Error("Build path contains unsupported batch characters.");
const command = [
  "@echo off",
  `call "${vcvars}" >nul`,
  "if errorlevel 1 exit /b %errorlevel%",
  `cl.exe /nologo /LD /MT /O2 /EHsc /W4 /utf-8 /std:c++17 /DUNICODE /D_UNICODE "${join(source, "command.cpp")}" /Fe:"${join(resources, "devhub-explorer.dll")}" /link /DEF:"${join(source, "command.def")}" /IMPLIB:"${join(output, "devhub-explorer.lib")}" ole32.lib shell32.lib shlwapi.lib uuid.lib`,
  "exit /b %errorlevel%",
].join("\r\n");
const batch = join(output, "build.cmd");
writeFileSync(batch, command);
run(process.env.ComSpec || "cmd.exe", ["/d", "/c", batch]);

if (process.argv.includes("--test")) {
  const testExe = join(output, "explorer-test.exe");
  writeFileSync(batch, ["@echo off", `call "${vcvars}" >nul`, "if errorlevel 1 exit /b %errorlevel%",
    `cl.exe /nologo /MT /EHsc /W4 /utf-8 /std:c++17 /DUNICODE /D_UNICODE "${join(source, "test.cpp")}" /Fe:"${testExe}" /link ole32.lib shell32.lib shlwapi.lib uuid.lib`,
    "exit /b %errorlevel%"].join("\r\n"));
  run(process.env.ComSpec || "cmd.exe", ["/d", "/c", batch]);
  run(testExe, [root]);
}

const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const version = config.version.split(".").slice(0, 3).concat("0").join(".");
const publisher = process.env.DEVHUB_EXPLORER_PUBLISHER ||
  "CN=DevHub, OID.2.25.311729368913984317654407730594956997722=1";
const xmlEscape = value => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
const manifest = readFileSync(join(source, "AppxManifest.xml.in"), "utf8")
  .replace("@VERSION@", version).replace("@PUBLISHER@", xmlEscape(publisher));
writeFileSync(join(packageDir, "AppxManifest.xml"), manifest);
const oldLogo = join(packageDir, "Assets", "Logo.png");
if (existsSync(oldLogo)) unlinkSync(oldLogo);
for (const name of ["StoreLogo.png", "Square150x150Logo.png", "Square44x44Logo.png"]) {
  copyFileSync(join(root, "src-tauri", "icons", name), join(packageDir, "Assets", name));
}
const packageOutput = join(resources, "DevHub.ContextMenu.msix");
if (process.env.DEVHUB_EXPLORER_SIGNED_PACKAGE) {
  const signedPackage = resolve(process.env.DEVHUB_EXPLORER_SIGNED_PACKAGE);
  run(join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File",
      join(root, "tools", "verify-explorer-package.ps1"), "-PackagePath", signedPackage, "-ExpectedVersion", version]);
  if (signedPackage.toLowerCase() !== packageOutput.toLowerCase()) copyFileSync(signedPackage, packageOutput);
} else {
  // /nv permits external executable/DLL references in this sparse package.
  run(sdk, ["pack", "/d", packageDir, "/p", packageOutput, "/nv", "/o"]);
}
copyFileSync(join(source, "manage.ps1"), join(resources, "manage.ps1"));
console.log("Explorer extension built (registration is a separate user action).");
