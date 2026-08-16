# External Downloader Contract Test Design

**日期：** 2026-08-16  
**范围：** 第三阶段——BBDown 与 yt-dlp 入参/出参契约测试

## 1. 背景

MediaGo 通过 Go Core 调用 BBDown 和 yt-dlp。当前生产链路已经包含三层行为：

1. `schema.DefaultSchemas()` 定义每种工具的参数和控制台解析规则。
2. `DownloaderSvc.buildArgs()` 把下载任务转换为真实命令行参数。
3. `parser.LineParser` 把 stdout/stderr 行转换为开始、进度、速度、直播和错误信号。

现有测试只覆盖了 BBDown Cookie 的少量参数行为，没有系统验证 yt-dlp 参数，也没有使用代表性日志验证两种工具的输出解析。仓库当前固定 BBDown `1.6.3` 与 yt-dlp `2026.07.04`；契约必须绑定这两个版本的官方接口，不能仅根据 MediaGo 已有正则反向编造日志。直接下载真实视频会引入账号、地区、反爬、限流和第三方网络故障，因此本阶段只建立本地、确定性的契约测试。

## 2. 目标

本阶段完成后：

1. BBDown 的 URL、工作目录、文件名、Cookie 和公共编码参数受到测试保护。
2. yt-dlp 的 URL、输出目录、文件名、Header、代理和公共参数受到测试保护。
3. 固定版本能够证实的开始、进度、速度和错误输出能被当前解析器正确识别。
4. 未被固定版本证实的直播或错误正则从默认 Schema 中移除，不用人造 fixture 固化无效行为。
5. 工具返回非零退出错误时，下载器把错误原样返回给任务层，同时保留消息回调中的工具输出。
6. BBDown Cookie、yt-dlp 敏感 Header 和带凭据代理在日志参数副本中被隐藏，但实际 argv 不变。
7. 测试不启动 BBDown 或 yt-dlp，不访问 Bilibili、YouTube 或其他网络资源。
8. 测试自动进入现有 `go test ./...` 与 PR `test-go` 门禁，不新增独立 CI Job。

## 3. 非目标

本阶段不包含：

- Bilibili 或 YouTube 的真实请求、登录、Cookie 有效性验证或视频下载。
- 下载、安装或执行 BBDown、yt-dlp。
- 固定完整 argv 顺序；当前 Schema 使用 map，工具参数按语义验证。
- 固定完整日志文本；fixture 只保留并注明来源的代表性片段。
- 验证第三方工具的内部行为、媒体质量、合并结果或文件内容。
- 修改 Web、Electron、浏览器扩展 UI。
- Playwright、Nightly、覆盖率门槛或发布矩阵。
- 为测试引入新的 mock 框架或进程模拟框架。

## 4. 方案选择

### 方案 A：Go 内进程契约测试（采用）

测试直接调用生产 Schema、参数构建器和行解析器，并用现有 `Runner` 接口的轻量 fake 捕获 argv、回放 fixture、返回指定错误。

优点是跨平台、快速、无网络，同时覆盖 MediaGo 实际拥有和维护的边界。缺点是不能发现第三方工具未来改变 CLI 或日志格式；这由明确更新 fixture 的维护流程处理。

### 方案 B：假可执行文件

创建临时 shell/PowerShell 脚本输出日志并返回退出码。它能多覆盖一层进程管道，但跨平台脚本和权限处理明显增加复杂度，本阶段不采用。

### 方案 C：真实工具模拟运行

下载固定版本二进制并执行帮助或模拟命令。它仍依赖大文件下载、平台兼容和工具启动状态，对“只检查入参/出参”的目标收益有限，本阶段不采用。

## 5. 测试结构

新增：

```text
apps/core/internal/core/
├── downloader_contract_test.go
└── testdata/contracts/
    ├── README.md
    ├── bbdown-progress.json
    ├── bbdown-failure.json
    ├── yt-dlp-progress.json
    └── yt-dlp-error.json
```

每个 JSON fixture 只是一个只读 UTF-8 字符串数组，每个元素对应工具的一段 stdout/stderr 输出；使用 JSON 是为了准确保存 BBDown 的 `\b` 退格控制字符，不定义额外的业务 schema。期望值保留在表驱动 Go 测试中。

`README.md` 记录每个 fixture 对应的仓库固定版本、官方 tag、源码文件和裁剪/脱敏方式。fixture 必须来自固定版本的真实输出，或由固定版本官方源码中明确的格式字符串推导；不能只为了匹配当前 `ConsoleReg` 手写。版本升级时先重新核验上游，再同步 fixture、默认 Schema 和预期值。

测试放在 `core` package，以便直接验证未导出的 `buildArgs()`；输出部分使用公开的 `parser.NewLineParser()` 和默认 Schema。只有需要验证 Runner 边界时才调用 `DownloaderSvc.Download()`。

## 6. 入参契约

### BBDown

给定一个 Bilibili 下载任务，语义断言：

- URL 作为独立参数存在。
- `--work-dir` 指向配置下载目录和可选任务子目录。
- `--file-pattern` 使用清理后的任务名称。
- 请求头中的 Cookie 以大小写不敏感方式提取，并作为 `--cookie` 的值传递。
- Cookie 不存在时不生成 `--cookie`。
- 公共参数包含 `--encoding-priority avc,hevc,av1`。
- 日志参数副本会隐藏 Cookie，但不会修改实际 argv。

### yt-dlp

给定一个 YouTube 下载任务，语义断言：

- URL 作为独立参数存在。
- `-P` 指向配置下载目录和可选任务子目录。
- `-o` 使用清理后的任务名称。
- 每个 Header 都生成独立的 `--add-header <value>` 参数对。
- 只有启用且非空的代理才生成 `--proxy <value>`。
- 公共参数包含 `--no-mtime`、`--progress`、`--newline` 和 `--no-colors`。
- `Cookie`、`Authorization`、`Proxy-Authorization` Header 名按大小写不敏感方式识别，在日志参数副本中隐藏值，但实际 argv 保持原样。表驱动测试至少覆盖小写、混合大小写及冒号两侧空格。
- 带 userinfo 的代理在日志参数副本中隐藏凭据，但实际 argv 保持原样；无凭据代理可以保留。

参数断言使用“标志存在”“标志后的值正确”和“值出现次数正确”，不依赖 map 遍历产生的整体顺序。

## 7. 出参契约

每个 fixture 使用对应默认 `ConsoleReg` 创建 `LineParser`，逐段回放并验证最终状态或返回信号。上游核验以仓库当前固定版本为准：

- BBDown `1.6.3` 的 `ProgressBar.cs` 证实百分比、速度和退格覆盖输出；fixture 至少包含一个解码后带真实 `\b` 的进度样本，并验证解析器能恢复屏幕文本、解析百分比和形如 `1.5 MB/s` 的速度。
- BBDown `1.6.3` 的 `Program.cs` 证实下载阶段会输出“开始下载P…”，因此保留“开始下载”作为 ready 标记。
- BBDown 的错误输出由 `Logger.LogError()` 使用颜色而非 `ERROR` 文本区分，官方源码也没有“检测到直播流”标记。默认 Schema 的 `Error` 与 `IsLive` 无依据正则改为空；失败由进程退出码决定。
- yt-dlp `2026.07.04` 的 `downloader/common.py` 证实 `[download] Destination:`、小数百分比和形如 `2.5MiB/s` 的速度；这些片段进入 progress fixture。
- yt-dlp `2026.07.04` 的 `YoutubeDL.py` 证实错误以行首 `ERROR:` 为前缀；默认 Schema 的错误正则收紧为 `(?m)^ERROR:` 或等价语义。error fixture 验证错误文本，并用包含普通 `ERROR` 子串但不以 `ERROR:` 开头的输出作为负例。
- yt-dlp 官方源码没有通用 `[live]` 运行时日志契约。默认 Schema 的无依据 `IsLive` 正则改为空，本阶段不制造直播 fixture。

用于核验的上游固定版本入口：

- `https://github.com/nilaoda/BBDown/tree/1.6.3`
- `https://github.com/nilaoda/BBDown/blob/1.6.3/BBDown/ProgressBar.cs`
- `https://github.com/nilaoda/BBDown/blob/1.6.3/BBDown/Program.cs`
- `https://github.com/nilaoda/BBDown/blob/1.6.3/BBDown.Core/Logger.cs`
- `https://github.com/yt-dlp/yt-dlp/tree/2026.07.04`
- `https://github.com/yt-dlp/yt-dlp/blob/2026.07.04/yt_dlp/downloader/common.py`
- `https://github.com/yt-dlp/yt-dlp/blob/2026.07.04/yt_dlp/YoutubeDL.py`

yt-dlp 解析器发现 `ERROR` 只表示日志信号；BBDown 没有稳定错误前缀。两者的任务是否失败都由 Runner 返回值决定。边界测试让 fake Runner 先回放对应 failure/error fixture，再返回一个 sentinel error，并断言：

1. `Download()` 返回同一个错误。
2. fixture 行仍通过 `OnMessage` 回调交给上层。

这保持现有生产语义，不在测试阶段重新设计错误模型。

## 8. 确定性与安全

- 测试只读仓库 fixture 和 `t.TempDir()`。
- `Download()` 边界测试仅创建一个临时占位二进制文件满足现有 `os.Stat` 前置检查；fake Runner 不执行该文件。
- URL 使用保留示例域名或明显的占位视频 ID，不携带真实账号信息。
- Cookie、Authorization 和代理凭据使用无效测试值，并验证日志副本脱敏且实际 argv 不变。
- 不读取开发者本地 Cookie、代理或环境变量。
- 不监听端口，不产生外部进程，不需要网络权限。

## 9. CI 与耗时

新增测试由 `apps/core` 的 `go test ./...` 自动发现，因此现有 `test-go` 和汇总 `pr-gate` 自动覆盖。预计新增测试耗时低于一秒，不改变第二阶段媒体集成 Job，也不新增工具缓存或下载步骤。

## 10. 失败诊断

断言失败必须指出工具、输入字段或 fixture 文件，并输出安全的实际参数或解析状态，不能在失败消息中泄露测试凭据。契约变化时，维护者应先对照 `scripts/deps-versions.json` 和 `testdata/contracts/README.md` 确认固定工具版本的接口是否确实改变，再同步生产 Schema、来源说明和 fixture；不能只放宽断言绕过失败。

## 11. 验收标准

1. BBDown 与 yt-dlp 的入参语义均有表驱动测试。
2. 四个输出 fixture 绑定固定工具版本和官方来源，覆盖 BBDown 退格进度、yt-dlp 开始/进度/错误以及两者失败输出。
3. 未被固定版本证实的默认直播和错误正则被移除，BBDown 已由源码证实的开始标记继续保留。
4. 非零 Runner 错误与消息回调边界有测试。
5. BBDown Cookie、大小写和空格形式不同的 yt-dlp 敏感 Header，以及带凭据代理的日志副本脱敏有测试，实际 argv 不变。
6. 测试不执行真实第三方工具，不访问网络。
7. `go test ./...`、根级 TypeScript 测试和 `pnpm check` 通过。
8. PR 完整门禁通过，总墙钟仍低于 10 分钟。
9. 实现保持局部、直接，不引入新的测试框架或无关重构。

## 12. 后续阶段

下一阶段同时建设 Web、Electron、浏览器扩展三端 Playwright 冒烟测试。本阶段不会为 Playwright 提前增加浏览器配置或 UI 测试抽象。
