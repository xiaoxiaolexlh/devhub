/**
 * DevHub 一键发版脚本
 *
 * 用法:
 *   node tools/release.mjs              # 构建当前版本并发布
 *   node tools/release.mjs --no-build   # 跳过构建,仅发布已有产物
 *
 * 前置条件:
 *   - 设置环境变量 TAURI_SIGNING_PRIVATE_KEY (私钥内容)
 *   - 或设置 TAURI_SIGNING_PRIVATE_KEY_PATH (私钥文件路径)
 *
 * 脚本会:
 *   1. 从 tauri.conf.json 读取版本号
 *   2. 调用 pnpm tauri build (带签名)
 *   3. 读取 .sig 签名文件
 *   4. 自动生成 latest.json
 *   5. 创建 git tag + GitHub Release (上传安装包 + latest.json)
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CONF_PATH = join(ROOT, "src-tauri", "tauri.conf.json");
const BUNDLE_DIR = join(ROOT, "src-tauri", "target", "release", "bundle", "nsis");

const args = process.argv.slice(2);
const skipBuild = args.includes("--no-build");

// 1. 读取版本号
const conf = JSON.parse(readFileSync(CONF_PATH, "utf8"));
const version = conf.version;
const productName = conf.productName; // "DevHub"
const repo = "xiaoxiaolexlh/devhub";
const tag = `v${version}`;

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
  notes: `DevHub ${tag}`,
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
try {
  execSync(`git rev-parse ${tag}`, { stdio: "pipe" });
  console.log(`  → tag ${tag} 已存在,跳过创建`);
} catch {
  execSync(`git tag ${tag}`, { cwd: ROOT, stdio: "inherit" });
  execSync(`git push origin ${tag}`, { cwd: ROOT, stdio: "inherit" });
  console.log(`  ✓ git tag ${tag} 已推送`);
}

// 6. 创建 GitHub Release
const releaseNotes = `DevHub ${tag}`;
try {
  execSync(
    `gh release create ${tag} "${installerPath}" "${latestJsonPath}" --title "${tag}" --notes "${releaseNotes}"`,
    { cwd: ROOT, stdio: "inherit" }
  );
  console.log(`\n✅ 发版完成! https://github.com/${repo}/releases/tag/${tag}\n`);
} catch (e) {
  // release 可能已存在,尝试更新
  console.log("  → Release 可能已存在,尝试更新产物...");
  execSync(
    `gh release upload ${tag} "${installerPath}" "${latestJsonPath}" --clobber`,
    { cwd: ROOT, stdio: "inherit" }
  );
  console.log(`\n✅ 产物已更新! https://github.com/${repo}/releases/tag/${tag}\n`);
}
