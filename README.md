# 言序

言序是一个本地优先的结构化表达训练应用，面向面试、工作汇报和项目复盘场景。

## 当前版本

当前版本为 Mac 优先的本地可用版：首次启动为空数据，支持本地会话与训练计划、JD/简历文件解析、真实音频上传、按需下载的 Whisper 离线转写、OpenAI-compatible 在线转写与 AI 分析，以及通过用户自有 WebDAV 服务同步结构化数据和原始录音。界面采用响应式布局，为后续 Android 打包复用领域逻辑，同时保留移动端独立单栏交互。

## 本地运行

```bash
pnpm install
pnpm dev
```

启动 Tauri 桌面应用：

```bash
pnpm tauri dev
```

在 macOS 上生成通用架构安装包：

```bash
pnpm build:macos
```

详细说明见 `docs/macOS打包.md`。

## 验证

```bash
pnpm test
pnpm build
```
