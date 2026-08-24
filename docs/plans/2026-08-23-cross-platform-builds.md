# deadline清单 跨平台打包与发布设计

日期：2026-08-23
状态：已确认（用户选定方案 A：GitHub Actions 自动构建）

## 1. 背景与目标

当前应用以「裸 Electron 源码」方式运行（start.bat → electron.exe .），存在：

- 进程名显示 electron，无图标、无安装/卸载
- 无法分发给别人使用
- 用户希望得到真正的 .exe，并发布 6 个跨平台版本

### 目标

1. 用 electron-builder 打包出真正的 Windows 安装包（.exe）与便携 zip
2. 建立 GitHub Actions 矩阵工作流，自动产出全部平台产物：
   - Windows：x64 / ia32 / arm64 的 NSIS 安装包 + zip
   - macOS：Intel x64 + Apple Silicon arm64 的 .dmg
   - Linux：x64 + arm64 的 .AppImage
3. 打 git 标签（如 v1.0.2）即自动构建并汇总到 GitHub Release
4. 不做代码签名（免费跑通；SmartScreen/Gatekeeper 提示可接受）

### 非目标

- 不购买签名证书、不做公证（notarization）
- 不做自动更新（后续可选 electron-updater）
- 本地只构建 Windows x64 作为验证；其余平台全靠 CI

## 2. 方案选型

| 方案 | 结论 |
|------|------|
| electron-builder | ✅ 选定。声明式配置放 package.json，NSIS/dmg/AppImage 一站式，CI 支持最成熟 |
| electron-forge | 备选。更偏 Squirrel/webpack 生态，多目标安装包支持弱 |
| 手写 electron-packager 脚本 | 否。每个安装器格式都要自己拼工具链 |

## 3. 设计细节

### 3.1 打包配置（package.json "build" 字段）

- appId：com.yifan.deadlinelist（沿用既有 AUMID 域名风格）
- productName：deadline清单 → 决定 exe 名、安装目录、%APPDATA%\deadline清单 数据目录（与开发态一致，数据无缝迁移）
- files：仅 main.js / preload.js / renderer/** / package.json（排除 node_modules 由 builder 处理）
- 图标：build/icon.png（≥512×512），builder 自动转换 ico/icns/png 各尺寸
- win.target：nsis + zip（arch: x64, ia32, arm64）
- nsis：非一键安装、允许改安装路径、建桌面快捷方式
- mac.target：dmg（arch: x64, arm64）；category=productivity
- linux.target：AppImage（arch: x64, arm64）；category=Utility
- scripts 新增：dist:win = electron-builder --win；dist 全量交给 CI

### 3.2 应用图标

无现成图标。用 PowerShell System.Drawing 绘制 1024×1024 PNG：
红色圆角底（#e64a47，与应用主题色一致）+ 白色时钟指针图形，存为 build/icon.png。

### 3.3 CI 工作流（.github/workflows/release.yml)

- 触发：push tag v*（正式构建）+ workflow_dispatch（手动调试）
- matrix 三作业：
  - windows-latest：npm ci → npx electron-builder --win --x64 --ia32 --arm64
  - macos-latest：npx electron-builder --mac --x64 --arm64
  - ubuntu-latest：npx electron-builder --linux --x64 --arm64
- 每作业 upload-artifact 收集 dist 下 *.exe/*.zip/*.dmg/*.AppImage
- release 汇总作业：下载全部 artifact → softprops/action-gh-release@v2 附到对应 tag 的 Release（仅 tag 触发时）
- 使用内置 GITHUB_TOKEN，用户零配置

### 3.4 发布流程（教学阶段执行）

1. 在 GitHub 网页创建空公开仓库 deadline-list
2. 本地：git remote add origin …；首次 push main
3. 发版：npm version patch/minor → git push --tags
4. Actions 页看三平台构建进度，Release 页出现安装包

## 4. 风险与对策

| 风险 | 对策 |
|------|------|
| 中文 productName 个别工具链兼容 | NSIS/builder 均原生 Unicode；CI 上若报错再回退 ASCII artifactName |
| 首次构建需下载 Electron 二进制/winCodeSign | 本地给足超时；CI 官方 runner 网络无忧 |
| macOS 未签名 dmg 打不开 | 教学文档注明右键→打开 或 xattr -cr |
| Windows SmartScreen 拦截 | 注明「仍要运行」；未来可加签名 |
| 打包后 userData 与开发态共用同一 data.json | 属预期（同名 productName），便于无缝切换 |

## 5. 验收标准

1. 本地 dist/ 出现 deadline清单 Setup 1.0.2.exe 与同名 zip，win-unpacked 内 exe 可启动且功能正常
2. node --check 三个 js 通过；git status 只剩预期改动
3. workflow yml 通过 actionlint 语义检查（本地无 actionlint 则人工复核字段）
4. 用户按步骤能独立完成 GitHub 建仓 → push → 打 tag → 看到 Release 产物
