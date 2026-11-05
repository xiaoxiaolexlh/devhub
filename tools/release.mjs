/**
 * DevHub 一键发版脚本
 *
 * 用法:
 *   node tools/release.mjs              # 构建当前版本并发布
 *   node tools/release.mjs --no-build   # 跳过构建,仅发布已有产物
 *   node tools/release.mjs --notes-only # 只打印将写入 Release 的发版说明
 *   node tools/release.mjs --notes "..."        # 手动指定发版说明
 *   node tools/release.mjs --notes-file notes.md # 从文件读取发版说明
 *
 * 前置条件:
 *   - 设置环境变量 TAURI_SIGNING_PRIVATE_KEY (私钥内容)
 *   - 或设置 TAURI_SIGNING_PRIVATE_KEY_PATH (私钥文件路径)
 *
 * 脚本会:
 *   1. 从 tauri.conf.json 读取版本号
 *   2. 调用 pnpm tauri build (带签名)
 *   3. 读取 .sig 签名文件
 *   4. 按上一个 tag 之后的提交自动生成发版说明,并写入 latest.json
 *   5. 创建 git tag + GitHub Release (上传安装包 + latest.json);Release 已存在时同步更新说明与产物
 */
import { readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONF_PATH = join(ROOT, "src-tauri", "tauri.conf.json");
const BUNDLE_DIR = join(ROOT, "src-tauri", "target", "release", "bundle", "nsis");

const args = process.argv.slice(2);
const skipBuild = args.includes("--no-build");
const notesOnly = args.includes("--notes-only");

// 从 --notes "..." / --notes-file path 读取手动指定的发版说明
function argValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`  ✗ ${name} 后缺少内容`);
    process.exit(1);
  }
  return value;
}

const manualNotes = argValue("--notes");
const notesFile = argValue("--notes-file");
if (manualNotes && notesFile) {
  console.error("  ✗ --notes 与 --notes-file 只能二选一");
  process.exit(1);
}

// 1. 读取版本号
const conf = JSON.parse(readFileSync(CONF_PATH, "utf8"));
const version = conf.version;
const productName = conf.productName; // "DevHub"
const repo = "xiaoxiaolexlh/devhub";
const tag = `v${version}`;

function git(command) {
  return execSync(command, { cwd: ROOT, encoding: "utf8" }).trim();
}

function tagExists(name) {
  try {
    execSync(`git rev-parse --verify --quiet ${name}`, { cwd: ROOT, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// 上一个版本 tag,用于确定本次发版包含的提交范围
function previousTag() {
  try {
    const tags = git("git tag --list \"v*\" --sort=-v:refname")
      .split("\n")
      .map((line) => line.trim())
      .filter((name) => name && name !== tag);
    return tags[0] ?? null;
  } catch {
    return null;
  }
}

const SUBJECT_PREFIX = /^(feat|fix|perf|refactor|docs|style|test|build|ci|chore|revert)(\([^)]*\))?!?:\s*/;

// 把提交说明转换成 Release 条目:标题去掉类型前缀,正文去掉署名与多余空行
function formatEntry({ subject, body }) {
  const title = subject.replace(SUBJECT_PREFIX, "").trim() || subject.trim();
  const bodyLines = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trimEnd();
    if (/^co-authored-by:/i.test(line.trim())) continue;
    if (line === "" && (bodyLines.at(-1) === "" || bodyLines.length === 0)) continue;
    bodyLines.push(line);
  }
  while (bodyLines.at(-1) === "") bodyLines.pop();
  return [`### ${title}`, ...bodyLines].join("\n");
}

function collectCommits(from) {
  const range = from ? `${from}..HEAD` : "HEAD";
  try {
    return execSync(`git log ${range} --no-merges --pretty=format:%s%x1f%b%x1e`, {
      cwd: ROOT,
      encoding: "utf8",
    })
      .split("\x1e")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => {
        const separator = chunk.indexOf("\x1f");
        return separator === -1
          ? { subject: chunk, body: "" }
          : { subject: chunk.slice(0, separator).trim(), body: chunk.slice(separator + 1) };
      })
      .filter(({ subject }) => subject && !subject.startsWith("Merge "));
  } catch {
    return [];
  }
}

// 发版说明:手动指定 > 上一个 tag 到当前 HEAD 的提交
function buildNotes() {
  if (manualNotes) return manualNotes.trim();
  if (notesFile) {
    if (!existsSync(notesFile)) {
      console.error(`  ✗ 发版说明文件不存在: ${notesFile}`);
      process.exit(1);
    }
    return readFileSync(notesFile, "utf8").trim();
  }
  const from = previousTag();
  const commits = collectCommits(from);
  if (commits.length === 0) return `DevHub ${tag}`;
  const range = from ? `自 ${from} 之后的 ${commits.length} 个提交` : `共 ${commits.length} 个提交`;
  const entries = commits.map(formatEntry).join("\n\n");
  return [`## DevHub ${tag}`, "", range, "", entries].join("\n").trim();
}

const releaseNotes = buildNotes();

if (notesOnly) {
  console.log(releaseNotes);
  process.exit(0);
}

console.log(`\n📦 DevHub ${tag} 发版开始\n`);

// 2. 构建 (除非 --no-build)
if (!skipBuild) {
  // 确保签名密钥可用
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    const keyPath = join(ROOT, "src-tauri", "tauri.key");
    if (existsSync(keyPath)) {
      process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(keyPath, "utf8").trim();
      process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || "";
      console.log("  ✓ 从 src-tauri/tauri.key 自动加载签名密钥");
    } else {
      console.error("  ✗ 未找到签名密钥,请设置 TAURI_SIGNING_PRIVATE_KEY 环境变量");
      process.exit(1);
    }
  }

  console.log("  → 构建中 (pnpm tauri build)...\n");
  execSync("pnpm tauri build", { cwd: ROOT, stdio: "inherit", env: process.env });
}

// 3. 找到安装包和签名文件
const installerName = `${productName}_${version}_x64-setup.exe`;
const installerPath = join(BUNDLE_DIR, installerName);
const sigPath = `${installerPath}.sig`;

if (!existsSync(installerPath)) {
  console.error(`  ✗ 安装包不存在: ${installerPath}`);
  process.exit(1);
}
if (!existsSync(sigPath)) {
  console.error(`  ✗ 签名文件不存在: ${sigPath}`);
  process.exit(1);
}

console.log(`  ✓ 安装包: ${installerName}`);
console.log(`  ✓ 签名:   ${installerName}.sig`);

// 4. 生成 latest.json
const signature = readFileSync(sigPath, "utf8");
const downloadUrl = `https://github.com/${repo}/releases/download/${tag}/${installerName}`;
const manifest = {
  version,
  notes: releaseNotes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: downloadUrl,
    },
  },
};

const latestJsonPath = join(BUNDLE_DIR, "latest.json");
writeFileSync(latestJsonPath, JSON.stringify(manifest, null, 2));
console.log(`  ✓ latest.json 已生成 (version: ${version})`);

// 5. 检查 tag 是否已存在
if (tagExists(tag)) {
  console.log(`  → tag ${tag} 已存在,跳过创建`);
} else {
  execSync(`git tag ${tag}`, { cwd: ROOT, stdio: "inherit" });
  execSync(`git push origin ${tag}`, { cwd: ROOT, stdio: "inherit" });
  console.log(`  ✓ git tag ${tag} 已推送`);
}

// 6. 创建或更新 GitHub Release;发版说明通过临时文件传入,避免多行文本被 shell 转义破坏
const notesPath = join(tmpdir(), `devhub-release-notes-${version}.md`);
writeFileSync(notesPath, `${releaseNotes}\n`);

try {
  execSync(
    `gh release create "${tag}" "${installerPath}" "${latestJsonPath}" --title "${tag}" --notes-file "${notesPath}"`,
    { cwd: ROOT, stdio: "inherit" }
  );
  console.log(`  ✓ 发版说明已写入 Release`);
  console.log(`\n✅ 发版完成! https://github.com/${repo}/releases/tag/${tag}\n`);
} catch {
  // release 已存在:同步更新发版说明并覆盖产物
  console.log("  → Release 已存在,更新发版说明和产物...");
  execSync(`gh release edit "${tag}" --title "${tag}" --notes-file "${notesPath}"`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  execSync(`gh release upload "${tag}" "${installerPath}" "${latestJsonPath}" --clobber`, {
    cwd: ROOT,
    stdio: "inherit",
  });
  console.log(`  ✓ 发版说明已更新`);
  console.log(`\n✅ 产物与说明已更新! https://github.com/${repo}/releases/tag/${tag}\n`);
} finally {
  rmSync(notesPath, { force: true });
}
