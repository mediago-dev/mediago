# MediaGo 自动化测试基础设施设计

**日期：** 2026-08-16
**状态：** 已完成方案讨论，待实施计划
**范围：** 第一阶段——Vitest 统一、现有测试稳定化、PR 基础门禁

## 1. 背景

MediaGo 是包含 Go Core、React Web UI、Electron、浏览器扩展、TypeScript SDK 和 Node ServiceRunner 的 pnpm/Turborepo 单仓库。仓库已有 Go 与 TypeScript 测试，但目前没有根级统一测试入口，也没有在 Pull Request 上自动运行的测试门禁。

TypeScript 测试当前同时使用 `node:test` 和 Vitest。部分包可以单独运行 Vitest，其他测试需要手工使用 `tsx --test`。这种状态增加了本地使用、CI 编排和覆盖率汇总的复杂度。

本阶段先建立一个简单、可靠的基础层。后续媒体测试服务、集成测试、三端 Playwright E2E、nightly 和发布门禁将分别作为独立阶段实施。

## 2. 目标

本阶段完成后：

1. 所有 TypeScript 测试都直接使用 Vitest。
2. 根目录提供统一、可发现的测试命令。
3. 现有 TypeScript 与 Go 测试在干净环境中稳定运行。
4. Pull Request 自动运行质量检查和测试，并发布一个适合作为分支保护门禁的汇总 Job。
5. PR 流水线建立 P95 不超过 10 分钟的运行目标。
6. 实现保持直接，不为后续阶段预先构建复杂框架。

## 3. 非目标

本阶段不包含：

- 新建 MP4/HLS 媒体服务。
- 新增大规模业务测试。
- 引入 Playwright。
- Web、Electron、浏览器扩展 E2E。
- Bilibili、YouTube 或其他真实站点访问。
- Nightly 操作系统或浏览器矩阵。
- 覆盖率阈值阻塞。
- 发布 workflow 改造。

这些能力在基础门禁稳定后逐阶段加入。

## 4. 当前基线

仓库当前有 24 个 TypeScript 测试文件：21 个使用 `node:test`，3 个使用 Vitest。Go Core 有 11 个 `_test.go` 文件。这些数量作为迁移后的发现基线；测试文件数量变化时，实施者同时更新基线说明。

当前主要问题：

- 根 `package.json` 没有 `test`。
- `turbo.json` 没有正式测试任务。
- `.github/workflows/` 只有文档、构建和发布流程，没有 PR CI。
- 多种 TypeScript runner 造成命令和诊断格式不一致。
- 部分测试隐含依赖固定端口、当前机器缓存或本地构建产物。
- 两个包目录中存在额外 lockfile，但当前仓库 workflow 没有使用它们。

## 5. 核心设计

### 5.1 TypeScript 统一使用 Vitest

一次性将所有 `node:test` 测试迁移到 Vitest，不保留长期过渡层。

迁移规则保持机械和最小：

- `node:test` 的 `test`、`describe`、生命周期函数改为从 `vitest` 导入。
- `node:assert/strict` 改为 Vitest `expect`，不同时保留两套断言风格。
- `TestContext` 和 `t.after(...)` 改为 Vitest 的 `onTestFinished(...)`；同步和异步清理函数都必须返回或等待其 Promise，确保断言失败时仍执行清理。
- 套件级只读 fixture 使用 `beforeAll` 创建并由 `afterAll` 清理；会被测试修改的目录、数据库和进程仍按测试隔离。
- 已有测试语义、测试名和覆盖场景保持不变。
- 只有测试暴露真实缺陷或环境耦合时才修改生产代码。
- 不在迁移过程中顺带重构无关业务模块。

### 5.2 根级 Vitest 配置

根目录新增一个 `vitest.config.ts`，由它统一发现 apps、packages 和 scripts 中的 TypeScript 测试。它是第一阶段唯一的 Vitest 配置来源。

首阶段只配置一个 Node 测试环境，不启用 Vitest Projects。React DOM 组件测试尚未进入本阶段，因此不提前增加 jsdom project；后续确实出现第二种环境时再引入 Projects。

根配置负责：

- 测试文件包含与排除规则。
- workspace 包源码别名，保证干净 checkout 不依赖已生成的 `build/` 或 `dist/`。
- 超时和并发的保守默认值。
- CI 与本地一致的 reporter 行为。
- 后续 coverage 的公共入口。

不创建自定义 runner、插件或测试 DSL。

### 5.3 依赖与锁文件

Vitest 和 V8 coverage provider 在根 workspace 声明并由根 `pnpm-lock.yaml` 锁定。`packages/core-sdk` 和 `packages/node-service` 如果为了包内 `pnpm test` 继续声明 Vitest，版本范围必须与根依赖一致，脚本必须显式复用根配置并按包路径过滤。

删除或重建 package 级 lockfile 与测试迁移无直接关系，本阶段保持它们不变。后续只有在单独确认包发布方式后，才用独立维护任务处理锁文件。

### 5.4 根命令

根 `package.json` 提供：

```text
pnpm test              运行 TypeScript 和 Go 快速测试
pnpm test:ts           运行一次全部 Vitest 测试
pnpm test:watch        以 watch 模式运行 Vitest
pnpm test:go           在 apps/core 中运行 go test ./...
pnpm test:unit         第一阶段等同于快速 TS + Go 测试
pnpm test:coverage     生成 TypeScript 与 Go 覆盖率报告
pnpm test:ci           CI 使用的非交互测试入口
```

第一阶段中，`test` 明确按顺序执行 `test:ts` 和 `test:go`；`test:unit` 是相同快速集合的可发现别名；`test:ci` 也是同一集合的非交互别名，供后续阶段在不改 workflow 调用点的情况下扩展。命令名称在后续阶段保持稳定。

### 5.5 编排边界

第一阶段由根 `vitest.config.ts` 和根脚本直接编排所有 TypeScript 测试，不修改 `turbo.json`，也不通过 Turbo 再次调用 Vitest。CI 的 `test-ts` 只执行一次根 `pnpm test:ts`，避免重复运行。

已有包级 `test` 脚本仅作为开发者的局部入口：它们显式引用根配置并用包路径过滤，不维护第二份配置。其他包不为了形式统一而新增空 `test` 脚本。

不在第一阶段实现按 Git diff 选择测试。当前仓库规模下，全量快速测试更容易理解，也更不容易漏测。

## 6. 测试稳定化规则

迁移时同时修复阻止测试稳定运行的最小问题：

- 真正监听网络的测试使用随机可用端口；完全 mock 掉网络探测的测试可以断言固定的输入端口，但不能访问宿主机该端口。
- 会修改内容的测试使用自己的临时目录。只读且创建成本较高的 fixture 可以在单个测试文件中共享，但必须由 `afterAll` 清理，且测试不得修改它。
- 子进程、计时器和网络探测在测试中显式替换。
- 不依赖测试执行顺序。
- 不依赖仓库中遗留的 `build/`、`dist/` 或 `.turbo/`。
- 不通过增加重试掩盖单元测试失败。
- 不使用非零固定 `sleep` 等待外部状态；等待明确 Promise、事件或虚拟计时器。用于让出一个事件循环 turn 的 `setTimeout(..., 0)` 可以保留，但测试名或辅助函数应表达该调度语义。
- 测试结束后清理子进程、监听器和临时文件。

如果迁移暴露生产代码缺陷，先增加或保留能稳定复现缺陷的测试，再做最小修复。

## 7. PR CI 设计

新增 `.github/workflows/ci.yml`，在 `pull_request` 和默认分支 push 上运行。

首阶段包含四个 Job：

| Job       | 内容            | 目标时长 |
| --------- | --------------- | -------: |
| `quality` | `pnpm check`    | 3–5 分钟 |
| `test-ts` | Vitest 全量测试 | 2–4 分钟 |
| `test-go` | Go 全量测试     | 2–4 分钟 |
| `pr-gate` | 汇总前三个 Job  |     数秒 |

Job 并行执行。CI 使用仓库已经采用的 Node 24、pnpm 10.15 和 Go 1.25 主版本，避免额外版本矩阵。

CI 约束：

- 权限为 `contents: read`。
- 使用普通 `pull_request`，不使用 `pull_request_target` 执行贡献者代码。
- 同一个 PR 推送新 commit 后取消旧运行。
- 每个 Job 设置 8 分钟超时。
- 使用 `pnpm install --frozen-lockfile` 安装依赖。
- 使用 pnpm store、Go module 和 Go build cache。
- 测试失败时保留清晰日志；本阶段没有截图或大型 artifact。
- `pr-gate` 声明对前三个 Job 的 `needs` 并使用 `if: always()` 运行。只有三个结果全部为 `success` 时它才成功；任一结果为 `failure`、`cancelled` 或 `skipped` 时都以非零状态结束。
- 本阶段只发布名称稳定的 `pr-gate` 状态检查。GitHub 仓库分支保护规则属于仓库外配置，不在本阶段自动修改；维护者可在 workflow 验证后将其设为唯一必需检查。

依赖安装需要访问包仓库，但测试运行本身不访问第三方视频站点。

## 8. 覆盖率

本阶段配置覆盖率生成能力，但只报告、不阻塞。

- TypeScript 使用 Vitest V8 provider。
- Go 使用原生 `-coverprofile`。
- TypeScript 报告写入 `coverage/ts/`，Go profile 写入 `coverage/go/coverage.out`，并将根 `coverage/` 加入忽略规则。
- coverage 命令开始前清理这两个输出目录；任一测试命令失败时保留其已有输出并返回失败，不生成误导性的合并成功结果。
- 排除生成代码、类型声明、i18n 资源和构建产物。
- 暂不设置全局阈值。

建立稳定基线后，后续阶段再启用覆盖率棘轮和新增代码目标。

## 9. 错误处理与诊断

失败输出必须让维护者无需本地复现也能先判断类别：

- Vitest 输出失败测试名、期望值和实际值。
- Go 输出失败 package 和 test 名。
- 子进程测试若增加自定义诊断，只输出合成 fixture 的 argv、退出码和 stderr。
- CI 汇总 Job 显示具体失败 Job，而不是只有一个模糊错误。

Vitest 和 Go 的标准 expected/actual、stack trace 不做全局后处理。项目编写的 fixture 必须使用合成 Token、Cookie 和路径；新增自定义日志不得读取或打印名称匹配 `TOKEN`、`COOKIE`、`AUTH`、`SECRET`、`PASSWORD` 的环境变量。通过代码审查和 fixture 搜索验证这一边界，不引入通用日志脱敏框架。

## 10. 文件职责

预计新增或修改的文件边界：

- `vitest.config.ts`：全仓 TypeScript 测试发现、环境和源码解析。
- `package.json`：根测试命令和统一测试依赖。
- `packages/core-sdk/package.json`、`packages/node-service/package.json`：局部脚本显式复用根配置，Vitest 版本与根一致。
- `pnpm-lock.yaml`：记录根测试依赖变化。
- `.github/workflows/ci.yml`：PR 基础质量与测试门禁。
- `**/*.test.ts`：只做 runner/断言迁移和必要的稳定化调整。
- `.gitignore`：忽略覆盖率输出。

生产代码只在测试证明存在缺陷或缺少可替换边界时做最小修改。

## 11. 验收标准

本阶段完成必须满足：

1. 所有 TypeScript 测试均由 Vitest 发现并运行。
2. 测试文件中不再导入 `node:test` 或 `node:assert/strict`。
3. `pnpm test:ts` 在干净 checkout 中通过。
4. `pnpm test:go` 在干净 checkout 中通过。
5. `pnpm test` 和 `pnpm test:ci` 都是非交互、退出码可靠的命令。
6. `pnpm check` 通过。
7. PR workflow 的三个并行检查和汇总 Job 正常工作；模拟任一依赖失败、取消或跳过时，`pr-gate` 不得成功。
8. 首次上线通过一个完整 PR 运行验证总墙钟时间低于 10 分钟。长期 SLO 按最近 20 次非草稿 PR 的最新、完整、非取消运行计算 P95，排除被新提交取代而取消的运行和已确认的 GitHub Actions 平台故障；样本不足 20 次时只报告已有样本，不阻塞阶段验收。
9. 单元测试不依赖固定端口、外部视频站点或已有构建产物。
10. 不新增不属于本阶段的框架或抽象。

## 12. 后续阶段

基础阶段稳定后，按以下独立阶段继续：

1. 自建 MP4/HLS 媒体服务和 Core/API/SDK 集成测试。
2. `yt-dlp`、`BBDown` 输入输出契约 fixture。
3. Web、Electron、浏览器扩展三端 Playwright 冒烟。
4. Nightly 矩阵、覆盖率棘轮、Docker 和发布门禁。

每个阶段都先交付最小可用路径，再根据真实问题逐步增强。
