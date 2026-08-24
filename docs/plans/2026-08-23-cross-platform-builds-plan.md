# 跨平台打包与发布 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 deadline清单 用 electron-builder 打成真正的 Windows 安装包，并建好 GitHub Actions 三平台矩阵构建。

**Architecture:** 打包配置全部放 package.json 的 `build` 字段（electron-builder 约定）；图标用脚本生成一次性的 `build/icon.png`；CI 用 matrix 三作业分别产出 win/mac/linux 产物，tag 触发时汇总为 GitHub Release。本地只验证 Windows x64。

**Tech Stack:** electron-builder ^25/26、PowerShell System.Drawing（图标）、GitHub Actions（actions/checkout@v4、actions/setup-node@v4、actions/upload-artifact@v4、softprops/action-gh-release@v2）。

**Spec:** docs/plans/2026-08-23-cross-platform-builds.md

## Global Constraints

- 不做代码签名；所有产物 unsigned
- appId 固定：`com.yifan.deadlinelist`；productName 固定：`deadline清单`
- 图标源文件：`build/icon.png`，≥512×512 PNG
- 本地仅构建 `--win --x64`；其余平台交给 CI
- 用户未要求提交 → 计划内不执行 git commit，改动留在工作区由教学阶段引导用户自己提交

---

### Task 1: 安装 electron-builder 并生成应用图标

**Files:**
- Modify: `package.json`（devDependencies，经 npm 写入）
- Create: `build/icon.png`

**Interfaces:**
- Produces: 可用的 `npx electron-builder` 命令；`build/icon.png` 供 Task 2 的 build 配置引用

- [ ] **Step 1: 安装依赖**

```powershell
npm install --save-dev electron-builder
```
超时给足 10 分钟（需下载大量二进制）。

- [ ] **Step 2: 生成 1024×1024 图标**

PowerShell System.Drawing：红 #e64a47 圆角矩形底 + 白色时钟圆环与指针，保存为 UTF8 无 BOM 无关的二进制 PNG：

```powershell
Add-Type -AssemblyName System.Drawing
$size = 1024
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$red = [System.Drawing.Color]::FromArgb(255, 230, 74, 71)
$bg = New-Object System.Drawing.SolidBrush($red)
$r = 220; $x = 64; $y = 64; $w = $size - 128; $h = $size - 128
$p = New-Object System.Drawing.Drawing2D.GraphicsPath
$p.AddArc($x, $y, $r, $r, 180, 90)
$p.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
$p.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
$p.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
$p.CloseFigure()
$g.FillPath($bg, $p)
$white = [System.Drawing.Color]::White
$ring = New-Object System.Drawing.Pen($white, 56)
$g.DrawEllipse($ring, 272, 272, 480, 480)
$hands = New-Object System.Drawing.Pen($white, 44)
$hands.StartCap = 'Round'; $hands.EndCap = 'Round'
$g.DrawLine($hands, 512, 512, 512, 330)
$g.DrawLine($hands, 512, 512, 648, 588)
$dir = 'build'; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$bmp.Save("$dir\icon.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
```

- [ ] **Step 3: 验证**

```powershell
$img = [System.Drawing.Image]::FromFile('build\icon.png'); "$($img.Width)x$($img.Height)"; $img.Dispose()
```
Expected: `1024x1024`

### Task 2: 配置 package.json 打包参数

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1 的 `build/icon.png` 与已安装的 electron-builder
- Produces: npm script `dist:win`；`build` 字段供 CLI 与 CI 使用

- [ ] **Step 1: 加入 scripts / author / build 字段**

在 package.json 中新增（保持既有字段不动）：

```json
"author": "Yifan",
"scripts": {
  "start": "electron .",
  "dist:win": "electron-builder --win"
},
"build": {
  "appId": "com.yifan.deadlinelist",
  "productName": "deadline清单",
  "directories": { "output": "dist" },
  "files": ["main.js", "preload.js", "renderer/**/*", "package.json"],
  "win": {
    "icon": "build/icon.png",
    "target": [
      { "target": "nsis", "arch": ["x64", "ia32", "arm64"] },
      { "target": "zip", "arch": ["x64", "ia32", "arm64"] }
    ]
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "artifactName": "deadline清单-Setup-${version}-${arch}.${ext}"
  },
  "mac": {
    "icon": "build/icon.png",
    "category": "public.app-category.productivity",
    "target": [{ "target": "dmg", "arch": ["x64", "arm64"] }]
  },
  "linux": {
    "icon": "build/icon.png",
    "category": "Utility",
    "target": [{ "target": "AppImage", "arch": ["x64", "arm64"] }],
    "artifactName": "deadline清单-${version}-${arch}.${ext}"
  }
}
```

- [ ] **Step 2: 验证 JSON 合法**

```powershell
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('ok')"
```
Expected: `ok`

### Task 3: 本地打包 Windows x64 并冒烟测试

**Files:**
- Create（构建产物，不入库）: `dist/win-unpacked/deadline清单.exe`、`dist/*.exe`、`dist/*.zip`

**Interfaces:**
- Consumes: Task 2 的配置与 `npm run dist:win`

- [ ] **Step 1: 构建 x64**

```powershell
npx electron-builder --win --x64
```
超时 15 分钟。Expected: `building` 日志结束无 error，`dist/win-unpacked/` 存在。
（CLI 显式 `--x64` 会覆盖 arch 列表只出 x64，正好符合“本地最小验证”约束）

- [ ] **Step 2: 检查产物存在**

```powershell
Get-ChildItem dist | Select-Object Name, Length
```
Expected: 含 `win-unpacked` 目录、`deadline清单 Setup 1.0.2.exe` 或按 artifactName 命名的安装包、zip 文件

- [ ] **Step 3: 冒烟运行未打包目录版**

```powershell
$p = Start-Process -FilePath 'dist\win-unpacked\deadline清单.exe' -PassThru
Start-Sleep -Seconds 6
if ($p.HasExited) { 'FAILED: exited' } else { ('OK PID ' + $p.Id); Stop-Process -Id $p.Id -Force }
```
Expected: `OK PID …`（打包版与开发态共用 %APPDATA%\deadline清单 数据）

### Task 4: 创建 GitHub Actions 工作流

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: Task 2 的 package.json build 配置（CI 直接跑 electron-builder）
- Produces: tag `v*` 推送时的三平台 Release 产物

- [ ] **Step 1: 写入工作流文件**

```yaml
name: Build & Release

on:
  push:
    tags: ['v*']
  workflow_dispatch:

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            cmd: npx electron-builder --win --x64 --ia32 --arm64
          - os: macos-latest
            cmd: npx electron-builder --mac --x64 --arm64
          - os: ubuntu-latest
            cmd: npx electron-builder --linux --x64 --arm64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: ${{ matrix.cmd }}
      - uses: actions/upload-artifact@v4
        with:
          name: dist-${{ matrix.os }}
          path: |
            dist/*.exe
            dist/*.zip
            dist/*.dmg
            dist/*.AppImage
          if-no-files-found: error

  release:
    if: startsWith(github.ref, 'refs/tags/v')
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with:
          merge-multiple: true
          path: dist
      - uses: softprops/action-gh-release@v2
        with:
          files: dist/*
          draft: true
```

- [ ] **Step 2: 人工复核字段**

本地无 actionlint 时逐项核对：matrix.os 引用、needs/permissions、glob 后缀齐全。

### Task 5: .gitignore 与最终检查

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 确保 ignore 规则**

确认含以下三行，缺则补：
```
node_modules/
dist/
build/icon.png
```
（icon.png 由脚本生成，避免二进制入库；如后续想固定品牌图可再改为提交）

- [ ] **Step 2: 全量语法检查**

```powershell
node --check main.js; node --check preload.js; node --check renderer/panel.js
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"
git status --short
```
Expected: 无输出错误；git status 仅列预期改动文件

- [ ] **Step 3: 整理 GitHub 发布教学步骤**

输出中文分步教学：注册/登录 GitHub → 网页建空公开仓库 deadline-list（不勾 README）→ `git remote add origin https://github.com/<用户名>/deadline-list.git` → `git branch -M main` → 首次 add/commit/push（逐条命令+解释每条含义）→ 发版 `git tag v1.0.2 && git push origin v1.0.2` → 到 Actions 页看构建 → Releases 页下载验证。注明 macOS dmg 未签名需右键打开。
