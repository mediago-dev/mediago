# MediaGo Core

> 多任务下载系统 - Go (Gin) 实现

## 🚀 快速导航

### 📖 核心文档

- **[快速开始（5 分钟）](QUICKSTART.md)** - 新手必读
- **[完整使用文档](README_core.md)** - API 与配置详解
- **[最终交付总结](FINAL_SUMMARY.md)** - 项目概览

### 🔧 技术文档

- **[实现总结](IMPLEMENTATION_SUMMARY.md)** - 技术细节与核心特性
- **[项目结构](PROJECT_STRUCTURE.md)** - 架构与模块关系
- **[交付清单](DELIVERY_CHECKLIST.md)** - 验收标准

---

## ⚡ 快速开始

### 使用仓库 Task（推荐）

请从仓库根目录执行以下命令。仓库要求固定版本 Task v3.51.1；安装方法见
[CONTRIBUTING.md](../../CONTRIBUTING.md)，开始前请先运行 `task --version` 验证版本。

```bash
# 安装 Node 与运行时依赖
task setup

# 启动包含 Core 的 Web 开发环境
task dev:web

# 提交前检查与测试
task check
task test
```

### 传统方式

```bash
# 安装依赖
go mod tidy

# 运行服务
go run ./cmd/server
```

### Docker 部署

```bash
# Docker Compose
docker-compose up -d
```

---

## 🎯 核心特性

- ✅ **JSON 配置**（从 YAML 迁移）
- ✅ **进度节流**（200ms + 0.5%）
- ✅ **并发控制**（动态调整）
- ✅ **事件驱动**（SSE 实时推送）
- ✅ **Swagger 文档**（完整的 API 文档）
- ✅ **Gulp 构建系统**（模块化 TypeScript 任务）
- ✅ **Docker 支持**（一键部署）

---

## 📖 API 文档

项目集成了 **Swagger API 文档**，提供了完整的接口说明和在线测试功能。

### 访问 Swagger UI

```bash
# 1. 启动服务
gulp dev

# 2. 访问 Swagger UI
# http://localhost:8080/swagger/index.html
```

### 生成 Swagger 文档

```bash
# 安装 swag 工具
gulp devTools

# 生成文档
gulp devSwagger

# 或手动生成
swag init -g cmd/server/main.go -o docs --parseDependency --parseInternal
```

### API 端点列表

- `POST /api/tasks` - 创建下载任务
- `POST /api/tasks/:id/stop` - 停止任务
- `POST /api/config` - 更新配置
- `GET /api/events` - SSE 事件流
- `GET /swagger/*any` - Swagger UI

---

## 📦 支持的下载类型

1. **M3U8** - HLS 流媒体下载
2. **Bilibili** - B站视频下载
3. **Direct** - 直接文件下载（aria2c）

---

## 🛠️ 可用命令

### 开发任务

```bash
task dev:web                # 从仓库根目录启动 Web/Core 开发环境
task build:server           # 构建 Core 与自托管 Web 服务
```

### NPM 包构建

```bash
pnpm run build:core         # 构建 Core NPM 包（包含所有平台二进制）
pnpm run build:deps         # 构建 Deps NPM 包（包含依赖工具）
pnpm run npm:build          # 构建所有 NPM 包（Core + Deps）

# 别名（更明确的命名）
pnpm run npm:build:core     # 同 build:core
pnpm run npm:build:deps     # 同 build:deps
```

### NPM 包发布

```bash
pnpm run npm:publish        # 发布所有 NPM 包
pnpm run npm:publish:core   # 仅发布 Core NPM 包
pnpm run npm:publish:deps   # 仅发布 Deps NPM 包
```

### 帮助命令

```bash
pnpm run help               # 显示所有可用的 Gulp 任务和说明
pnpm run tasks              # 显示 Gulp 任务树（技术视图）
```

---

## 📦 发布指南

### 1. 开发阶段

```bash
# 启动开发服务器
task dev:web

# 快速编译当前平台
task build:server
```

### 2. 构建 NPM 包

`pnpm run npm:build` 会执行以下步骤：

1. 清理旧的构建产物
2. 构建所有平台的二进制文件
3. 生成 NPM 包的 package.json、README 和 install.js
4. 复制二进制文件和依赖工具到对应的包目录

构建完成后，NPM 包文件位于 `./npm/@mediago/`。

#### 指定版本号

版本号获取优先级：**环境变量 VERSION > Git Tag > 'dev'**

```bash
# 方法 1: 使用环境变量（推荐）
VERSION=1.2.3 pnpm run npm:build

# 方法 2: 使用 Git Tag
git tag v1.2.3
pnpm run npm:build  # 会自动使用 v1.2.3

# 方法 3: 分别指定 Core 和 Deps 版本
CORE_VERSION=1.2.3 DEPS_VERSION=1.0.0 pnpm run npm:build
```

#### 单独构建 Core 或 Deps

```bash
# 只构建 Core 包
VERSION=1.2.3 pnpm run build:core

# 只构建 Deps 包
VERSION=1.0.0 pnpm run build:deps
```

### 3. 发布到 NPM

> 发布前请先执行 `pnpm run npm:build` 确保包已准备好，并且已经完成 `npm login`。

```bash
# 发布所有 NPM 包（Core + Deps）
pnpm run npm:publish

# 仅发布 Core 包
pnpm run npm:publish:core

# 仅发布 Deps 包
pnpm run npm:publish:deps
```

#### NPM 包结构

生成的 NPM 包：

- `@mediago/core` - 主包（根据平台自动安装对应的二进制包）
- `@mediago/core-darwin-x64` - macOS x64 二进制
- `@mediago/core-darwin-arm64` - macOS ARM64 二进制
- `@mediago/core-linux-x64` - Linux x64 二进制
- `@mediago/core-linux-arm64` - Linux ARM64 二进制
- `@mediago/core-win32-x64` - Windows x64 二进制
- `@mediago/core-win32-arm64` - Windows ARM64 二进制
- `@mediago/deps` - 依赖工具主包
- `@mediago/deps-*` - 各平台的依赖工具包

**详细说明**: 查看 [版本号管理指南](docs/VERSION_GUIDE.md)

---

## 📦 发布包的使用

### Windows

1. 解压 zip 文件
2. 双击运行 `mediago-core.exe`

### Linux/macOS

1. 解压 zip 文件
2. 在终端中运行：
   ```bash
   cd mediago-core-xxx
   chmod +x mediago-core
   ./start.sh
   ```

### NPM 安装

```bash
npm install @mediago/core
# or
pnpm add @mediago/core
# or
yarn add @mediago/core

# 运行
npx @mediago/core
```

---

## 🔧 环境变量说明

发布包中的程序会自动使用相对路径查找下载器工具：

- `./bin/N_m3u8DL-RE` (或 `.exe`)
- `./bin/BBDown` (或 `.exe`)
- `./bin/aria2c` (或 `.exe`)

用户无需配置任何环境变量即可运行！

可选的环境变量：

- `MEDIAGO_M3U8_BIN` - M3U8 下载器路径
- `MEDIAGO_BILIBILI_BIN` - Bilibili 下载器路径
- `MEDIAGO_DIRECT_BIN` - 直接下载器路径
- `MEDIAGO_LOG_LEVEL` - 日志级别 (debug/info/warn/error)
- `MEDIAGO_LOG_DIR` - 日志目录路径
- `MEDIAGO_SERVER_ADDR` - 服务器监听地址 (默认 :8080)

---

## 🏗️ 项目架构

### 目录结构

```
mediago-core/
├── cmd/
│   └── server/           # 主程序入口
├── internal/             # 内部包
│   ├── api/             # API 路由和处理器
│   ├── config/          # 配置管理
│   ├── download/        # 下载器实现
│   ├── events/          # 事件系统
│   └── task/            # 任务管理
├── configs/             # 配置文件
├── scripts/             # 构建脚本 (TypeScript)
│   ├── config.ts        # 配置常量和平台定义
│   ├── utils.ts         # 工具函数（文件操作、模板渲染等）
│   ├── dev.ts           # 开发任务
│   ├── release.ts       # 发布构建（完整发布包）
│   └── npm.ts           # NPM 包管理（元数据生成 + 组装 + 发布）
├── templates/           # NPM 包模板文件
│   ├── *.json.tpl       # package.json 模板
│   ├── *.md.tpl         # README.md 模板
│   └── *.js.tpl         # install.js 模板
├── gulpfile.ts          # Gulp 主入口
├── .bin/                # 下载器工具（按平台）
├── bin/                 # 编译产物（二进制文件）
├── npm/                 # NPM 包构建输出
│   └── @mediago/        # NPM scope
│       ├── core/        # Core 主包
│       ├── core-*/      # 各平台 Core 包
│       ├── deps/        # Deps 主包
│       └── deps-*/      # 各平台 Deps 包
└── release/             # 完整发布包
```

### 构建脚本架构

所有构建脚本都使用 TypeScript 编写，职责清晰：

- **config.ts** - 配置变量、常量和平台定义
- **utils.ts** - 通用工具函数（文件操作、命令执行、模板渲染等）
- **dev.ts** - 开发环境任务（开发服务器、快速编译）
- **release.ts** - 发布构建任务（构建二进制、打包完整发布包）
- **npm.ts** - NPM 包完整流程（元数据生成、组装、发布）

---

## 📚 完整文档列表

| 文档                                                   | 说明                 | 适合人群   |
| ------------------------------------------------------ | -------------------- | ---------- |
| [QUICKSTART.md](QUICKSTART.md)                         | 5 分钟快速启动       | 所有人     |
| [docs/VERSION_GUIDE.md](docs/VERSION_GUIDE.md)         | 版本号管理指南       | 发布者     |
| [SWAGGER_GUIDE.md](SWAGGER_GUIDE.md)                   | Swagger API 文档指南 | API 开发者 |
| [README_core.md](README_core.md)                       | 完整使用文档         | API 使用者 |
| [FINAL_SUMMARY.md](FINAL_SUMMARY.md)                   | 最终交付总结         | 项目经理   |
| [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) | 实现总结             | 架构师     |
| [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)           | 项目结构             | 维护者     |
| [DELIVERY_CHECKLIST.md](DELIVERY_CHECKLIST.md)         | 交付清单             | QA 测试    |

---

## 🎉 项目状态

**✅ 已完成，可直接运行**

- 代码：~700 行（8+ 个 Go 文件）
- 文档：~70 KB（7+ 份文档）
- 构建任务：30+ 个 Gulp 任务
- API 文档：完整 Swagger 支持
- 测试：完整客户端页面
- 脚本：模块化 TypeScript

---

## ❓ 常见问题

### Q: 如何只打包特定平台？

A: 可以修改 `scripts/config.ts` 中的 `BUILD_PLATFORMS` 数组，注释掉不需要的平台。

### Q: 下载器工具从哪里来？

A: 从项目根目录的 `.bin/<platform>/<arch>/` 目录复制。确保这些文件存在且可执行。

### Q: 如何添加新的下载器工具？

A: 将工具放入 `.bin/<platform>/<arch>/` 目录，它会自动被复制到发布包中。

### Q: 为什么使用 pnpm 而不是 npm？

A: pnpm 更快、更节省磁盘空间。当然你也可以使用 npm 或 yarn，只需将 `pnpm` 替换即可。

### Q: 如何自定义构建流程？

A: 编辑 `scripts/` 目录下的 TypeScript 文件。所有任务都是模块化的，职责清晰，易于修改和扩展。

### Q: Core 和 Deps 包有什么区别？

A:

- **Core 包**：包含 mediago-core 的二进制文件和配置
- **Deps 包**：包含依赖的下载工具（N_m3u8DL-RE、BBDown、aria2c、yt-dlp）
- 分开发布可以单独更新，减少不必要的下载

---

## 📞 获取帮助

有问题？查看文档：

1. **新手入门** → [QUICKSTART.md](QUICKSTART.md)
2. **API 文档** → [SWAGGER_GUIDE.md](SWAGGER_GUIDE.md) 或访问 http://localhost:8080/swagger/index.html
3. **API 调用** → [README_core.md](README_core.md)
4. **故障排查** → [README_core.md#故障排查](README_core.md#故障排查)

---

**版本：** v1.0.0
**最后更新：** 2025-01-24
**构建工具：** Gulp + TypeScript
