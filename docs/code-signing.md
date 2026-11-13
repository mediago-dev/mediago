---
layout: doc
outline: deep
---

# 代码签名政策（Code signing policy）

更新日期：2026 年 11 月 13 日。

## 当前状态

MediaGo 已获准加入 [SignPath Foundation](https://signpath.org/) 开源项目计划，但项目中的正式签名证书尚不可用，**公开 Windows 发布尚未启用 SignPath 签名**。测试签名实现保留在独立的 [codex/signpath-integration 分支](https://github.com/mediago-dev/mediago/tree/codex/signpath-integration)，用于继续接入和验证。当前公开 Windows 安装包以及包括 3.6.0-beta.1 在内的已有未签名版本仍然未签名；测试签名包不进入正式版或 beta 更新渠道。macOS 的签名与公证是独立流程。

首次提供签名版时，下载页和发布说明会标明首个签名版本、核实后的发布者身份和验证方法。签名不代表软件不存在缺陷。

## 来源与发布审批

签名产物必须能追溯到 [mediago-dev/mediago](https://github.com/mediago-dev/mediago) 中经过审查的源码，以及 GitHub 托管构建产生的产物。生产签名和发布由人工维护者批准，自动维护任务不担任生产签名批准人。

项目维护者及首位发布审批联系人为 [caorushizi](https://github.com/caorushizi)。提交和审查由仓库授权维护者负责；签名角色需要明确分配，担任签名角色者必须在 GitHub 和 SignPath 启用 MFA。构建与签名流程的改动同样需要审查。

## 范围与验证

项目签名策略仅处理批准的 MediaGo 应用及安装产物。打包的第三方工具保留上游来源和许可证，不因被打包就变成 MediaGo 编写的程序，也不表示所有文件均有 MediaGo 签名。参见[第三方声明](https://github.com/mediago-dev/mediago/blob/master/THIRD_PARTY_NOTICES.md)。

后续 Windows 签名流程需要在发布前验证真实的 Authenticode 发布者、时间戳和最终产物，并让更新校验拒绝未签名、被修改或其他发布者的安装包。不虚构发布者、不绕过验证、不把测试签名当作公开受信任签名。旧版未签名客户端需要明确的首次可信安装迁移说明。

## 隐私与联系

[隐私政策](./privacy.md)：TalkingData 使用统计是可选项，签名审批不代替用户同意统计。

签名相关问题请联系 [84996057@qq.com](mailto:84996057@qq.com)，不要发送私钥、证书密码或 Token。在服务获批且实际发布签名包后，才会按照[基金会条件](https://signpath.org/terms)添加相应署名。
