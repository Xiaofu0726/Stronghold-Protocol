# 两分支上游同步

本 fork 只保留两个远程分支：

- `master` 精确指向 `sganggs/Stronghold-Protocol:master` 的提交，不添加本仓库自己的提交或文件。
- `feat/20-player-rooms` 保存上游内容、[20 人扩展](PLAYER_CAPACITY.md)及维护这项扩展的测试、文档和同步工作流。

另按服主要求保留一项界面定制：部署期间不自动拉近镜头，结束时也不触发镜头恢复；商店临时收起及手动镜头切换保持原行为。这项差异适用于所有房间容量，由镜头回归测试随同步验证。

默认分支是 `feat/20-player-rooms`。GitHub 的 schedule 只从默认分支运行，因此自定义工作流放在这个分支，避免污染镜像 master。
它不是继续自动合并 LongQianChen 分支的新功能；该分支只用作最初的扩容参考，后续只跟踪 sganggs/master。

## 每小时的动作

[Sync upstream master](../.github/workflows/sync-upstream.yml) 每小时第 17 分钟尝试执行，避免整点排队；也可在 Actions 页面手动运行。
同一时间只允许一个同步任务，正在运行的验证不会被新的定时事件中断。

1. 获取上游 master 和本仓库两个分支的最新提交。
2. 使用带旧 SHA 保护的引用更新，使本仓库 master 与本次获取的上游提交严格相同。上游若重写历史，镜像分支也跟随，但扩容分支暂停自动合入并报告需要手动 rebase。
3. 在临时 checkout 合并 master 到扩容分支；有文本冲突时退出合并，不更新远程扩容分支。
4. 先检查相对 master 的差异文件白名单；战斗引擎、数据、依赖、网络及缓存等不能多出分支私有差异。
5. 安装依赖，执行四人同输入差分、1–20 人扩容和界面回归、文档检查、288 个黄金场景、lint/import/typecheck 与严格翻译检查。
6. 验证成功后，确认 master 和扩容分支没有被别人并发更新，再快进推送扩容提交。没有新上游提交时通常不产生提交、不重复跑完整验证；手动运行以及仍有自动同步 Issue 时会验证。

GitHub 对定时任务可能排队或延迟；公共仓库长期无活动时平台还可能停用 schedule。这是“每小时尝试”的平台调度，不是精确到秒的常驻服务。

## 冲突与失败 Issue

合并冲突、差异超出白名单、四人行为变化或验证失败都会创建或更新一个带 `[upstream-sync]` 前缀的 Issue。
Issue 列出目标上游 SHA、扩容 SHA、失败阶段、冲突文件及运行日志。上游 SHA、扩容分支 SHA、失败阶段与冲突文件集合相同时，后续每小时重试不新建 Issue、不更新正文，也不追加评论；运行日志地址、报错文本和文件列出顺序变化不会触发重复通知。上述冲突状态发生变化时更新原有未关闭 Issue，其他相同失败也不会重复刷新无变化的内容。
master 已同步成功时，即使扩容合并失败也保持镜像更新；扩容分支则停留在上次成功版本。问题解决并通过验证后自动关闭 Issue。

处理冲突时：

```sh
git fetch origin
git switch feat/20-player-rooms
git merge origin/master
# 编辑冲突文件，只保留 20 人扩展及其维护内容
git add <已解决的文件>
git commit
git push origin feat/20-player-rooms
```

随后手动运行 Sync upstream master，或等待下一次定时检查。请把自定义开发提交放在扩容分支，不要写入镜像 master。
扩容新增文件确有必要时，审阅后同步更新 `tools/upstream-sync-scope.json`；白名单只限制变更文件，四人差分和回归测试负责补充行为检查，仍不能替代所有未来规则变动的人工审查。

## 实现与验证

- 工作流：`.github/workflows/sync-upstream.yml`。
- 执行器：`tools/sync-upstream.mjs`，分为 prepare / verify / publish / report。
- 集成测试：`test/sync-upstream.test.js` 使用临时真实 Git 仓库，验证镜像、干净合入、冲突保留、范围拦截、验证失败、并发保护、历史重写和 Issue 去重恢复。
- master 不包含此说明、同步执行器和自定义工作流；这些都是扩容分支的维护文件。
