# 可选固定盟约模式（本 fork 扩展）

插件的自定义模式记录可配置：

```json
{
  "id": "mode_x_example_fixed",
  "base": "mode_multi_normal",
  "set": { "bandDraft": { "fixedBandId": "band_ducklord" } }
}
```

只影响选择了这条模式记录的对局。INFO_CHECK 结束后，所有参赛者（含 AI）获得指定盟约及其初始生命值，
直接进入 BATTLE_CHECK。同组允许重复盟约；后续机变、战斗和结算照常运行。单人、四人和二十人共用此逻辑。
盟约必须存在且支持模式的 SINGLE/MULTI 类型，否则内容组合校验拒绝加载。

未配置该字段、未启用插件或选择原版模式时，仍调用原有选盟约方法，不额外消耗随机数。
配置只从当前模式读取，不继承为全局默认值。插件房间的内容隔离仍由现有 content set 负责。

实现集中在 `shared/plugins/modeBand.js`（解析及校验）、`server/match/modeBand.js`（开局分配）。
既有代码只增加 Match 安装入口及模式校验入口；普通战斗的 `onBattleStart` 事件另提供 `routes`，
与 Boss 事件一致，供插件在怪物不足时选择有效地面路线。插件应读取路线，不修改路线表。
合并上游时，检查安装入口仍位于容量扩展之后，并运行 `test/match/mode-band.test.js` 及四人差分检查。

该字段是本 fork 的可选扩展，上游原版尚不支持；插件的 app 版本范围不能代替宿主能力检查。
默认玩法没有有意改变，也不修改任何 golden 基线。
