# 创建房间 Key 与服务器管理

20 人分支的创建权限：创建同盟和开启独立模拟（含测试模式、各期玩法）都必须提供有效 Key。
原有四位房间号加入、观战和房主确认加入者身份的流程不变；加入者不需要 Key。
Key 不决定加入者身份，不限制同一 Key 创建房间的次数，原有房间数量及网络限流仍然生效。

## 安装管理命令

代码部署到服务器后，以 root 执行一次（测试服可替换仓库路径）：

```bash
bash /opt/stronghold-20p/tools/install-room-keys-command.sh
stronghold-keys create "群友小明"
stronghold-keys list
```

安装器要求已有运行游戏的 stronghold 用户组及 Node.js、flock，安装命令
`/usr/local/bin/stronghold-keys`。命令绑定安装时的仓库路径；不要在同一服务器从两个仓库重复安装同名命令。
命令自身不启动、停止或重启游戏，不修改已有服务及自动更新定时器。
首次安装会建立 root:stronghold 的配置目录，Key 文件仅 root 可写、stronghold 组可读。

**新代码启动后，没有有效 Key 就不能创建任何新房间。部署时先准备管理命令与至少一个 Key，再开放创建。**
可以先上传本分支的 `server/access/roomKeys.js`、`tools/room-keys.mjs`、
`tools/install-room-keys-command.sh` 三个文件到原仓库对应路径，安装和生成 Key 后再更新游戏代码；
或者在维护关服期间完成代码更新、命令安装和 Key 创建，再启动服务。

## 常用命令速查

| 用途 | 命令 |
|---|---|
| 创建 Key，只需填写备注 | `stronghold-keys create "群友小明"` |
| 列出全部 Key、备注和状态 | `stronghold-keys list` |
| 按 Key 本体删除 | `stronghold-keys delete '实际的12位Key'` |
| 查询所有房间和真人昵称 | `curl -fsS http://127.0.0.1:3003/ops/players \| python3 -m json.tool` |
| 查看正式服状态 | `systemctl status stronghold-20p --no-pager` |

创建时自动生成区分大小写的 12 位随机 Key，由字母、数字、下划线和连字符组成；服务器仅通过
本机管理命令输出原始 Key，不通过管理接口返回。将生成结果的 `key` 发给对应群友即可，`id` 是独立的管理编号。
备注需为 1–200 个字符，备注含空格时使用引号。删除输入的不是编号或备注，而是原始 Key。
删除不存在的 Key 会报错，不修改配置。修改命令串行执行，配置通过同目录临时文件原子替换。

创建、删除即时生效，每次创建房间都会重新读取配置；**不需要重启游戏**。
删除 Key 不会解散既有房间或中断既有对局，也不妨碍别人通过房间号加入已存在的房间。
现有房间保留创建时的 Key 编号和备注，删除后仍可查到这项关联。

## 配置、备份和浏览器缓存

默认配置是仓库外的 `/etc/stronghold/room-keys.json`，格式为：
`{ "version": 1, "keys": [...] }`。不要放入 Git 或 public 目录，也不要把真实配置作为示例提交。
配置文件权限为 root:stronghold 0640，目录为 0750。正常代码更新不会覆盖它；
备份服务器时需另外保存该文件及目录权限，代码仓库备份不包含它。

如有必要自定义路径，服务器服务环境和安装命令必须同时设置同一个绝对路径 `SP_ROOM_KEYS_FILE`。
例如安装命令使用 `SP_ROOM_KEYS_FILE=/etc/stronghold/room-keys-test.json bash .../tools/install-room-keys-command.sh`，
对应 systemd 服务也设置相同环境变量，再执行 daemon-reload 并重启。
正式服和测试服未单独设置时共用默认 Key 文件。文件缺失、无权限、格式错误或无有效 Key 时都拒绝创建，
不会回退成免 Key 模式。`enabled: false` 的条目不允许创建，管理命令默认生成启用条目。

浏览器在首次成功创建后使用 localStorage 保存 Key，下次创建自动提交缓存，不重复弹框。
服务端仍然每次验证；缓存的 Key 被删除或停用时，清空缓存并提示重新输入。
切换域名、端口、浏览器或使用无痕模式不会共享缓存，清理网站数据也会清除 Key。
手动清除当前浏览器缓存可在该网站控制台执行：

```js
localStorage.removeItem('sp.pref.roomCreationKey');
```

## 管理接口与名单

`GET /ops/players` 返回所有尚存在的房间，包括单人、等待开局和对局中的房间：

```json
{
  "onlinePlayers": 2,
  "lobbyPlayers": 1,
  "waitingRoomPlayers": 0,
  "inMatchPlayers": 1,
  "rooms": [{
    "code": "1234",
    "mode": "coop",
    "inMatch": true,
    "key": { "id": "k_012345abcdef", "remark": "群友小明" },
    "players": [
      { "name": "小明", "connected": true, "role": "player", "host": true },
      { "name": "小红", "connected": false, "role": "player", "host": false }
    ]
  }]
}
```

真人内部按玩家 ID 去重，输出只含昵称及在线/观战/房主标记，**不输出玩家 ID、不列出或统计 AI**。
同名但身份不同的真人保留为多行。房间名单包含仍保留席位的离线真人，不包含已离开或被移除的人。
观战者的 `role` 为 `spectator`，正常席位为 `player`；真人断线托管仍是正常真人席位。
已销毁的房间不会保留历史；服务重启后，房间和房间关联随原有内存状态一起清空。
旧有未绑定 Key 的房间（若在同一进程内存在）返回 `key: null`。

四个汇总人数均只统计在线真人。`lobbyPlayers` 包含未进入房间和正在未开局房间中的人，
`waitingRoomPlayers` 是其中已在未开局房间内的子集；`inMatchPlayers` 包含进行中对局的观战者。
`onlinePlayers = lobbyPlayers + inMatchPlayers`；离线占位仅列在房间名单中，不计在线人数。

接口沿用现有本机/内网客户端地址限制，拒绝识别为公网来源的请求，不缓存响应。
反向代理必须正确覆盖真实客户端地址头；代理若不传真实地址，应在代理层阻断公网访问此路径。
接口只返回 Key 的编号和创建时备注，**不返回原始 Key**；Key 的原文查询只有 root 管理命令提供。

## 合并上游时的接线

Key 文件及命令安装在仓库外，不由 master 更新管理。分支新增独立的服务端 Key 模块、前端 Key 弹框模块和命令工具。
原有大厅只替换创建请求调用；协议仅增加一个可选字段 `creationKey`；
服务端在所有创建的统一入口校验并在成功创建时绑定元数据；不修改加入、观战或战斗逻辑。
管理编号和备注使用 WeakMap 存在服务端，既不广播给房间玩家，也不进入插件或版本对局子进程。
