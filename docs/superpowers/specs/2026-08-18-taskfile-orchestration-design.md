# Taskfile 统一编排与依赖引导设计

## 状态

- 日期：2026-08-18
- 状态：设计已由用户确认，等待规范审查
- 适用范围：本地开发、PR CI、Electron/Server/Docker/Docs 构建与发布流程

## 背景

当前仓库同时使用根目录 pnpm 脚本、Turborepo、应用级脚本和 GitHub Actions 编排任务。它们之间没有统一的依赖图：`pnpm dev:all` 会构建并启动应用，但不会确保 `.deps` 中的媒体工具存在。

本次故障中，Bilibili 嗅探成功后创建了有效的数字任务 ID，但任务实际失败原因为 `.deps/<platform>/BBDown` 不存在。现有媒体集成测试只准备 aria2、N_m3u8DL-RE 和 FFmpeg，浏览器扩展 E2E 又只覆盖直接 MP4，因此自动化测试没有覆盖“Bilibili 嗅探 → 创建任务 → BBDown 执行”这条真实路径。页面随后出现的 `invalid id` 不是日志中记录的根本故障；ID 解析错误和外部依赖错误也需要在接口与页面上保持可区分。

仓库已经具备固定版本依赖清单 `scripts/deps-versions.json` 和增量下载脚本 `scripts/download-deps.ts`。本设计在其上增加统一编排层，不引入自动升级机制。

## 目标

1. 在根目录增加 `Taskfile.yml`，作为团队和流水线唯一推荐的仓库编排入口。
2. 让每个公开任务声明准确的 Node、Go、媒体二进制和构建前置关系。
3. `task dev:all` 在启动任何服务前自动确保完整当前平台运行时工具组存在，包括 BBDown。
4. 依赖版本严格来自 `scripts/deps-versions.json`；任务不得查询最新版本或改写该文件。
5. 用 `MEDIAGO_PROFILE` 统一选择环境配置，同时保留应用现有 `dotenv-flow` 作为直接运行底层命令时的兼容兜底。
6. 一次迁移本地文档、PR CI、Electron/Server/Docker/Docs 构建和发布流程。
7. 增加 Bilibili 下载链路回归测试，使缺少 BBDown、任务 ID 混用和错误映射能够在 CI 中被发现。
8. 将 Task CLI 固定为 `v3.51.1`，不在仓库内维护自动下载 Task 的 bootstrap/wrapper。

## 非目标

- 不把 Turbo、pnpm、Go、Docker 或 GitHub Actions 的能力重新实现一遍。
- 不删除各 workspace 中现有的底层 pnpm 脚本。
- 不将 GitHub 矩阵、缓存、签名、密钥、制品上传或 Release/Docker Actions 搬入 Taskfile。
- 不依赖真实 Bilibili 页面、账号或公网媒体完成自动化测试。
- 不自动升级 Task CLI 或任何媒体工具版本。

## 方案选择

### 采用：Taskfile 作为薄编排层

Taskfile 负责公开命令、依赖图、环境配置、前置检查和错误边界；具体工作继续委托给现有 pnpm、Turbo、Go、Docker 和应用脚本。这让本地与 CI 使用同一入口，同时避免复制已经稳定的命令。

### 未采用：将全部 pnpm 脚本重写进 Taskfile

这种方式表面上更集中，但会复制跨平台命令、Turbo filter 和 workspace 细节，迁移风险与维护成本都更高。

### 未采用：增加 Node 编排程序，Taskfile 仅做代理

自研编排层更容易做复杂逻辑测试，但当前需求可由 Task 依赖图与现有 TypeScript 下载脚本完成，多一层运行时没有必要。

## 总体架构

根目录 `Taskfile.yml` 是仓库编排 API。调用关系必须保持单向：

```text
README / 开发者 / GitHub Actions
                 |
                 v
          Taskfile 公开任务
                 |
                 v
       pnpm / Turbo / Go / Docker 叶子命令
```

Taskfile 不调用任何会再次进入同一 Task 任务的 pnpm 脚本。若需要保留历史高层 pnpm 命令，则将其改成 Task 的兼容包装器，并把实际实现留在明确命名的叶子脚本中；Task 只调用叶子脚本或 workspace 脚本。契约测试负责阻止 `Task → pnpm → Task` 环路。

Taskfile 保持为单个根文件。环境文件在根任务中加载，不引入多层 Taskfile include，也不把应用配置散落到各工作流。

## 任务接口

公开任务使用带命名空间的稳定名称，并包含 `desc` 以便 `task --list` 自描述。

| 任务                                           | 职责                                                         | 主要前置任务                     |
| ---------------------------------------------- | ------------------------------------------------------------ | -------------------------------- |
| `task doctor`                                  | 检查 Task、Node、pnpm、Go 及所需工具；只报告环境变量是否存在 | 无                               |
| `task setup`                                   | 初始化 Node workspace 并准备当前平台完整运行时工具           | `deps:node`、`deps:runtime`      |
| `task deps:node`                               | 根据 lockfile 增量执行 frozen pnpm 安装                      | 无                               |
| `task deps:runtime`                            | 准备当前平台所有应用运行时工具                               | `deps:node`                      |
| `task deps:media-integration`                  | 准备媒体集成测试所需工具                                     | `deps:node`                      |
| `task deps:e2e`                                | 准备 E2E 所需工具                                            | `deps:node`                      |
| `task dev:all`                                 | 启动完整桌面与 Web 开发环境                                  | `deps:node`、`deps:runtime`      |
| `task dev:web` / `dev:electron` / `dev:server` | 启动指定开发面                                               | 各自所需依赖                     |
| `task check`                                   | 执行 lint、格式检查和类型检查                                | `deps:node`                      |
| `task test`                                    | 执行默认 TypeScript 与 Go 测试                               | 相应语言依赖                     |
| `task test:integration`                        | 执行媒体集成测试                                             | `deps:media-integration`         |
| `task test:e2e`                                | 构建并执行 Playwright 项目                                   | `deps:e2e`、浏览器准备、构建任务 |
| `task build:*`                                 | 构建 Web、Electron、Server、Docker、Docs 或 Extension        | 每个产物的精确依赖               |
| `task ci:*`                                    | 为各 CI job 提供稳定仓库命令                                 | 对应 check/test/build 任务       |
| `task release:*`                               | 生成相应发布产物                                             | 对应 production build/pack 任务  |

`task setup` 适合首次克隆；所有开发和构建任务仍必须声明自己的真实前置关系，不能要求开发者记住先手动执行 setup。特别是空 `.deps` 或只缺 BBDown 时，`task dev:all` 都必须自行恢复到可运行状态。

`deps:node` 使用 lockfile 和 workspace manifests 作为输入，通过 Task 的状态机制避免无变化时重复安装。依赖准备允许并行的部分由 Task 依赖图调度；持久化开发进程仅在所有前置任务成功后启动。

## 固定版本二进制依赖

`deps:runtime` 调用 `scripts/download-deps.ts` 并传入显式运行时工具集合。该集合至少覆盖运行时能够解析或打包的 FFmpeg、N_m3u8DL-RE、BBDown、aria2、yt-dlp 和 mediago 工具；最终列表以运行时代码和 `scripts/deps-versions.json` 的契约测试为准。

下载规则如下：

1. 版本、Release asset、目标文件名和 SHA-256 只从 `scripts/deps-versions.json` 读取。
2. 本地状态记录、固定版本、asset、文件名及完整性均匹配时跳过下载。
3. 文件缺失、不可执行、状态过期或完整性不匹配时，只修复受影响工具。
4. 不调用 GitHub “latest release” API，不写回版本清单。
5. 下载、解压和重命名必须保持原子性；失败不得留下被识别为有效的半成品。
6. 下载错误必须包含工具名、固定版本、平台、预期路径和可执行的重试命令，并以非零状态退出。

下载脚本需要支持通过 `MEDIAGO_DEPS_DIR` 指定输出根目录，默认仍为仓库 `.deps`。运行时二进制解析器、Taskfile 和测试使用同一变量，这既避免路径分叉，也允许测试在隔离临时目录中运行。

## 环境变量模型

使用 `MEDIAGO_PROFILE` 选择 `development`、`test` 或 `production` 配置。开发、测试和生产任务提供对应默认值，调用者可以显式覆盖。

通过 Task 启动时的优先级为：

1. 调用进程或 CI 已注入的环境变量
2. `.env.<profile>.local`
3. `.env.local`
4. `.env.<profile>`
5. `.env`

同一变量在多个 dotenv 文件出现时，前面的文件优先。项目不启用 Task 的实验性 env precedence 功能，因此 OS/CI 注入值保持最高优先级。`.env.local` 和 `.env.*.local` 必须被 gitignore；仓库环境文件只能承载非敏感默认值。

Task 注入的进程环境是规范路径。应用已有 `dotenv-flow` 继续保留：经 Task 启动时，它只会补足未设置值；直接执行 workspace 叶子命令时，它仍提供现有兼容行为。构建模式仍由现有 `cross-env` 叶子脚本或等价的显式命令设置，避免开发者 shell 中残留的 `NODE_ENV` 改变产物。

实现时审计 `turbo.json`，将影响缓存或需要传递的 `APP_TARGET`、`NODE_ENV`、`MEDIAGO_PROFILE`、`MEDIAGO_DEPS_DIR`、`MEDIAGO_CORE_BIN` 和 `OPEN_DEVTOOLS` 放入正确的 `env`、`globalEnv` 或 `passThroughEnv` 分类。诊断和日志不得打印密钥值；需要校验的敏感变量只显示“已设置/未设置”。

## Task CLI 版本

- 团队本地明确要求 Task `v3.51.1`。
- README 为 macOS、Linux 和 Windows 提供安装或版本切换说明，但仓库不自动下载 Task。
- `task doctor` 校验精确版本并给出修复提示。
- 所有 GitHub Actions job 使用官方 setup action 安装 Task `v3.51.1`。
- 契约测试校验 Taskfile 所需版本、工作流安装版本和文档声明一致，防止静默漂移。

## GitHub Actions 迁移

迁移 `.github/workflows/ci.yml`、`build-electron.yml`、`build-server.yml`、`build-docs.yml` 和 `release.yml`，以及它们调用的仓库内构建入口。

每个需要仓库命令的 job 先安装固定 Task CLI，再调用与职责对应的 `task ci:*`、`task build:*` 或 `task release:*`。Node、pnpm、Go、Java、Docker Buildx 等 runner 工具的安装仍由对应 setup action 完成；GitHub 缓存、矩阵、permissions、secrets、签名、artifact、reusable workflow 和 release orchestration 仍保留在 YAML。

迁移原则是“仓库行为交给 Task，平台行为留给 Actions”。例如 Electron 的 core/UI 构建与打包由 Task 调用，代码签名密钥注入和制品上传仍由 workflow 负责；Docker 构建准备由 Task 完成，`docker/build-push-action` 仍负责多架构构建与推送。

Docs、Go-only 等 job 不得因为统一入口而下载无关媒体工具。各 CI task 依赖最小化，既验证依赖图又避免显著增加执行时间。

## 文档迁移

根目录 `README.md` 及所有已有语言版本、`CONTRIBUTING.md` 和直接描述仓库启动流程的文档统一改为 Task 命令。推荐路径为：

```text
task setup
task dev:all
```

文档同时给出 `task dev:web`、`task dev:electron`、`task dev:server`、`task check`、`task test` 和主要构建命令。`pnpm dev:all` 不再作为推荐启动方式。历史高层 pnpm 命令若保留，只作为兼容入口，并在不形成调用环的前提下转入对应 Task 任务。

## Bilibili 下载与错误边界

Bilibili 回归链路包含三个独立契约：

1. **捕获契约**：扩展把 Bilibili 页面来源识别为需要 BBDown 的媒体任务，不能把媒体 ID 当作数据库任务 ID。
2. **任务契约**：创建接口返回数字任务 ID；后续下载、查询和日志接口只能使用该 ID，前端不得发送 `undefined`、空字符串或来源媒体 ID。
3. **执行契约**：core 从统一依赖目录解析 BBDown，并使用捕获来源组装参数。二进制缺失返回明确的依赖错误，不得转换为 `invalid id`。

`invalid id` 仅用于 API path 参数不能解析为合法数字的场景。任务不存在使用 task-not-found；依赖缺失使用稳定的 dependency-missing 错误码和包含工具名的用户消息。即便有人绕过 Task 直接启动应用或运行时文件被删除，页面也应展示真实问题。

## 错误处理

- Task 版本不匹配时，公开入口在执行仓库工作前失败并给出安装提示。
- 不支持的平台或架构在依赖准备阶段失败，不能进入部分启动状态。
- Node 安装、工具下载、完整性验证、build 或 test 任一前置失败时，下游任务不运行。
- 多进程开发任务沿用 fail-fast 行为；任一关键服务退出时终止其余协同进程。
- production/release 任务对必要环境变量使用显式前置校验，但不回显内容。
- `task doctor` 汇总所有可诊断问题并返回非零状态，便于本地和 CI 使用。

## 测试设计

### Taskfile 契约测试

- `task --list-all` 能解析根 Taskfile，所有公开任务都有描述。
- 关键任务存在且依赖图符合本设计，尤其 `dev:all → deps:runtime → deps:node`。
- Task 不调用会回到自身的历史 pnpm 包装脚本。
- 环境文件优先级、允许的 profile 和敏感值不输出规则有测试覆盖。
- 工作流、Taskfile 和文档声明的 Task 版本均为 `3.51.1`。

### 二进制依赖测试

- 运行时代码引用的外部工具必须存在于 `scripts/deps-versions.json`，并归属至少一个正确的 Task 依赖组。
- 在临时 `MEDIAGO_DEPS_DIR` 中模拟缺失、版本过期、哈希错误和完整状态，分别验证下载、替换、拒绝与跳过行为。
- 固定 BBDown `1.6.3` 的测试断言来自版本清单，不把版本复制成第二个可漂移的实现常量。
- 支持平台的 CI smoke job 下载任务所需固定工具并验证可执行性。

### Bilibili 回归测试

- 扩展 E2E 使用本地页面或捕获 fixture 生成 Bilibili 来源，点击下载后断言创建接口及所有后续请求使用有效数字任务 ID。
- core 集成测试通过临时依赖目录放置伪 BBDown，记录 argv 并返回固定输出，验证 Bilibili 任务确实解析和执行 BBDown。
- 删除伪 BBDown 后，断言返回 dependency-missing 而不是 `invalid id`。
- 测试不访问真实 Bilibili，也不依赖 Cookie、登录状态或上游页面结构。

### 迁移验证

- 执行 `task check`、`task test`、媒体集成测试和 E2E。
- 在适用 runner 上验证 Electron、Server、Docker 和 Docs 代表性构建任务。
- 静态审查所有 workflow：仓库级 install/check/test/build/package 命令通过 Task 入口；GitHub 平台 action 不受限制。
- 从空 `.deps` 启动 `task dev:all`，确认所有前置完成后才出现可交互页面，并验证 BBDown 存在且可执行。

## 验收标准

1. 安装 Task `v3.51.1` 后，在没有 `node_modules` 和 `.deps` 的新克隆中运行 `task dev:all`，能够自动准备依赖并启动完整开发环境。
2. 只删除 BBDown 后再次运行 `task dev:all`，系统只修复必要依赖并在启动前通过校验。
3. Task 与流水线不会修改 `scripts/deps-versions.json`，也不会选择任何未固定版本。
4. CI 注入变量优先于仓库 dotenv 文件，本地覆盖文件不进入 git，日志不泄露敏感值。
5. CI、所有构建/发布工作流和启动文档使用 Taskfile 公开入口。
6. Bilibili fixture 的捕获、任务创建、数字 ID 传递和伪 BBDown 执行链路通过自动化测试。
7. BBDown 缺失时错误信息明确指向依赖，`invalid id` 只在真实非法 ID 输入时出现。
8. 不需要媒体工具的 Docs 或 Go-only job 不下载完整运行时依赖。

## 实施边界与顺序约束

后续实施计划应按“契约测试与叶子命令整理 → Taskfile 与依赖/环境支持 → 本地命令和文档 → CI/构建/发布迁移 → Bilibili 回归与全量验证”的顺序拆分。每一步都必须保持主分支可验证，不能在 Taskfile 未具备等价能力时先删除旧入口。
