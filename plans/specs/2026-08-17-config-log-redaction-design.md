# Configuration Log Redaction Design

**日期：** 2026-08-17
**范围：** Core 与 Electron 配置日志中的敏感值保护

## 1. 背景与根因

项目当前有四条配置日志会记录原始值：

1. 启动时使用 `%+v` 打印完整 `AppConfig`，其中 `Proxy` 可以包含用户名和密码。
2. `POST /api/config` 使用 `zap.Any` 打印完整更新请求，其中可能包含 `proxy`、`apiKey`、`mcpToken`、`passwordHash` 或未来新增的敏感配置。
3. `proxy` 配置变更监听直接打印新的代理字符串。
4. Electron WebView 启用代理时把规范化后的完整代理地址写入持久化日志。

四处问题的共同根因是配置日志把完整配置对象、任意更新值或可能携带凭据的代理值当作可安全输出的数据。依赖敏感字段黑名单会遗漏未来字段，因此这四个配置日志入口的安全边界应改为：不记录完整配置对象或任意 API 更新值，也不记录代理值。`maxRunner`、布尔开关、目录等代码明确选择的非敏感运行元数据可以继续记录；下载器命令日志的既有契约不变——不得记录代理凭据，但可以记录不含凭据的代理地址。

## 2. 目标

- 启动、批量更新、运行时代理更新和 Electron WebView 日志均不包含代理或任意 API 更新值。
- 批量更新日志保留客户端 IP 和排序后的变更键名，便于排障且输出稳定。
- 配置写入、运行时同步、SSE 广播和 API 响应行为保持不变。
- 使用行为测试捕获真实 Zap 日志，验证代表性的秘密值不会进入日志。

## 3. 非目标

- 不改变配置 API 的鉴权、响应或事件广播模型。
- 不修改配置文件在磁盘上的存储方式。
- 不复用下载器 argv 脱敏逻辑；日志应从源头避免接收配置值，而不是先写入再遮盖。
- 不移除现有的非敏感运行元数据日志。
- 不改变下载器命令参数日志现有的凭据脱敏契约。
- 不处理与配置日志无关的 UI、Playwright 或下载流程。

## 4. 方案

采用无值日志：

- 删除完整 `AppConfig` 启动日志，保留已有的启动消息及后续目录、Schema、队列等非敏感运行状态日志。
- 将批量配置更新日志的 `req` 字段替换为排序后的 `keys` 字段，同时保留 `clientIP`。
- 将代理变更日志改为固定消息，不包含新值或旧值。
- 将 Electron WebView 的“规范化代理、调用 `session.setProxy`、写日志”提取为一个小函数。函数只接收 Session 的 `setProxy` 和 logger 的 `info/error` 所需最小接口；WebView service 委托给它，启用代理日志改为固定消息，传给 Electron Session 的 `proxyRules` 保持不变。

不采用敏感字段黑名单，因为新增字段时容易漏标；也不保留代理 scheme、host 等元数据，因为解析失败或特殊 URL 形式会扩大安全和测试分支。

## 5. 测试设计

Core 测试使用 `zaptest/observer` 临时替换项目全局 logger，并在清理阶段恢复，直接检查生产代码发出的日志。检查范围必须同时包含 `Entry.Message` 与全部结构化字段，不能只搜索消息文本。

### Runtime 日志

- 使用临时目录中的不存在 Schema 路径创建最小 `Runtime`，明确覆盖现有内置 Schema fallback。
- 启动配置的代理包含唯一测试凭据，断言完整日志不包含该值。
- 通过真实 `AppStore.Set("proxy", value)` 触发已注册监听，断言配置仍被更新、固定更新消息存在，同时日志不包含新代理或凭据。

### 配置 API 日志

- 使用 Gin recorder、轻量 `ConfigStore` fake 和真实 handler 提交包含 `proxy`、`apiKey`、`mcpToken`、`passwordHash` 的批量更新。
- 断言请求仍成功传给 store。
- 在旧实现上，`req` 结构化字段中的秘密值必须使测试失败。
- 修复后断言不存在 `req` 字段，`keys` 精确等于排序后的键名，并保留客户端 IP。
- 断言 `Entry.Message` 和所有结构化字段均不包含任一测试值。

### Electron WebView 日志

- 使用现有 Vitest 环境直接调用 WebView service 委托的生产代理函数，并注入只实现最小接口的 Session 与 logger fake；不实例化 WebView service，不启动 Electron，也不触发 blocker 或 sniffing 副作用。
- 用带唯一测试凭据的代理调用 `setProxy(true, proxy)`。
- 断言 `session.setProxy()` 仍收到完整、规范化后的 `proxyRules`，而 logger 只收到固定消息且不包含代理或凭据。

测试失败消息只报告字段名，不回显秘密值。

## 6. 验收标准

1. 四个已确认的配置日志入口都不再记录完整配置对象、任意 API 更新值或代理值。
2. 运行时配置同步和 API 更新行为保持不变。
3. 聚焦测试先在旧实现上因秘密值可见而失败，修复后通过。
4. `go test ./...`、现有 TypeScript 测试和 `pnpm check` 通过。
5. 变更作为独立 Conventional Commit 使用指定账号提交并推送当前分支，不合并分支。
