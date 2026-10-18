# 多人 fork 的上游自动同步

维护仓库：[Xiaofu0726/Stronghold-Protocol](https://github.com/Xiaofu0726/Stronghold-Protocol)。基于 LongQianChen 的 `feat/IncreasePlayerCapacity`，保留其多人功能；默认维护分支也是 `feat/IncreasePlayerCapacity`。

同步来源始终是作者 **sganggs/Stronghold-Protocol 的 master**，不是 LongQianChen 的 master。此流程不自动追踪 LongQianChen 多人分支后续的新功能。

## 运行方式

[工作流](../../.github/workflows/sync-upstream.yml) 每小时 UTC 的第 17 分钟检查一次，换算为北京时间也是每小时第 17 分钟；实际启动可能排队延迟。可以在 Actions → Sync upstream master → Run workflow 手动执行。

1. 获取作者 master 的提交；若已包含，不改分支。
2. 在临时 runner 中合并，保留双方历史。不使用强推或整文件 ours/theirs。
3. 有冲突时中止临时合并，创建或更新一个待处理 Issue，列出冲突文件；相同基线与上游的重复冲突不重复发通知。
4. 无冲突时安装合并后的依赖，运行 `npm run ci` 和 `npm run golden`。测试不需要下载游戏素材；浏览器套件显式关闭。
5. 全部通过且远程维护分支没有被其他操作推进，才将合并提交推送到维护分支。失败则创建或更新待处理 Issue。
6. 同步成功，或后续发现上游提交已经被人工合入时，关闭旧的待处理 Issue。

推送使用该仓库的 GITHUB_TOKEN，仅对应步骤获得令牌；测试安装步骤不显式传入它，checkout 不持久化凭据。工作流自身已执行 CI/golden，不依赖自动推送再触发另一遍 CI。

## 冲突如何处理

自动同步不能替代语义适配。按 [上游同步流程](UPSTREAM.md) 和 [分支决定](DECISIONS.md) 逐项结合插件系统与二十人玩法，验证后把结果推送到维护分支，再重跑同步工作流。

2026-10-18 首次检查：多人基线 `d7d541e73b307500c024c06feef8fcd1f0cd6248`，作者 master `4dfcdd779d079bdaec77e2deec853d23934ec758`，有 **53 个冲突文件**。本次人工适配见 [DEV-20261018-03](records/2026-10-18-03-upstream-v031.md)；验证后合入维护分支并重跑工作流，确认作者提交已包含后关闭冲突 Issue。

## 运行边界

- 定时检查是轮询，不会在作者每次 push 的瞬间运行。GitHub Actions 的 schedule 需要工作流位于默认分支并处于启用状态。
- GitHub 对长期无活动的公共仓库可能停用定时工作流；若停用，在 Actions 中重新启用。本地电脑无需开机。
- Issue 的邮件或应用提醒由你的 GitHub 通知设置决定；没有冲突或失败时不新增消息。
- 源码同步不自动部署服务器、不下载/更新游戏素材，也不发布发行包。浏览器体验与真人压力测试仍需单独验证。
- 将来上游重写历史、移除命令或引入无法兼容的玩法时，流程可能停在待处理 Issue，不承诺每个版本都能自动合入。

## 维护测试

```text
node --test .github/scripts/upstream-sync.test.js
```

该测试使用临时 Git 仓库验证已同步、无冲突合并、冲突回退与保留未提交文件。不会访问 GitHub。
