# MediaGo 媒体下载集成测试设计

**日期：** 2026-08-16
**状态：** 已按本地媒体服务方案实施
**范围：** 第二阶段——自有 MP4/HLS 测试资源与 Core/API/SDK 集成测试

## 1. 目标

第二阶段建立一条小而完整的真实下载验证链路：

```text
MediaGoClient → Core HTTP API → TaskQueue → 实际下载器 → 自有媒体资源 → 下载文件
```

完成后应满足：

1. 仓库拥有可重复生成、体积很小、无版权风险的 MP4 和 HLS 测试资源。
2. 本地测试可以在随机端口提供这些资源，不依赖固定端口或公网。
3. Pull Request 启动临时本地媒体服务，验证真实 HTTP 下载器行为而不依赖公网媒体。
4. Direct 使用实际 `aria2c`；HLS 使用实际 `N_m3u8DL-RE` 和 `ffmpeg`。
5. 集成测试通过真实 SDK 和 HTTP API 创建任务、等待终态并校验下载产物。
6. 两个下载场景串行执行，整体 PR P95 继续以 10 分钟以内为目标。

## 2. 非目标

本阶段不包含：

- Bilibili 或 YouTube 的真实媒体下载。
- Bilibili/YouTube 命令行输入输出契约；它们作为下一独立阶段处理。
- Web、Electron、浏览器扩展 Playwright 测试。
- 直播、加密 HLS、多码率切换、代理、登录态或大文件。
- Windows/macOS 下载器矩阵。
- 为测试资源建立上传、管理后台、数据库或动态转码服务。
- 修改现有产品下载流程来迎合测试。

## 3. 方案比较

### 方案 A：只使用本地 HTTP fixture（采用）

仓库保存唯一的媒体源文件和清单。每次集成测试都在 `127.0.0.1` 的随机端口启动一个很薄的 HTTP 服务，Direct 和 HLS 下载器通过真实 HTTP 请求访问它。这个方案最快、稳定、无需公网设施或上传凭据；Range 等下载协议行为由同一个本地服务和协议测试覆盖。

### 方案 B：只使用公网静态资源

优点是贴近真实公网路径；缺点是测试依赖对象存储、CDN、网络和限流状态，故障归因更复杂。本阶段不采用。

### 方案 C：本地服务与公网镜像共用同一份资源

可以额外覆盖 CDN 路径，但需要发布流程、写凭据和更多失败面。当前下载集成目标使用 localhost 已足够，因此不实现公网镜像。

## 4. 测试资源

资源放在根目录 `tests/media-service/public/v1/`，不放在 `docs/`：

```text
tests/media-service/
├── README.md
├── generate.ts
├── server.ts
├── server.test.ts
└── public/v1/
    ├── manifest.json
    ├── sample.mp4
    └── hls/
        ├── index.m3u8
        ├── init.mp4
        └── segment-0.m4s
```

约束：

- 视频由 `ffmpeg` 的测试图和合成音频生成，不取自第三方作品。
- 时长约 1 秒，低分辨率，总体积控制在 1 MiB 内。
- HLS 使用 fMP4 `.m4s` 分片，避免 `.ts` 被 TypeScript 工具误识别。
- `manifest.json` 记录版本、生成参数、文件大小和 SHA-256。
- 生成器接收显式版本号；若目标版本已存在但重新生成的内容不同则失败，不允许覆盖。需要修改资源时新增 `v2/`。

生成脚本只用于明确更新 fixture。普通测试直接使用已提交资源，不要求每次安装或运行 ffmpeg。

## 5. 本地媒体服务

`server.ts` 使用 Node 标准库实现最小只读服务，不引入 Express、Fastify 或测试 DSL。

公开路径只有：

- `/healthz`
- `/v1/manifest.json`
- `/v1/sample.mp4`
- `/v1/hls/index.m3u8`
- `/v1/hls/init.mp4`
- `/v1/hls/segment-0.m4s`

协议约束：

- 只接受 `GET` 和 `HEAD`，其他方法返回 `405`。
- 文件支持单段 `Range`，有效范围返回 `206`，无效范围返回 `416`。
- 返回准确的 `Content-Length`、`Content-Range`、`Accept-Ranges`、`ETag` 和媒体类型。
- 允许跨域读取，并暴露下载诊断所需响应头。
- 路径使用固定白名单，不接受任意磁盘路径，不提供目录列表、代理或上传。
- 默认监听 `127.0.0.1:0`，由操作系统分配端口。

服务协议测试覆盖健康检查、完整 GET、HEAD、有效 Range、无效 Range、方法限制和未知路径。

## 6. 实际下载集成测试

新增独立 Vitest 配置和命令，避免普通 `pnpm test` 隐式下载第三方工具：

```text
pnpm test:integration:media
```

测试流程：

1. 为 Core 配置、日志和下载目录创建独立临时目录。
2. 启动本地媒体服务，由系统分配 `127.0.0.1` 随机端口。
3. 使用当前工作树源码把 Core 构建到测试临时目录，不能复用仓库遗留的 `bin/` 产物。
4. Node helper 先监听 `127.0.0.1:0` 取得空闲端口，关闭 listener 后立即用该端口启动 Core。首版接受 bind-release 之间极小的竞争窗口；就绪失败时重新分配并重试一次，不增加生产服务专用测试接口。
5. Core 及下载器子进程清除代理变量、固定 `HOST`/`PORT`、使用临时 `HOME`，并为 localhost 设置 `NO_PROXY`；SDK Axios 同样禁用代理。
6. 使用 `MediaGoClient.health()` 等待 Core 就绪。
7. 串行执行 Direct 和 HLS 两个场景，资源 URL 都来自本地媒体服务。
8. 通过 `MediaGoClient.createTask()` 调用 `POST /api/tasks`。
9. 通过 `MediaGoClient.getTask()` 轮询明确终态，不使用固定 sleep，也不依赖可能丢失首事件的 SSE。
10. Direct 校验输出 MP4 非空，并与仓库清单中的源文件大小和 SHA-256 相同。
11. HLS 查找以指定名称开头的非空合并媒体文件，不固定容器扩展名；随后使用已准备的 `ffmpeg` 在短超时内完整解码到 null sink，确保产物可读。
12. 无论成功失败，都终止 Core、关闭本地服务并清理临时目录。

首版使用无认证、无数据库的 `/api/tasks` 路径。这已经覆盖 SDK 序列化、HTTP handler、队列、实际命令参数、下载进程和输出文件。持久化 `/api/downloads` 路径留到后续单独添加，避免首版同时引入数据库状态和更多异步分支。

## 7. 第三方工具准备

现有 `pnpm deps:download` 会下载所有发布工具，体积和失败面都过大。第二阶段为脚本增加简单的工具过滤参数，例如：

```text
pnpm deps:download -- --tools aria2,N_m3u8DL-RE,ffmpeg
```

规则：

- 未传 `--tools` 时保持现有行为，避免影响发布流程。
- 未知工具名立即失败并显示合法名称。
- CI 只下载 Direct/HLS 所需的三个固定版本。
- `.deps` 按平台和 `scripts/deps-versions.json` 哈希缓存。
- 不下载 BBDown、yt-dlp 或已发布的 MediaGo Core。

## 8. PR CI

在现有三个基础 Job 之外新增 `test-media-integration`：

- Linux x64，Node 24、pnpm 10.15、Go 1.25。
- 安装 workspace 依赖并恢复 `.deps` 缓存。
- 下载缺失的三个固定工具。
- 不注入媒体 Base URL；测试自行启动随机端口 localhost 服务。
- 对 localhost 执行 Direct、HLS 两个场景，明确串行，不做矩阵并发。
- Job 超时 8 分钟，并加入现有 `PR gate` 汇总。
- 不使用媒体服务 secrets，不上传资源，不使用 `pull_request_target`。

失败信息应输出本地服务 origin/path、HTTP 状态和失败阶段。媒体服务、Core 或下载器任一环节失败都明确失败，不能绕过真实下载链路。

## 9. 媒体资源边界

媒体文件只作为仓库内测试 fixture 管理，不建立 OSS、CDN 或其他上传流程。测试服务只监听 `127.0.0.1`，只读取固定白名单路径，不允许公网目录写入、动态 URL 抓取或任意文件读取。

## 10. 错误处理

集成测试失败信息至少包含：

- 失败场景（Direct 或 HLS）。
- Core 是否就绪。
- 任务 ID、最终状态和 Core 返回的非敏感错误。
- 目标资源 URL 的 origin/path，不打印 query 中可能存在的秘密。
- 期望与实际文件名、大小和哈希。
- Core 最近的有限日志片段。

所有轮询都有截止时间。退出时先终止子进程，再等待退出；超时后强制结束，不能遗留后台 Core 或媒体服务。

## 11. 验收标准

1. `pnpm test` 继续只运行快速单元测试并通过。
2. `pnpm test:integration:media` 能使用随机端口 localhost 媒体服务通过。
3. PR 中同一命令只访问 localhost 媒体 URL，不访问 GitHub Raw、OSS 或第三方视频站点。
4. 本地媒体服务的协议测试覆盖完整请求、HEAD、有效 Range `206` 和无效 Range `416`。
5. Direct 产物与仓库清单中的源 MP4 大小和 SHA-256 一致。
6. HLS 任务成功、产生新的非空合并媒体文件，并能由 `ffmpeg` 无错误解码。
7. PR workflow 串行访问本地服务中的两类自有资源，Job 和总门禁结果可靠。
8. 缓存命中后的 PR 总墙钟时间保持 10 分钟以内；冷缓存首次运行记录耗时但不通过放宽全局超时掩盖问题。
9. fork PR 不需要媒体服务 secrets，也不存在媒体资源写入权限。
10. 所有临时进程、端口和目录在成功或失败后都被清理。
11. Bilibili/YouTube 没有真实网络下载。
12. 外部 `PORT` 或代理环境变量不能改变 localhost 测试路径。

## 12. 后续阶段

下一阶段只为 BBDown 和 yt-dlp 增加入参/出参契约 fixture，验证参数、日志解析和错误映射，不访问 Bilibili 或 YouTube。其后再进入 Web、Electron、浏览器扩展三端 Playwright 冒烟测试。
