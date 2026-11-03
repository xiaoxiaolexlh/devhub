import type {
  HBuilderXCloudPackAndroidConfig,
  HBuilderXCloudPackIosConfig,
  HBuilderXPublishCloudPackConfig,
} from "@/lib/tauri";

export function defaultPublishCloudPackConfig(): HBuilderXPublishCloudPackConfig {
  return {
    platform: "android",
    iscustom: false,
    safemode: false,
    source_map: false,
    dsyms: false,
    isconfusion: false,
    splashads: false,
    rpads: false,
    unimpads: false,
    ad_domestic: "",
    ad_international: "",
    ad_content: "",
    ignore_warnings: false,
    android: defaultCloudPackAndroidConfig(),
    ios: defaultCloudPackIosConfig(),
  };
}

export function defaultCloudPackAndroidConfig(): HBuilderXCloudPackAndroidConfig {
  return {
    packagename: "",
    androidpacktype: "1",
    certalias: "",
    certfile: "",
    certpassword: "",
    storepassword: "",
    channels: "",
    anti_resign_appid: false,
    anti_resign_package_name: false,
    anti_resign_certificate: false,
  };
}

export function defaultCloudPackIosConfig(): HBuilderXCloudPackIosConfig {
  return {
    bundle: "",
    supporteddevice: "iPhone",
    channels: "",
    profile: "",
    certfile: "",
    certpassword: "",
  };
}

export function parseCloudPackPlatforms(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function buildPublishCloudPackDisplayCommand(
  cliDir: string,
  projectPath: string,
  options: HBuilderXPublishCloudPackConfig,
) {
  const cli = cliDir.trim() ? `${cliDir.replace(/[\\/]$/, "")}\\cli.exe` : "cli.exe";
  const platforms = parseCloudPackPlatforms(options.platform);
  const parts = [
    cli,
    "pack",
    "--project",
    projectPath || "<项目全路径>",
    "--platform",
    platforms.join(",") || "<android|ios>",
  ];
  const flags: Array<[string, boolean]> = [
    ["--iscustom", options.iscustom],
    ["--safemode", options.safemode],
    ["--sourceMap", options.source_map],
    ["--dsyms", options.dsyms],
    ["--isconfusion", options.isconfusion],
    ["--splashads", options.splashads],
    ["--rpads", options.rpads],
    ["--unimpads", options.unimpads],
    ["--ignoreWarnings", options.ignore_warnings],
  ];
  for (const [flag, enabled] of flags) {
    if (enabled) parts.push(flag, "true");
  }
  const ads: Array<[string, string]> = [
    ["--ad.domestic", options.ad_domestic],
    ["--ad.international", options.ad_international],
    ["--ad.content", options.ad_content],
  ];
  for (const [flag, value] of ads) {
    if (value.trim()) parts.push(flag, value.trim());
  }

  if (platforms.includes("android")) {
    const android = { ...defaultCloudPackAndroidConfig(), ...options.android };
    const packtype = android.androidpacktype || "1";
    parts.push("--android.packagename", android.packagename.trim() || "<包名>");
    parts.push("--android.androidpacktype", packtype);
    if (packtype === "0") {
      parts.push("--android.certalias", android.certalias.trim() || "<证书别名>");
      parts.push("--android.certfile", android.certfile.trim() || "<证书文件>");
      parts.push("--android.certpassword", maskedPassword(android.certpassword, "<证书密码>"));
      parts.push("--android.storepassword", maskedPassword(android.storepassword, "<证书库密码>"));
    }
    if (android.channels.trim()) {
      parts.push("--android.channels", android.channels.trim());
    }
    const androidFlags: Array<[string, boolean]> = [
      ["--android.antiResignAppid", android.anti_resign_appid],
      ["--android.antiResignPackageName", android.anti_resign_package_name],
      ["--android.antiResignCertificate", android.anti_resign_certificate],
    ];
    for (const [flag, enabled] of androidFlags) {
      if (enabled) parts.push(flag, "true");
    }
  }

  if (platforms.includes("ios")) {
    const ios = { ...defaultCloudPackIosConfig(), ...options.ios };
    parts.push("--ios.bundle", ios.bundle.trim() || "<App ID>");
    if (ios.supporteddevice.trim()) {
      parts.push("--ios.supporteddevice", ios.supporteddevice.trim());
    }
    if (ios.channels.trim()) {
      parts.push("--ios.channels", ios.channels.trim());
    }
    if (ios.profile.trim() || ios.certfile.trim() || ios.certpassword) {
      parts.push("--ios.profile", ios.profile.trim() || "<profile 文件>");
      parts.push("--ios.certfile", ios.certfile.trim() || "<p12 文件>");
      parts.push("--ios.certpassword", maskedPassword(ios.certpassword, "<证书密码>"));
    }
  }

  return parts.map(quotePart).join(" ");
}

function maskedPassword(value: string, placeholder: string) {
  return value.length > 0 ? "******" : placeholder;
}

function quotePart(value: string) {
  if (!value) return "\"\"";
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}
