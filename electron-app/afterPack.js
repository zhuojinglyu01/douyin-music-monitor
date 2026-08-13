// 打包后给 mac App 补一个有效的 ad-hoc 临时签名。
// 否则未签名的 App 在 Apple 芯片上下载后会报 "已损坏"（damaged）。
// 补了之后变成友好的"未知开发者 → 右键打开"。（真正免提示需 Apple 开发者签名+公证。）
const { execSync } = require("node:child_process");
const path = require("node:path");

exports.default = async function (context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = context.packager.appInfo.productFilename + ".app";
  const appPath = path.join(context.appOutDir, appName);
  try {
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "ignore" });
    console.log(`  • ad-hoc signed ${appName}`);
  } catch (e) {
    console.warn(`  • ad-hoc sign failed: ${e.message}`);
  }
};
