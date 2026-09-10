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

corepack enable
pnpm install --frozen-lockfile
rustup target add aarch64-apple-darwin x86_64-apple-darwin

pnpm exec tauri build \
  --ci \
  --no-sign \
  --target universal-apple-darwin \
  --bundles app,dmg

bundle_root="$project_root/src-tauri/target/universal-apple-darwin/release/bundle"
echo "macOS 安装包已生成："
find "$bundle_root" -type f \( -name '*.dmg' -o -name '*.app.tar.gz' \) -print
