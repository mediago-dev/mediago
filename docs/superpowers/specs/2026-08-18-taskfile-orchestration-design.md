# Taskfile 统一编排与依赖引导设计

## 状态

- 日期：2026-08-18
- 状态：设计已由用户确认；独立规范审查通过
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

除汇总诊断的 `doctor` 外，每个公开任务都是一个顺序包装器：先调用内部 `internal:require-task-version`，成功后再调用不可从 CLI 直接执行的 `internal:*` 实现任务。实现任务才声明可并行的依赖图。这样版本检查不会与 Node 安装、下载或构建并行开始。

## 任务接口

公开任务使用带命名空间的稳定名称，并包含 `desc` 以便 `task --list` 自描述。下表是规范性映射；实施不得用未列出的高层 pnpm 命令替代“叶子命令”。

### 本地开发、检查和构建

| 公开 Task                | 默认 profile  | 精确依赖组                                                | 允许的叶子命令或内部任务                                                                                                      | 历史入口处置                                                                                     |
| ------------------------ | ------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `doctor`                 | 不加载 dotenv | 无                                                        | Task 内建检查；Node/pnpm/Go/工具版本探测                                                                                      | 新任务                                                                                           |
| `setup`                  | `development` | `node`、`runtime-current`                                 | 仅依赖聚合                                                                                                                    | 新任务                                                                                           |
| `deps:node`              | 不加载 dotenv | 无                                                        | `pnpm install --frozen-lockfile`                                                                                              | `pnpm install` 仍是包管理器叶子命令                                                              |
| `deps:runtime`           | 不加载 dotenv | `node`                                                    | `pnpm deps:download:raw --tools ffmpeg,N_m3u8DL-RE,BBDown,aria2,yt-dlp,mediago`                                               | `pnpm deps:download` 改为兼容包装器；新增 `deps:download:raw` 叶子脚本                           |
| `deps:media-integration` | `test`        | `node`                                                    | 下载 aria2、N_m3u8DL-RE、FFmpeg、BBDown                                                                                       | 现有 setup 脚本改为叶子或 Task 包装器                                                            |
| `deps:e2e`               | `test`        | `node`                                                    | 下载 aria2；Playwright 浏览器准备由 `test:e2e` 管理                                                                           | 现有 setup 脚本改为叶子或 Task 包装器                                                            |
| `dev:all`                | `development` | `node`、`runtime-current`、`core-build`、`build:electron` | `pnpm dev:all:raw`，只包含当前三进程 fail-fast 命令                                                                           | `pnpm dev:all` → `task dev:all`                                                                  |
| `dev:web`                | `development` | `node`、`runtime-current`、`core-build`                   | `pnpm dev:web:raw`：`@mediago/server` 与 server-target `@mediago/ui`                                                          | `dev:server` 是同一 Task 的别名；`pnpm dev:server` → `task dev:web`                              |
| `dev:electron`           | `development` | `node`、`runtime-current`、`core-build`、`build:electron` | `pnpm start:electron`，启动 Electron 与 electron-target UI watch                                                              | `pnpm dev:electron` → `task dev:electron`                                                        |
| `dev:extension`          | `development` | `node`                                                    | `pnpm -F @mediago/extension run dev`                                                                                          | `pnpm dev:extension` → `task dev:extension`                                                      |
| `docs:dev`               | `development` | `node`                                                    | `pnpm -F @mediago/docs run docs:dev`                                                                                          | `pnpm docs:dev` → `task docs:dev`                                                                |
| `check`                  | `test`        | `node`                                                    | `pnpm lint`、`pnpm format:check`、`pnpm type:check`                                                                           | `pnpm check` → `task check`                                                                      |
| `test`                   | `test`        | `node`                                                    | `test:ts`、`test:go`                                                                                                          | `pnpm test` → `task test`                                                                        |
| `test:ts`                | `test`        | `node`                                                    | `pnpm exec vitest run`                                                                                                        | `pnpm test:ts` 保留为叶子                                                                        |
| `test:go`                | `test`        | 无                                                        | `go test ./...`，工作目录 `apps/core`                                                                                         | `pnpm test:go` 可保留为兼容叶子                                                                  |
| `test:integration`       | `test`        | `media-integration`                                       | `pnpm exec vitest run --config vitest.integration.config.ts`                                                                  | `pnpm test:integration*` → 对应 Task 或 `*:raw`                                                  |
| `test:e2e`               | `test`        | `e2e`、`core-build`、`e2e-build`、Playwright Chromium     | `pnpm exec playwright test`                                                                                                   | `pnpm test:e2e` → `task test:e2e`；project 子命令映射到 `task test:e2e:{web,electron,extension}` |
| `build:web`              | `production`  | `node`                                                    | `cross-env APP_TARGET=server NODE_ENV=production turbo run build -F @mediago/ui`                                              | `pnpm build:web` → `task build:web`，实现移至 `build:web:raw`                                    |
| `build:server`           | `production`  | `node`、`core-build`                                      | `cross-env APP_TARGET=server NODE_ENV=production turbo run build -F @mediago/server -F @mediago/ui`                           | 新的明确 Server 产物入口                                                                         |
| `build:electron`         | `production`  | `node`、`core-build`                                      | `cross-env APP_TARGET=electron NODE_ENV=production turbo run build -F @mediago/electron -F @mediago/ui -F @mediago/extension` | `pnpm build:electron` → `task build:electron`，实现移至 `build:electron:raw`                     |
| `build:extension`        | `production`  | `node`                                                    | `pnpm -F @mediago/extension run build`                                                                                        | `pnpm build:extension` → `task build:extension`                                                  |
| `build:docs`             | `production`  | `node`                                                    | `pnpm -F @mediago/docs run docs:build`                                                                                        | `pnpm docs:build` → `task build:docs`                                                            |
| `build:docker`           | `production`  | Docker daemon                                             | `docker build -t mediago:local .`                                                                                             | `pnpm build:docker` → `task build:docker`                                                        |
| `pack:extension`         | `production`  | `build:extension`                                         | `pnpm exec tsx scripts/pack-extension.ts`                                                                                     | `pnpm pack:extension` → `task pack:extension`                                                    |
| `pack:electron`          | `production`  | `runtime-current`、`core-build`、`build:electron`         | `pnpm -F @mediago/electron run pack`                                                                                          | `pnpm pack:electron` → `task pack:electron`                                                      |
| `release:electron`       | `production`  | `runtime-current`、`core-build`、`build:electron`         | `pnpm -F @mediago/electron run release`                                                                                       | `pnpm release:electron` → `task release:electron`                                                |

`dev:web` 是当前 `dev:server` 行为的规范名称：它启动 Node server adapter 和 `APP_TARGET=server` 的 UI，并先构建 Go core。`dev:server` 仅是 Task alias，不再表示另一个“只启动后端”的隐含模式。`build:server` 则是非持久化生产构建，和 `build:docker` 的镜像构建边界不同。

### PR CI 和文档 CI

| Workflow/job                      | 唯一仓库入口         | 依赖与叶子命令                                                                               |
| --------------------------------- | -------------------- | -------------------------------------------------------------------------------------------- |
| `ci.yml / quality`                | `task ci:quality`    | profile `test`；`node` → `check`                                                             |
| `ci.yml / test-ts`                | `task ci:test:ts`    | profile `test`；`node` → `test:ts`                                                           |
| `ci.yml / test-go`                | `task ci:test:go`    | profile `test`；`test:go`，不安装 Node/媒体工具                                              |
| `ci.yml / test-media-integration` | `task ci:test:media` | profile `test`；`media-integration` → integration raw test                                   |
| `ci.yml / test-e2e`               | `task ci:test:e2e`   | profile `test`；`e2e`、Chromium/install-deps、typecheck、E2E build、`xvfb-run -a` Playwright |
| `ci.yml / pr-gate`                | 保留 workflow shell  | 只聚合 GitHub job result，不读取或构建仓库                                                   |
| `build-docs.yml / build`          | `task ci:docs:build` | profile `production`；`node` → `build:docs`；OSS 安装与上传仍属于 workflow                   |

### Electron、Docker 和发布 workflow

| Workflow step                   | Task 入口                                                                                                                       | 允许的叶子命令                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Desktop `validate-request`      | `task ci:desktop:validate-request`                                                                                              | `node scripts/ci/desktop-workflow.ts validate-request`                                                      |
| Desktop `verify-source`         | `task ci:desktop:verify-source`                                                                                                 | 同脚本 `verify-source`                                                                                      |
| Desktop `artifact-prefix`       | `task ci:desktop:artifact-prefix`                                                                                               | 同脚本 `artifact-prefix`                                                                                    |
| Desktop `apply-version`         | `task ci:desktop:apply-version`                                                                                                 | 同脚本 `apply-version`                                                                                      |
| Desktop install/build/release   | `task ci:desktop:release`                                                                                                       | `deps:node`、`runtime-current`、`release:electron`                                                          |
| Docker `validate-inputs`        | `task ci:docker:validate-inputs`                                                                                                | `node scripts/ci/docker-workflow.ts validate-inputs`                                                        |
| Docker `resolve-parameters`     | `task ci:docker:resolve-parameters`                                                                                             | 同脚本 `resolve-parameters`                                                                                 |
| Docker `verify-preview-private` | `task ci:docker:verify-preview-private`                                                                                         | 同脚本 `verify-preview-private`                                                                             |
| Docker `detect-dockerhub`       | `task ci:docker:detect-dockerhub`                                                                                               | 同脚本 `detect-dockerhub`                                                                                   |
| Docker `resolve-targets`        | `task ci:docker:resolve-targets`                                                                                                | 同脚本 `resolve-targets`                                                                                    |
| Docker `write-summary`          | `task ci:docker:write-summary`                                                                                                  | 同脚本 `write-summary`                                                                                      |
| Release prepare steps           | `task ci:release:{validate-request,detect-release-state,calculate-version,commit-version,resolve-source,write-prepare-summary}` | `node scripts/ci/release-workflow.ts <同名命令>`                                                            |
| Release collect desktop files   | `task ci:release:collect-electron-artifacts`                                                                                    | `node scripts/collect-electron-artifacts.ts electron-artifacts release-files "$VERSION" "$UPDATER_CHANNEL"` |
| Release desktop publish steps   | `task ci:release:{publish-desktop,write-desktop-summary}`                                                                       | 同一 release 脚本对应命令                                                                                   |
| Release Docker tag              | `task ci:release:tag-docker-release`                                                                                            | 同一 release 脚本对应命令                                                                                   |

这些 CI metadata/publish Task 不加载项目 dotenv，只透传 workflow step 显式注入的环境。现有 `scripts/ci/*.ts` 中逐命令的 `requiredEnvironment`/类型校验继续作为变量契约的单一来源，Task 不复制第二份可能漂移的变量清单。每个 step 保持独立 Task，以保留 GitHub output、step id、条件执行和最小权限边界。

Docker Buildx action 是平台执行器，不改成宿主机 Task 命令。`Dockerfile` 内部也不安装 Task；其构建阶段只允许执行包管理器安装以及 `player-ui build`、`build:web:raw`、`deps:download:raw --platform` 等明确叶子命令。静态契约测试将这些 Dockerfile 叶子调用列入有限白名单。

`task setup` 适合首次克隆；所有开发和构建任务仍必须声明自己的真实前置关系，不能要求开发者记住先手动执行 setup。特别是空 `.deps` 或只缺 BBDown 时，`task dev:all` 都必须自行恢复到可运行状态。

`deps:node` 使用 lockfile 和 workspace manifests 作为输入，通过 Task 的状态机制避免无变化时重复安装。依赖准备允许并行的部分由内部 Task 依赖图调度；持久化开发进程仅在版本门禁和所有前置任务成功后启动。

## 固定版本二进制依赖

`runtime-current` 的规范工具集合是 FFmpeg、N_m3u8DL-RE、BBDown、aria2、yt-dlp 和 mediago。`deps:runtime` 调用 `scripts/download-deps.ts` 并显式传入这六项；运行时代码新增外部工具时，契约测试要求同时修改版本清单和所属依赖组。

完整运行时支持的平台矩阵为：

- Desktop/local：`darwin-x64`、`darwin-arm64`、`linux-x64`、`win32-x64`
- Docker：`linux-x64`、`linux-arm64`

`win32-arm64` 暂不属于完整运行时支持矩阵，因为固定的 FFmpeg `b6.0` 没有该 asset。选择性下载具有 win32-arm64 asset 的单项工具仍可工作，但 `deps:runtime`、`dev:all` 和完整打包任务必须在下载前以“缺少固定 FFmpeg asset”的明确错误退出，不能静默跳过。

下载规则如下：

1. 版本、Release asset、目标文件名和可选 SHA-256 只从 `scripts/deps-versions.json` 读取。
2. 本地状态记录、固定版本、asset、文件名均匹配，最终二进制存在且可执行时跳过下载；存在 SHA-256 的组合还必须通过哈希校验。
3. `sha256[platform]` 是可选字段，校验对象明确为解压/重命名后的最终可执行文件，而不是压缩 asset。字段缺失时不声称完成哈希验证，只依赖固定版本、固定 asset 和状态清单。本次迁移不要求补齐所有上游未提供的哈希。
4. 已安装缓存缺失、Unix 执行位缺失、状态过期或已声明哈希不匹配时，将该缓存视为无效并重新下载受影响工具；Windows 不检查 POSIX 执行位。新下载并解压到临时目录的候选文件若哈希不匹配，则删除临时文件并硬失败，不覆盖现有二进制、不写入状态清单，也不再次接受同一候选。
5. 不调用 GitHub “latest release” API，不写回版本清单。
6. 下载、解压和重命名必须保持原子性；失败不得留下被识别为有效的半成品或有效状态记录。
7. 下载错误必须包含工具名、固定版本、平台、预期路径和可执行的重试命令，并以非零状态退出。

路径接口分成两个不可混用的变量：

- `MEDIAGO_DEPS_ROOT`：下载器的多平台根目录，默认 `<repo>/.deps`。下载器把目标写入 `${MEDIAGO_DEPS_ROOT}/<platform-key>`，状态写入 `${MEDIAGO_DEPS_ROOT}/.state`。隔离下载测试只覆盖这个变量。
- `MEDIAGO_DEPS_DIR`：运行时已经包含二进制的叶子目录。开发时 Task 将它设为 `${MEDIAGO_DEPS_ROOT}/<current-platform-key>`；打包后 Electron 使用 `resources/deps`，Docker 使用 `/app/deps`。现有 server/electron resolver 和 E2E 对该变量的语义保持不变。

下载器不得把 `MEDIAGO_DEPS_DIR` 当成根目录，也不得在其下再次追加平台。Task 的平台键生成必须与下载器共用同一个受测试的映射函数，避免 Node platform/arch 与目录命名漂移。

## 环境变量模型

使用 `MEDIAGO_PROFILE` 选择 `development`、`test` 或 `production` 配置。开发、测试和生产任务提供对应默认值，调用者可以显式覆盖。

通过 Task 启动时的优先级为：

1. 调用进程或 CI 已注入的环境变量
2. `.env.<profile>.local`
3. `.env.local`
4. `.env.<profile>`
5. `.env`

同一变量在多个 dotenv 文件出现时，前面的文件优先。项目不启用 Task 的实验性 env precedence 功能，因此 OS/CI 注入值保持最高优先级。`.env.local` 和 `.env.*.local` 必须被 gitignore；仓库环境文件只能承载非敏感默认值。

Task 注入的进程环境是规范路径。应用已有 `dotenv-flow` 继续保留：所有消费者用 `MEDIAGO_PROFILE ?? NODE_ENV` 选择 profile，且 dotenv loader 不覆盖已经存在的 `process.env` 值。经 Task 启动时，它只补足缺失值；直接执行 workspace 叶子命令时，它仍提供现有兼容行为。构建模式继续由 `cross-env` 叶子脚本或等价的显式命令设置，避免开发者 shell 中残留的 `NODE_ENV` 改变产物。

`apps/server/tsdown.config.ts` 和 `apps/electron/tsdown.config.ts` 必须删除 `env: { ...env.parsed }` 这种把整个 dotenv 解析结果交给 bundler 的做法。它们先加载 profile 到 `process.env`，然后只用显式 allowlist 定义编译期常量：`NODE_ENV`、`APP_TARGET`、`APP_VERSION`、`APP_NAME`，以及 UI 明确需要、天然客户端可见的 `APP_TD_APPID`。`GH_TOKEN`、`GITHUB_TOKEN`、签名凭据、OSS 凭据和其他未列入 allowlist 的值不得通过 tsdown/Vite `define` 或 `env` 进入 bundle。Server 运行期配置继续从启动进程环境读取。

实现时审计 `turbo.json`，将影响缓存或需要传递的 `APP_TARGET`、`NODE_ENV`、`MEDIAGO_PROFILE`、`MEDIAGO_DEPS_ROOT`、`MEDIAGO_DEPS_DIR`、`MEDIAGO_CORE_BIN` 和 `OPEN_DEVTOOLS` 放入正确的 `env`、`globalEnv` 或 `passThroughEnv` 分类。契约测试用一个高辨识度的假密钥构建 Server/Electron，并断言产物中不存在该值。诊断和日志不得打印密钥值；需要校验的敏感变量只显示“已设置/未设置”。

## Task CLI 版本

- 团队本地明确要求 Task `v3.51.1`。
- README 为 macOS、Linux 和 Windows 提供安装或版本切换说明，但仓库不自动下载 Task。
- Taskfile 顶层 schema `version` 只表达最低语法版本，不能作为精确版本锁。内部 `internal:require-task-version` 使用 Task 的 `{{.TASK_VERSION}}` 特殊变量与字符串 `3.51.1` 精确比较；不相等时命令直接非零退出并给出修复提示。
- 除 `doctor` 外，每个公开任务都先顺序执行上述门禁，再进入任何安装、下载、构建、测试或发布任务。`doctor` 自身运行同一比较但继续收集其余诊断，最终统一返回非零。
- 所有 GitHub Actions job 使用官方 `go-task/setup-task@v1` 并显式指定 Task `3.51.1`；action 的 tag 可以按仓库既有策略固定，安装的 Task 二进制版本必须精确固定。
- 契约测试校验 Taskfile 所需版本、工作流安装版本和文档声明一致，防止静默漂移。

## GitHub Actions 迁移

迁移 `.github/workflows/ci.yml`、`build-electron.yml`、`build-server.yml`、`build-docs.yml` 和 `release.yml`，以及它们调用的仓库内构建入口。

每个需要仓库命令的 job 先安装固定 Task CLI，再调用“任务接口”矩阵中逐项列出的 `task ci:*`、`task build:*` 或 `task release:*`。现有 `node scripts/ci/{desktop,docker,release}-workflow.ts <command>` 都由一对一的 Task 包装器调用，workflow 不再直接调用这些脚本。Node、pnpm、Go、Java、Docker Buildx 等 runner 工具的安装仍由对应 setup action 完成；GitHub 缓存、矩阵、permissions、secrets、签名、artifact、reusable workflow 和 release orchestration 仍保留在 YAML。

迁移原则是“仓库行为交给 Task，平台行为留给 Actions”。例如 Electron 的 core/UI 构建与打包由 Task 调用，代码签名密钥注入和制品上传仍由 workflow 负责；Docker 构建准备由 Task 完成，`docker/build-push-action` 仍负责多架构构建与推送。

Desktop 构建中现有 `go install github.com/swaggo/swag/cmd/swag@latest` 没有对应的 `swag init` 调用，构建使用已经提交的 `apps/core/docs/docs.go`，因此迁移时删除该无效安装步骤，不把它带入 Task 依赖。Docs、Go-only 和 workflow metadata 等 job 不得因为统一入口而安装 Node 或下载无关媒体工具。各 CI task 依赖最小化，既验证依赖图又避免显著增加执行时间。

## 文档迁移

规范迁移集合是 `README.md`、`README.zh.md`、`README.jp.md`、`README.it.md`、`CONTRIBUTING.md`、`apps/core/README.md`、`apps/electron/README.md` 和 `apps/ui/README.md`。只修改其中的仓库初始化、开发、检查、测试和构建入口；组件 API 或独立工具示例中的 pnpm 命令不做无关改写。推荐路径为：

```text
task setup
task dev:all
```

文档同时给出 `task dev:web`、`task dev:electron`、`task check`、`task test` 和主要构建命令，并说明 `dev:server` 是 `dev:web` 的 alias。`pnpm dev:all` 不再作为推荐启动方式。历史高层 pnpm 命令若保留，只作为兼容入口，并在不形成调用环的前提下转入对应 Task 任务。静态测试扫描上述文件的启动/构建代码块，阻止再次推荐高层 pnpm 编排命令。

## Bilibili 下载与错误边界

系统保留两类不同 ID，不再用“task ID”笼统称呼：

- **Download ID**：`POST /api/downloads` 返回的持久化数据库 `int64`，JSON wire shape 为 `SuccessResponse.data: Array<{ id: number, ... }>`。`/api/downloads/:id`、start/stop/logs 只接受十进制 Download ID。
- **Queue Task ID**：`POST /api/tasks` 的 `CreateTaskResponse.id: string`，允许调用者自定义字符串，未提供时生成 UUID；`/api/tasks/:id`、stop/logs 保持字符串语义，不新增数字校验。

通过 `/api/downloads` 启动持久化下载时，service 必须把 Download ID 格式化为十进制字符串作为 Queue Task ID。因此该链路的 SSE `id` 是 Download ID 的字符串表示，但独立调用 `/api/tasks` 仍可产生 UUID，两套 API 不互相收窄。

Bilibili 回归链路包含三个独立契约：

1. **捕获/导入契约**：扩展把 Bilibili 页面来源映射为 `type: "bilibili"` 并 POST `/api/downloads`。HTTP importer 解码 `SuccessResponse.data`，只有返回数量匹配且每个 `id` 都是正整数时才报告导入成功；扩展不会虚构 ID，也不会在当前流程中调用后续查询接口。
2. **持久化/队列契约**：core 返回数字 Download ID，auto-start 使用该值的十进制字符串入队；UI 只对这种 download SSE ID 做严格正整数转换。无效 SSE ID 被视为协议错误，不得继续请求 `/api/downloads/NaN`、`undefined` 或来源媒体 ID。
3. **执行契约**：core 从 `MEDIAGO_DEPS_DIR` 解析 BBDown，并使用捕获来源组装参数。二进制缺失生成可由 `errors.As` 识别的 `DependencyError{Tool, ExpectedPath}`，不得转换为 `invalid id`。

同步 HTTP 错误保持 `ErrorResponse.code` 为 HTTP 整数，并新增可选的稳定字段 `errorCode: string`。`/api/downloads/:id` 无法解析时返回 HTTP 400 + `errorCode: "invalid_id"`；数字 ID 不存在时返回 HTTP 404 + `errorCode: "download_not_found"`。`/api/tasks/:id` 接受字符串，未找到时返回 HTTP 404 + `errorCode: "task_not_found"`。

BBDown 缺失发生在异步队列阶段。`download-failed` SSE 的 wire shape 扩展为：

```json
{
  "id": "2",
  "errorCode": "dependency_missing",
  "error": "Required dependency BBDown is missing",
  "dependency": "BBDown"
}
```

`error` 字段保留以兼容现有 core-sdk；新增 `errorCode` 和可选 `dependency`。其他下载失败使用 `errorCode: "download_failed"`。队列回调把完整内部错误写入任务日志，将稳定字段广播给 UI；UI 根据 `errorCode` 展示准确提示。即使有人绕过 Task 直接启动应用或运行时文件被删除，页面也会显示缺少 BBDown，而不是 `invalid id`。

## 错误处理

- Task 版本不匹配时，公开入口的顺序门禁在执行仓库工作前失败并给出安装提示。
- 不在完整运行时支持矩阵中或缺少任一必需固定 asset 的平台，在依赖准备阶段失败，不能进入部分启动状态；选择性工具任务只校验所选工具。
- Node 安装、工具下载、完整性验证、build 或 test 任一前置失败时，下游任务不运行。
- 多进程开发任务沿用 fail-fast 行为；任一关键服务退出时终止其余协同进程。
- production/release 应用任务对必要环境变量使用显式前置校验；CI metadata/publish 任务沿用 `scripts/ci/*.ts` 的逐命令校验。两者都不回显内容，CI metadata/publish 任务也不加载项目 dotenv。
- `task doctor` 汇总所有可诊断问题并返回非零状态，便于本地和 CI 使用。

## 测试设计

### Taskfile 契约测试

- `task --list-all` 能解析根 Taskfile，所有公开任务都有描述。
- 关键任务存在且依赖图符合规范矩阵；除 `doctor` 外所有公开任务的第一步是 `internal:require-task-version`，随后才是内部实现，`dev:all` 的实现依赖 `runtime-current`、`node`、`core-build` 和 `build:electron`。
- Task 只调用表中叶子命令，不调用会回到自身的历史 pnpm 包装脚本；Dockerfile 只能调用有限白名单中的 raw/workspace 叶子命令。
- 环境文件优先级、允许的 profile、CI metadata 任务不加载 dotenv 和敏感值不输出规则有测试覆盖。使用假密钥构建 Server/Electron 后，产物不得包含该值。
- 工作流、Taskfile 和文档声明的 Task 版本均为 `3.51.1`，每个仓库命令 job 均安装固定版本；门禁对其他版本返回非零。
- 静态测试逐项核对 workflow/job → Task 映射，并扫描规范文档集合，阻止重新推荐高层 pnpm 编排入口。

### 二进制依赖测试

- 运行时代码引用的外部工具必须存在于 `scripts/deps-versions.json`，并归属至少一个正确的 Task 依赖组。
- 在临时 `MEDIAGO_DEPS_ROOT` 中模拟缺失、版本过期、已声明哈希错误和完整状态，分别验证下载、替换、拒绝与跳过行为；断言输出落在 `<root>/<platform>`，运行时收到的是该叶子目录。
- 对完整运行时支持矩阵，六个工具都必须有固定 asset；断言 `win32-arm64` 完整运行时因缺少固定 FFmpeg asset 明确失败。选择性工具任务按所选工具判断支持性。
- 哈希测试明确计算最终可执行文件：有 `sha256[platform]` 时匹配才能成功，无该字段时不执行哈希断言。
- 固定 BBDown `1.6.3` 的测试断言来自版本清单，不把版本复制成第二个可漂移的实现常量。
- Desktop 构建矩阵覆盖 darwin-x64、darwin-arm64、linux-x64、win32-x64；Docker Buildx 覆盖 linux-x64、linux-arm64。对应 job 在打包/镜像使用前验证任务所需固定工具存在且可执行。

### Bilibili 回归测试

- 扩展 E2E 使用本地页面或捕获 fixture 生成 Bilibili 来源，点击下载后断言 POST `/api/downloads` 的 `type`、URL 和 headers，并用真实 wire shape 返回正整数 Download ID；错误数量、缺失 ID 或非数字 ID 必须使 importer 报告失败。该测试不虚构扩展不存在的后续请求。
- core handler/service 集成测试断言 `POST /api/downloads` 返回 JSON number ID，auto-start 以其十进制字符串入队，SSE start/success/failure 使用相同字符串。
- core 下载集成测试在临时根目录的平台叶子目录放置伪 BBDown，记录 argv 并返回固定输出，验证 Bilibili 任务确实解析和执行 BBDown。
- 删除伪 BBDown 后，断言 typed `DependencyError` 被映射为 `download-failed` 的 `errorCode: "dependency_missing"`、`dependency: "BBDown"`，UI 展示依赖错误且不请求非法 Download ID。
- `/api/downloads/not-a-number` 返回 `invalid_id`；`/api/tasks/<uuid>` 保持字符串 ID；两类 API 的 wire contract 各自测试。
- 测试不访问真实 Bilibili，也不依赖 Cookie、登录状态或上游页面结构。

### 迁移验证

- 执行 `task check`、`task test`、媒体集成测试和 E2E。
- 在适用 runner 上验证 Electron、Server、Docker 和 Docs 代表性构建任务。
- 静态审查所有 workflow：仓库级 check/test/build/package 及 `scripts/ci` 命令通过 Task 入口；runner setup、PR result 聚合、上传/签名/发布和 Docker Buildx action 不受限制。Dockerfile 只使用规范白名单中的安装与叶子构建命令。
- 从空 `.deps` 启动 `task dev:all`，确认所有前置完成后才出现可交互页面，并验证 BBDown 存在且可执行。

## 验收标准

1. 安装 Task `v3.51.1` 后，在没有 `node_modules` 和 `.deps` 的新克隆中运行 `task dev:all`，能够自动准备依赖并启动完整开发环境。
2. 只删除 BBDown 后再次运行 `task dev:all`，系统只修复必要依赖并在启动前通过校验。
3. Task 与流水线不会修改 `scripts/deps-versions.json`，也不会选择任何未固定版本。
4. CI 注入变量优先于仓库 dotenv 文件，本地覆盖文件不进入 git，日志和 Server/Electron bundle 不泄露非 allowlist 敏感值。
5. CI、所有构建/发布工作流和启动文档使用 Taskfile 公开入口。
6. Bilibili fixture 的捕获、`/api/downloads` 数字 Download ID、对应十进制 Queue Task ID、SSE 和伪 BBDown 执行链路通过自动化测试；独立 `/api/tasks` 仍支持 UUID/自定义字符串。
7. BBDown 缺失时 SSE 错误明确为 `dependency_missing`，`invalid_id` 只在 `/api/downloads/:id` 的真实非法数字输入时出现。
8. 不需要媒体工具的 Docs 或 Go-only job 不下载完整运行时依赖。
9. Task 不是精确 `3.51.1` 时，除汇总诊断的 `doctor` 外，任何公开任务都在执行仓库命令前失败。
10. `MEDIAGO_DEPS_ROOT` 始终表示多平台下载根目录，`MEDIAGO_DEPS_DIR` 始终表示运行时叶子目录；Task 下载成功后的 BBDown 路径与 server/electron resolver 完全一致。

## 实施边界与顺序约束

后续实施计划应按“契约测试与叶子命令整理 → Taskfile 与依赖/环境支持 → 本地命令和文档 → CI/构建/发布迁移 → Bilibili 回归与全量验证”的顺序拆分。每一步都必须保持主分支可验证，不能在 Taskfile 未具备等价能力时先删除旧入口。
