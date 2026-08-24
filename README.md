# deadline清单 | Deadline List

[![GitHub release](https://img.shields.io/github/v/release/Amamiya42/deadline-list)](https://github.com/Amamiya42/deadline-list/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)](https://github.com/Amamiya42/deadline-list/releases/latest)

一款常驻桌面的 Deadline 待办清单：置顶倒计时横幅 + 便签式悬浮窗，让截止日期无法被忽视。

A lightweight desktop deadline tracker: an always-on-top countdown banner plus sticky-note floating windows, so a due date can never slip by unnoticed.

## 功能特性 / Features

- 任务卡片管理：添加、编辑、删除、完成归档，支持子任务
- 置顶横幅实时显示最紧急任务与剩余时间
- 任意任务可"撕"成独立悬浮便签，拖到屏幕任意角落
- 开机自启、托盘常驻、专注模式一键隐藏全部窗口
- 数据完全本地存储：无需联网、无账号、无遥测

- Task cards: add, edit, delete, and archive, with subtask support
- Always-on-top banner showing the most urgent task and time remaining
- Tear any task off into a floating sticky note, anywhere on screen
- Auto-start on boot, system-tray resident, one-click focus mode to hide everything
- 100% local data storage: no network, no account, no telemetry

## 下载安装 / Download

前往 **[Releases 页面](https://github.com/Amamiya42/deadline-list/releases/latest)** 下载对应系统的安装包：

| 平台 / Platform | 文件 / File |
|---|---|
| Windows（多数电脑 / most PCs, 64-bit） | `deadline-list-Setup-*-x64.exe` |
| Windows ARM 笔记本 / ARM laptops | `deadline-list-Setup-*-arm64.exe` |
| Windows 32 位老机器 / legacy 32-bit | `deadline-list-Setup-*-ia32.exe` |
| Windows 免安装绿色版 / portable | `deadline-list-*-win.zip` |
| macOS（Apple Silicon / M 系列） | `deadline-list-*-arm64.dmg` |
| macOS（Intel） | `deadline-list-*-x64.dmg` |
| Linux | `deadline-list-*-x86_64.AppImage` / `*-arm64.AppImage` |

### 安装提示 / Installation Notes

- **Windows**：首次安装可能出现蓝色 SmartScreen 提示 →「更多信息」→「仍要运行」（本应用未做代码签名）。
  First install may show a SmartScreen warning → "More info" → "Run anyway" (this app is not code-signed).
- **macOS**：首次打开如提示"无法验证开发者"→ 右键 App 图标 →「打开」。
  If macOS says the developer cannot be verified → right-click the app → "Open".
- **Linux**：AppImage 需先赋予执行权限 `chmod +x`。
  Make the AppImage executable first with `chmod +x`.

## 使用简介 / Quick Start

1. 在"添加任务"区填写任务名、截止时间和备注，点击**添加任务**
2. 桌面上会出现置顶横幅，实时倒计时最紧急的任务
3. **右键**任务卡片：编辑、添加子任务、撕成悬浮便签、完成、删除
4. 点击便签可将其拖到屏幕任意位置；托盘图标菜单可切换专注模式

1. Fill in the task name, deadline, and notes in the "Add Task" area, then click the add button
2. An always-on-top banner appears on your desktop, counting down to the most urgent task
3. **Right-click** a task card to edit, add subtasks, tear it off as a sticky note, complete, or delete
4. Drag sticky notes anywhere; use the tray icon menu to toggle focus mode

## 从源码运行 / Run from Source

```bash
git clone https://github.com/Amamiya42/deadline-list.git
cd deadline-list
npm install
npm start          # 开发模式运行 / run in dev mode
npm run dist:win   # 打包 Windows 安装包 / build Windows installer
```

需要 Node.js 18+。Windows 上也可以直接双击 `build-win.bat` 一键打包。
Requires Node.js 18+. On Windows you can also double-click `build-win.bat` to build.

## 技术栈 / Tech Stack

- [Electron](https://www.electronjs.org/) 33 — 跨平台桌面框架
- [electron-builder](https://www.electron.build/) — 安装包打包（NSIS / DMG / AppImage）
- GitHub Actions — 三平台矩阵自动构建与发版（Windows x64/ia32/arm64、macOS x64/arm64、Linux x64/arm64）

## 开发方式：Vibe Coding / Built with Vibe Coding

**本项目全程采用 Vibe Coding（AI 辅助编程）开发，没有手写一行代码。**

作者负责提出需求、验收功能和把控迭代方向；所有代码——从界面、逻辑到打包配置与 CI 工作流——均由 AI 编程助手生成、调试与重构。仓库的提交记录完整保留了这段人机协作的过程，欢迎翻阅。

**This project was built entirely through vibe coding (AI-assisted programming) — not a single line was handwritten.**

The author defined requirements, tested features, and steered iterations; every line of code — UI, logic, packaging config, and CI workflows — was generated, debugged, and refactored by an AI coding assistant. The commit history preserves this human–AI collaboration in full; feel free to browse it.

## 数据存储 / Data Storage

所有数据保存在本地 JSON 文件中 / All data lives in a local JSON file:

- Windows: `%APPDATA%\deadline清单\data.json`
- macOS: `~/Library/Application Support/deadline清单/data.json`
- Linux: `~/.config/deadline清单/data.json`

## 许可证 / License

[MIT](LICENSE) © Amamiya42
