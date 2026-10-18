# DEV-20261018-02 · 独立多人 fork 与上游自动同步

## 基本信息

- 开始 / 最后更新：2026-10-18 / 2026-10-18，Asia/Shanghai。
- 类型：维护工具、调查；状态：fork、自动同步工具与远程启用验证完成；首次合并冲突已记录，0.3.1 适配仍待处理。
- 起始分支：feat/IncreasePlayerCapacity；HEAD：d7d541e73b307500c024c06feef8fcd1f0cd6248。
- 来源：LongQianChen/Stronghold-Protocol；维护仓库：Xiaofu0726/Stronghold-Protocol。
- 本次核对的作者 master：4dfcdd779d079bdaec77e2deec853d23934ec758（0.3.1）。
- 提交归属：与本文同一提交，按记录路径查询。

## 需求与范围

用户要求自己 fork 一版，以 LongQianChen 多人分支为基础，并随作者 master 更新。创建 GitHub fork，建立独立本地目录和自动同步流程；自动更新以无合并冲突和验证通过为前提。没有授权部署服务器，也不把未完成适配的版本标成已升级。

## 调查与操作

- GitHub 使用当前已登录的 Xiaofu0726 账号创建 fork，parent 为 LongQianChen；保留所有分支，默认分支选多人分支。
- GitHub 网络克隆一度连接失败，改为从现有本地多人仓库独立复制已提交历史（无硬链接），origin 指向新 fork，upstream 指向作者；原有两个目录和原先未提交调查文档不动。
- 独立本地目录：D:\Codes\Stronghold-Protocol-20p。
- 自动同步每小时检查作者 master；合并并运行 CI/golden 后才推送，远程分支并发变化时拒绝发布，不强推。合并冲突或验证失败保留已有分支，在单个 Issue 记录待处理事项；相同冲突不重复修改 Issue。
- [工具说明](../AUTO_SYNC.md) 与工作流列出触发、凭据、验证与限制。

## 实际验证

- Node.js v24.19.0 / Windows：`node --test .github/scripts/upstream-sync.test.js`，4 项通过，0 失败。验证已同步不变、保留双方改动和两个父提交、冲突列出并自动 abort、拒绝脏工作区并保留文件。
- 真实二十人分支的合并预检：53 个冲突文件；已自动中止，HEAD 保持 d7d541e7，工作区干净。预检未执行 npm install、CI、golden，因为尚未得到可运行的合并结果。
- 这 53 个冲突包含大厅/协议、分组轮选、插件相关对局和客户端代码，不能用整文件 ours/theirs 保证正确。

## 结果与遗留

首次 0.2.6 → 0.3.1 适配未完成，需按 UPSTREAM.md 与 DECISIONS.md 逐项结合并验证。该事实不影响建立自动检查与冲突报告机制；冲突解决前维护分支继续使用原有 0.2.6 多人玩法。

本任务不自动部署、下载游戏素材或发布发行包。远程 Actions、Issue 与提交以仓库实际记录为准；GitHub schedule 可能延迟或因长期无活动停用。

## 远程执行证据

- 工具提交：2cbfda879b3ac136851a3012d900b3b8ff882d89。
- 仓库默认分支已设为 feat/IncreasePlayerCapacity，Actions 的 Sync upstream master 状态为 active，Issues 已启用。
- [首次远程执行](https://github.com/Xiaofu0726/Stronghold-Protocol/actions/runs/39123574666)：completed / success；Linux 上四项同步行为测试通过，真实合并检测到冲突，并正确创建待处理事项。
- [冲突清单 Issue #1](https://github.com/Xiaofu0726/Stronghold-Protocol/issues/1) 已生成；安装、合并代码 CI/golden 与发布步骤因冲突跳过。工作流成功表示冲突处理机制工作正常，不表示上游已经合并。
- 当前玩法版本仍为 0.2.6。未部署服务器、未下载素材、未发布发行包。
