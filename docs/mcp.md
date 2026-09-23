---
layout: doc
outline: deep
---

# MCP 协议

MediaGo 的 MCP 服务显示名为 **mediago downloader**，配置标识为 `mediago-downloader`，与主 HTTP 服务使用同一端口，路径为 `/mcp`。在设置中启用 MCP 并取得专用 token，再使用支持 Streamable HTTP 的 MCP 客户端连接。

| 环境   | 地址                                               |
| ------ | -------------------------------------------------- |
| 桌面端 | `http://localhost:39719/mcp`                       |
| Docker | `http://<服务器地址>:9900/mcp`，按实际端口映射调整 |

桌面端设置页和“复制给 Agent”使用 `localhost`，端口以 Core 实际运行端口为准。Web 端保留实际服务器地址。`localhost` 仅适用于 Agent 与 MediaGo Core 运行于同一台机器的场景；远程 Agent 应使用可访问的服务器地址。

所有请求都需要 `Authorization: Bearer <MCP token>`。下载站点的 Cookie 或 Authorization 应放入下载工具的 `headers` 参数，与 MCP 服务本身的认证 token 分开。

`tools/list` 是各工具 `inputSchema`、`outputSchema` 的权威定义。本页对应 `get_capabilities.protocolRevision = "2"`；这是 MediaGo 工具契约的修订号，与 MCP 传输协议版本独立。

## 客户端配置与旧配置迁移

新配置使用 `mediago-downloader` 作为 MCP 配置键，支持显示名的客户端可显示 `mediago downloader`。服务端初始化响应中的 `serverInfo.name` 为 `mediago-downloader`，`serverInfo.title` 为 `mediago downloader`；部分客户端只展示配置键。

升级 MediaGo 不会自动修改第三方客户端中已有的配置。如果旧 `mediago` 条目指向同一个 MediaGo 实例，请将其重命名为 `mediago-downloader`，更新连接地址并保留有效 token 和其他设置，避免重复注册。改名本身无需重置 token。不要覆盖指向其他实例的条目。按客户端要求重新连接，再调用 `health_check` 验证。

## 响应约定

成功结果位于 `structuredContent`，同时在 `content[0].text` 中提供相同 JSON 的文本形式。所有工具都有输入与输出 schema，输出 schema 同时描述成功结果和统一错误对象。下文只展示 `structuredContent`。

单次调用失败时，MCP 的 `isError` 为 `true`，结果如下：

```json
{
  "error": {
    "code": "credentials_expired",
    "message": "task credentials expired or were cleared on restart; rediscover the source or supply fresh headers",
    "retryable": false,
    "downloadId": 101
  }
}
```

`retryable` 表示是否适合不修改请求直接重试。`false` 时应按错误原因修改输入、刷新凭证、修复依赖或查看应用日志。`downloadId`、`discoveryId` 在已知关联任务时提供，尤其是创建已成功但启动失败的情况。不要因为调用失败就假定任务不存在。

输入约束在创建任务之前校验：拒绝未知字段、非法枚举、越界数值和不合法的参数组合。参数错误统一返回 `invalid_argument`，不回显原始请求头、请求值或内部错误详情。

## 工具清单

| 工具                        | 用途                                      |
| --------------------------- | ----------------------------------------- |
| `health_check`              | 检查服务是否可调用                        |
| `get_capabilities`          | 查询运行环境、能力和限制                  |
| `create_download`           | 创建下载，默认立即启动                    |
| `start_download`            | 启动待下载任务或重试失败、停止的任务      |
| `get_download`              | 查询当前状态、进度、文件和安全的失败信息  |
| `list_downloads`            | 分页查询下载任务                          |
| `stop_download`             | 请求停止下载                              |
| `discover_media`            | 创建媒体发现任务                          |
| `get_media_discovery`       | 查询媒体发现结果                          |
| `cancel_media_discovery`    | 取消媒体发现                              |
| `download_discovered_media` | 根据发现的资源创建下载，可选择 HLS 清晰度 |

### health_check

输入 `{}`，成功返回 `{"status":"ok"}`。运行能力应查询 `get_capabilities`。

### get_capabilities

输入 `{}`。输出包含：

| 字段                        | 含义                                               |
| --------------------------- | -------------------------------------------------- |
| `protocolRevision`          | 工具契约修订号，目前为 `"2"`                       |
| `runtime`                   | `desktop` 或 `server`，Docker 属于 `server`        |
| `customDownloadDirectory`   | 是否允许任务指定 `downloadDir`                     |
| `defaultDownloadDirectory`  | 当前配置的下载根目录                               |
| `downloadQueueAvailable`    | 下载队列是否可用                                   |
| `browserDiscoveryAvailable` | 浏览器嗅探执行器当前是否可用                       |
| `hlsInspectionAvailable`    | HLS 检查器是否可用                                 |
| `sessionCookiesSupported`   | 是否可以使用桌面端登录会话                         |
| `variantSelection`          | 是否支持发现资源的清晰度选择交接                   |
| `deferredDownloads`         | 是否支持创建后延迟启动                             |
| `maxPageSize`               | 分页上限，100                                      |
| `maxBatchSize`              | 单次发现下载选择上限，20                           |
| `credentialTtlSeconds`      | 任务临时请求头的保留时间，600 秒                   |
| `maxCredentialTasks`        | 临时请求头最多保留的任务数，1024                   |
| `downloadTypes`             | 支持的下载类型名称；具体下载器二进制仍可能需要安装 |

### create_download

| 参数            | 类型     | 必填 | 约束与默认行为                                                                       |
| --------------- | -------- | ---- | ------------------------------------------------------------------------------------ |
| `url`           | string   | 是   | HTTP(S) 绝对 URL，不允许嵌入用户名和密码；最多 8192 字符                             |
| `type`          | string   | 否   | `m3u8`、`bilibili`、`direct`、`mediago`、`youtube`、`xiaohongshu`；省略时从 URL 推断 |
| `name`          | string   | 否   | 最多 255 字符，服务端会生成或清理文件名并处理名称冲突                                |
| `folder`        | string   | 否   | 下载根目录内的相对子目录，不允许目录穿越；最多 8192 字符                             |
| `downloadDir`   | string   | 否   | 桌面端的绝对下载根目录；Docker/server 拒绝非空覆盖值；最多 8192 字符                 |
| `headers`       | string[] | 否   | 最多 64 条 `Name: value` 格式的 HTTP 头，每条最多 8192 字符，禁止非法控制字符        |
| `startDownload` | boolean  | 否   | 默认 `true`；`false` 仅创建任务，随后使用 `start_download`                           |

```json
{
  "url": "https://example.com/video.mp4",
  "name": "lesson-1",
  "folder": "courses",
  "startDownload": false
}
```

成功返回下述下载对象，并带有 `outcome: "created"`。相同 URL 已存在时返回已有任务及 `outcome: "existing"`，不会修改其名称、目录或请求头，也不会重新启动它。需要重试时使用 `start_download`。

取消 MCP 调用或请求超时会中止标题获取，并在保存任务和接受入队前检查取消状态。若任务已经保存但尚未入队，会保留待启动记录，错误响应在能够返回时包含 `downloadId`；已入队任务需要通过 `stop_download` 停止。

`downloadDir` 和 `folder` 只作用于这个任务，不改变全局目录。桌面端任务指定的根目录会随任务保存，并用于后续启动、重试和输出文件查找。

### 下载对象

`create_download`、`start_download`、`get_download` 返回下载对象。列表中的元素和批量结果中的 `download` 也使用同一结构。

| 字段                         | 类型           | 含义                                                                          |
| ---------------------------- | -------------- | ----------------------------------------------------------------------------- |
| `id`                         | integer        | 下载任务 ID                                                                   |
| `name`、`type`、`url`        | string         | 保存后的文件名、下载类型和资源 URL                                            |
| `folder`                     | string         | 相对子目录，没有时为空字符串                                                  |
| `downloadDir`                | string，可省略 | 任务覆盖的下载根目录；省略表示使用全局配置                                    |
| `status`                     | string         | `ready`、`pending`、`downloading`、`stopping`、`success`、`failed`、`stopped` |
| `isLive`                     | boolean        | 是否检测为直播                                                                |
| `exists`                     | boolean        | 已完成任务的输出文件是否存在                                                  |
| `file`                       | string，可省略 | 已确认存在的主输出文件                                                        |
| `files`                      | string[]       | 已确认存在的输出文件，没有时为 `[]`                                           |
| `createdDate`、`updatedDate` | string         | 数据库记录的创建和更新时间，带时区；进度更新不一定修改 `updatedDate`          |
| `startedAt`                  | string，可省略 | 当前进程观察到的实际执行开始时间                                              |
| `progress`                   | object，可省略 | `{ "percent": 42, "speed": "2 MB/s" }`；没有运行快照时省略                    |
| `lastError`                  | object，可省略 | 安全的 `code`、`message`、`retryable`，不含原始进程输出                       |
| `hasAuthentication`          | boolean        | 是否含有需要保护的请求头，包括自定义认证头                                    |
| `authenticationAvailable`    | boolean        | 后续启动所需的临时请求头是否仍可用；无需认证时为 `true`                       |
| `authenticationExpiresAt`    | string，可省略 | 任务内存中临时请求头的过期时间                                                |
| `outcome`                    | string，可省略 | 仅创建接口提供 `created` 或 `existing`                                        |

响应不会包含 `headers`。原来的 `outputPath` 不再直接暴露，使用 `file` 和 `files` 获取确认存在的输出。进度只有下载器当前提供的百分比和速度；没有提供的字节数不会推算或伪造。

失败诊断可包含 `dependency_missing`、`disk_full`、`permission_denied`、`network_error`、`result_persistence_failed`、`download_failed`。只对能够确认的错误分类；未知下载器错误返回通用说明，详细原因通过 MediaGo 的任务日志查看。安全错误码会保存到数据库，重试时清除。`result_persistence_failed` 表示媒体已经下载，但任务结果保存失败；应先检查应用日志与数据库状态，避免直接重复下载。只有文件信息和成功状态保存完成后，才会发布下载成功。

如果数据库记录为运行中，但当前进程没有对应的工作任务，MCP 返回 `status: "stopped"` 和 `lastError.code: "download_interrupted"`，可以使用 `start_download` 恢复。

### start_download

输入 `{"id":101}`；`id` 是正整数，最大值为 `9007199254740991`。可选 `headers` 的格式和限制与创建接口相同，用来提供新凭证。启动时提供 `headers` 会替换该任务的请求头；需要认证的任务必须提供包含认证信息的新请求头，不能通过空数组绕过过期检查。

启动 `ready` 任务，或重试停止、失败、中断的任务。任务已在队列中、正在执行，或已经成功且仍有输出文件时，返回当前对象，不重复启动，也不更新请求头。成功任务已记录的输出文件全部丢失时，会重新下载；同名临时分片不会替代已记录的成品文件。没有输出路径记录的历史任务仍支持按名称和日志查找文件。重新下载时，过期的凭证也需要重新提供。发生启动时，调用成功表示任务已进入队列，应继续通过 `get_download` 判断最终结果。

请求处理期间若任务 URL 被其他客户端修改，返回 `download_changed`。应重新查询任务、确认 URL，再提供与该 URL 对应的凭证。HTTP 编辑接口更新请求头时，同样会替换任务内存中的凭证；只修改 URL 而未提供新请求头时，会清除旧请求头和凭证，需要认证的任务须补充新凭证才能再次启动。

### get_download

输入 `{"id":101}`，返回下载对象。ID 限制与 `start_download` 相同。

### list_downloads

输入参数：`current` 默认 1，范围 1–1000000；`pageSize` 默认 50，范围 1–100；`filter` 默认为 `all`，允许 `all`、`done`、`list`，空字符串兼容为全部。

`done` 筛选数据库中成功的任务，`list` 筛选其他任务；输出对象中的状态会结合运行快照。记录按创建时间和 ID 倒序排列。

返回 `total`、`list`、`current`、`pageSize`、`hasMore`。没有记录时 `list` 为 `[]`。未知筛选值直接报错。

### stop_download

输入 `{"id":101}`，ID 限制与 `start_download` 相同。

```json
{
  "id": 101,
  "status": "stopping",
  "accepted": true
}
```

`accepted: true` 表示接受了停止请求，不表示进程和文件收尾已经完成。等待中的任务可立即变成 `stopped`；执行中的任务可能先返回 `stopping`。应继续查询 `get_download`。直播录制停止后若成功完成文件收尾，最终状态可以是 `success`。

对于已经不在队列中的任务，返回当前状态和 `accepted: false`，不会伪造一次停止操作。

### discover_media

| 参数                | 类型    | 必填 | 约束与默认行为                                                         |
| ------------------- | ------- | ---- | ---------------------------------------------------------------------- |
| `url`               | string  | 是   | 与创建下载相同的 HTTP(S) URL 限制                                      |
| `mode`              | string  | 否   | `auto`、`browser`、`inspect`，默认 `auto`                              |
| `timeoutMs`         | integer | 否   | 浏览器执行超时，3000–30000，默认 20000                                 |
| `useSessionCookies` | boolean | 否   | 默认 `false`；显式选择复用桌面端登录会话，需要可用的桌面端浏览器执行器 |
| `waitSeconds`       | integer | 否   | 0–25，默认 20；0 表示创建后立即返回                                    |

`auto` 对 `.m3u8` URL 使用 HLS 检查器，对其他 URL 使用浏览器嗅探。`inspect` 使用 HLS 检查器；`browser` 需要 Electron 执行器。登录会话只支持浏览器嗅探；需要登录态的直接 HLS 地址应显式选择 `mode: "browser"`，检查器模式不会静默忽略登录会话选项。`waitSeconds` 控制浏览器任务创建后的轮询等待，不会改变任务执行超时；HLS 检查在创建调用中同步执行。

返回发现任务：`id`、`input`、`status`、`sources`、`partial`、`createdAt`、`expiresAt`，以及可选的 `startedAt`、`completedAt`、`errorCode`、`error`。

`status` 为 `pending`、`running`、`completed`、`failed` 或 `cancelled`。发现任务执行失败仍会返回可查询的任务对象，应读取任务状态和错误码。`sources` 中每项包含 `id`、`url`、`pageUrl`、`title`、`type`、`detectedAt`；HLS 信息可能还包含 `playlistType`、`maxQuality`、`variants`。每个变体包含 `url` 和可选的清晰度、宽高、带宽、编码信息。

### get_media_discovery / cancel_media_discovery

输入 `{"id":"<discovery-id>"}`，ID 长度 1–128 字符。前者查询任务，后者取消排队或运行中的任务，都返回上述发现任务对象。

发现结果只在内存保留，终态后约 10 分钟过期；重启后失效。

### download_discovered_media

必填 `id` 指定发现任务。`sourceIds` 和 `selections` 必须二选一，数量均为 1–20，不能重复选择同一资源。

简单选择：

```json
{
  "id": "<discovery-id>",
  "sourceIds": ["source-a", "source-b"],
  "startDownload": false
}
```

选择 HLS 清晰度或文件名：

```json
{
  "id": "<discovery-id>",
  "selections": [
    {
      "sourceId": "source-a",
      "variantUrl": "https://cdn.example.com/720.m3u8",
      "name": "lesson-720p"
    }
  ],
  "folder": "courses",
  "startDownload": true
}
```

`variantUrl` 必须是该资源原始 URL 或 `variants` 已公布的 URL。省略时使用原始资源。客户端不能向任意 URL 转交嗅探凭证。`name` 最多 255 字符；`folder`、`downloadDir`、`startDownload` 与创建接口规则相同。

只接受已经完成，或已经失败但保留了部分资源的发现任务。所有选择先完成验证，再创建下载。

响应为 `{ "items": [...] }`，输入与输出顺序对应，每项包含：

| 字段         | 含义                                            |
| ------------ | ----------------------------------------------- |
| `sourceId`   | 输入资源 ID                                     |
| `outcome`    | `created`、`existing` 或 `failed`               |
| `downloadId` | 已创建或已有的任务 ID；即使后续启动失败也会保留 |
| `download`   | 能读取到时提供完整下载对象                      |
| `error`      | 该项失败时提供统一错误结构                      |

批量请求通过验证后，逐项执行。取消调用会中止当前项尚未完成的创建和后续项，已创建的任务会保留；已入队任务仍需单独停止。部分或全部项执行失败时，顶层 `isError` 仍为 `false`，调用方必须检查每项 `outcome`；请求验证失败、发现任务不存在等整体错误使用 `isError: true`。

重复 URL 返回 `existing` 和已有 ID，不再静默跳过。已有任务不会自动重启；重新嗅探取得的私密请求头可刷新对应任务的内存凭证，随后显式调用 `start_download`。

## 凭证生命周期

MCP 新建下载和发现交接只持久化安全请求头白名单：User-Agent、Referer、Origin、Accept、Accept-Language、Accept-Encoding、Range。Cookie、Authorization、Proxy-Authorization 及其他自定义头只保存在任务内存中，不出现在 MCP 响应里。历史任务中已经保存的头不会因为此次升级被删除，但同样不会通过 MCP 返回。

临时请求头与任务 ID 及资源 URL 绑定，保留 10 分钟；修改资源 URL、任务删除、过期或服务重启后不能继续复用。最多保存 1024 个任务的临时头，超限会淘汰最早过期的条目。已经进入下载队列的工作项继续使用启动时取得的头；过期规则作用于后续启动和重试。

延迟启动超过保留时间，或服务重启后，带有凭证要求的任务返回 `credentials_expired`，不会悄悄变成匿名下载。可以重新嗅探并交接相同资源，再调用 `start_download`；也可以在 `start_download.headers` 中提供新凭证。

## 从原协议升级

- 工具名保留，新增 `get_capabilities` 和 `start_download`；`create_download` 新增可选 `startDownload`。
- `download_discovered_media` 的数组响应改为 `{ items: [...] }`，调用方应逐项处理结果。
- 下载响应不再返回 `headers`、数据库 `outputPath`；使用 `file`、`files`。空目录统一为 `folder: ""`。
- 创建相同 URL 返回已有任务，不再只抛出重复错误。批量结果不会省略重复项。
- `stop_download` 不再保证立即返回 `stopped`，应识别 `stopping` 并查询最终状态。
- 参数范围和枚举严格校验，不再静默接受未知筛选值或截断越界等待时间。
- 错误通过结构化 `error.code` 判断，不应再解析旧的纯文本错误消息。
- 桌面端允许任务覆盖下载根目录；Docker/server 继续使用配置的根目录，可通过 `folder` 选择其内的子目录。
