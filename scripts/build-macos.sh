#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "错误：macOS 安装包必须在 macOS 环境构建。"
  exit 1
fi

project_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$project_root"

export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
# Tauri 官方建议：没有 Apple Developer 证书时，至少使用 ad-hoc
# 签名，避免从浏览器下载的 Apple Silicon 应用被判定为损坏。
export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:--}"

if ! command -v pnpm >/dev/null 2>&1; then
  corepack prepare pnpm@9.12.3 --activate
fi
pnpm install --frozen-lockfile
rustup target add aarch64-apple-darwin x86_64-apple-darwin

pnpm exec tauri build \
  --ci \
  --target universal-apple-darwin \
  --bundles app

bundle_root="$project_root/src-tauri/target/universal-apple-darwin/release/bundle"
app_path="$bundle_root/macos/言序.app"
dmg_dir="$bundle_root/dmg"
app_version="$(node -p "require('./package.json').version")"
dmg_path="$dmg_dir/言序_${app_version}_universal.dmg"

codesign --verify --deep --strict --verbose=2 "$app_path"
codesign --display --verbose=4 "$app_path"
lipo -archs "$app_path/Contents/MacOS/structured-expression-coach"

# Tauri 的 bundle_dmg.sh 在 GitHub macOS runner 上存在偶发失败。
# 应用本体完成签名校验后，直接使用 macOS 原生 hdiutil 生成标准安装盘。
dmg_staging_dir="$(mktemp -d)"
cleanup() {
  rm -rf "$dmg_staging_dir"
}
trap cleanup EXIT

cp -R "$app_path" "$dmg_staging_dir/言序.app"
ln -s /Applications "$dmg_staging_dir/Applications"
mkdir -p "$dmg_dir"
hdiutil create \
  -volname "言序" \
  -srcfolder "$dmg_staging_dir" \
  -ov \
  -format UDZO \
  "$dmg_path"
hdiutil verify "$dmg_path"

echo "macOS 安装包已生成："
find "$bundle_root" -type f \( -name '*.dmg' -o -name '*.app.tar.gz' \) -print
