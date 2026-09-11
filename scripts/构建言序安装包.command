#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "========================================"
echo "        言序 macOS 安装包构建"
echo "========================================"
echo

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "此脚本只能在 macOS 上运行。"
  read -r -p "按回车键退出…"
  exit 1
fi

missing=0

if ! xcode-select -p >/dev/null 2>&1; then
  echo "缺少 Xcode Command Line Tools。"
  echo "请先运行：xcode-select --install"
  missing=1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "缺少 Node.js 22。建议从 https://nodejs.org 安装 LTS 版本。"
  missing=1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "缺少 pnpm。安装 Node.js 后运行：corepack enable"
  missing=1
fi

if ! command -v rustup >/dev/null 2>&1; then
  echo "缺少 Rust。请从 https://rustup.rs 安装。"
  missing=1
fi

if [[ "$missing" -ne 0 ]]; then
  echo
  echo "补齐上述环境后，再双击运行此文件。"
  read -r -p "按回车键退出…"
  exit 1
fi

echo "环境检查通过，开始构建。首次构建可能需要 10–30 分钟。"
echo
bash scripts/build-macos.sh

bundle_dir="$(pwd)/src-tauri/target/universal-apple-darwin/release/bundle/dmg"
echo
echo "构建完成，正在打开安装包目录："
echo "$bundle_dir"
open "$bundle_dir"
read -r -p "按回车键关闭窗口…"
