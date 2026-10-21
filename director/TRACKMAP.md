# 轨迹图（trackmap）

新看板 id：`trackmap`（导播台下拉里叫「轨迹图」）。**原来的「赛道图」圆环 `ring` 未改。**

## 数据

1. **优先** `/api/state` 里的 `carPositions`（Java 解析官方 livetiming `Position.z`）
2. **否则** 浏览器直连 [OpenF1](https://openf1.org/) `/v1/location`（与 Position.z 同一赛道坐标系）
3. 仍无点时：显示本地赛道 SVG 底图 +「等待位置数据」

## Java Position.z

- 当前分享包内的 `share/F1-RaceControl-Desktop.jar`（0.1.15）已含 Position / 轨迹图所需接口能力
- 上游注释：`Position.z` 有时需要 F1TV/会话放开；无权限时订阅仍安全，只是 `carPositions.updatedAt` 为 0
- 网页在官方无点时自动用 OpenF1，不挡用

用本仓库自带的 jar 启动即可；若换成未含 Position 的上游原版 jar，轨迹图仍可走 OpenF1。

## 底图

`web-override/circuits/*.svg` 来自 [f1db](https://github.com/f1db/f1db)（CC BY 4.0），仅作无坐标时的示意；有坐标后以点云/轮廓为准（与 SVG 不做强制对齐，避免错位）。

## 自测

1. `director/Start.cmd` 发布后打开导播台，加一块「轨迹图」或打开 `http://127.0.0.1:8720/board/trackmap?once=1`
2. 有场次信息（如 Singapore / Race）时，应看到 OpenF1 历史快照车点；正赛直播时应标「OpenF1 实时」
3. 若 jar 已含 Position.z 且流里有数据，状态会变成「官方 Position.z」
4. `node --check director/web-override/app.js`

## 回放

`.rclog` 若录制时未订 `Position.z`，官方坐标仍空，轨迹图会按场次名尝试 OpenF1（需能上网）。
