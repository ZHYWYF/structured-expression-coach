# macOS 打包

## 目标产物

默认生成同时支持 Apple Silicon 与 Intel Mac 的通用应用：

- `src-tauri/target/universal-apple-darwin/release/bundle/dmg/*.dmg`
- `src-tauri/target/universal-apple-darwin/release/bundle/macos/*.app`

## macOS 本机打包

需要安装 Xcode Command Line Tools、Rust、Node.js 与 pnpm。在项目根目录执行：

```bash
bash scripts/build-macos.sh
```

也可以直接双击 `scripts/构建言序安装包.command`。脚本会检查所需环境，构建完成后自动打开 `.dmg` 所在目录。

当前脚本生成未使用 Apple Developer 证书签名的内部测试包。首次打开时，如果 macOS 阻止运行，可在“系统设置 → 隐私与安全性”中确认打开。

## 远程构建

仓库内包含 `.github/workflows/build-macos.yml`。将代码推送到 GitHub 私有仓库后，可以手动运行 `Build macOS installer` 工作流并下载 `yanxu-macos-universal` 产物。源码与构建产物均保持私有。

## 正式分发

当前版本适合个人测试。若后续需要直接分发给其他用户，应增加 Apple Developer ID 签名、公证和自动更新配置，相关凭证只存放在 CI 密钥管理中，不写入仓库。
