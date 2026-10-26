# CIRCUIT_PHASE 离线校准

导播台运行时只读这里写进 `app.js` 的数字。不请求 MultiViewer，也不请求 OpenF1。

方格旗仍是 `paintTrackmapFinish`：进度 0 上的 4×2 小格，格子大约一条描边那么宽。`offset` 把进度 0 转到计时线之后，旗就出现在计时线上。比赛方向箭头（`paintTrackmapDir`）沿同一条定向弧、在旗后不远处画一枚小三角，不再另做一套方向。

重算（需要本机缓存，不进 CI）：

```text
node director/calibrate-circuit-phase.js --cache /tmp/mv
```

缓存文件是 `GET https://api.multiviewer.app/api/v1/circuits/{circuitKey}/{year}` 的 JSON。`--fetch` 才会联网。

## 做法

1. 用 `outlineFromSvg` 采样 SVG，再把 y 取负，和 `loadSvgOutline` 一样。存进 `CIRCUIT_PHASE` 的比例按运行时的 `curveSteps = 4` 折线量。
2. MultiViewer 折线按弧长重采样成 400 点。在 flipY、反向、圆周移位上做 Umeyama 相似变换（平移、旋转、均匀缩放）。
3. `marshalLights` 里 `length ≈ 0` 的点投到 SVG 折线上，最近点的弧长比例就是原始 offset。`reverse` 表示比赛方向和文件方向相反；为 true 时 offset 在掉头之后再量。
4. 赛段：优先用 FIA 比赛笔记里的赛段中心线公里数，沿 MultiViewer 中心线走到对应比例，再投回 SVG。没有公里数、但图例写了「弯前/弯后多少米」时，用弯心在中心线上的位置加减这段距离。投影和距离比例差过 0.03，或者落点离开折线，就不写 `sectors`，运行时仍三等分。

「year」是选中那条轨迹 JSON 里的 `year` 字段。较新的 URL 年份经常回落到同一条轨迹；同一条赛道有多条轨迹时，取得和 SVG 残差最小的一条。

残差是变换后的均方根，除以 SVG 周长。奥斯汀大约 0.64%。高于大约 4%，或正反方向几乎分不出好坏，就整条跳过。

## 键

| SVG | MultiViewer | circuitKey |
| --- | --- | --- |
| bahrain-3.svg | Sakhir | 63 |
| jeddah-1.svg | Jeddah | 149 |
| melbourne-2.svg | Melbourne | 10 |
| suzuka-2.svg | Suzuka | 46 |
| shanghai-1.svg | Shanghai | 49 |
| miami-1.svg | Miami | 151 |
| imola-3.svg | Imola | 6 |
| monaco-6.svg | Monte Carlo | 22 |
| montreal-6.svg | Montreal | 23 |
| catalunya-6.svg | Catalunya | 15 |
| spielberg-3.svg | Spielberg | 19 |
| silverstone-8.svg | Silverstone | 2 |
| hungaroring-3.svg | Hungaroring | 4 |
| spa-francorchamps-4.svg | Spa-Francorchamps | 7 |
| zandvoort-5.svg | Zandvoort | 55 |
| monza-7.svg | Monza | 39 |
| baku-1.svg | Baku | 144 |
| marina-bay-4.svg | Singapore | 61 |
| austin-1.svg | Austin | 9 |
| mexico-city-3.svg | Mexico City | 65 |
| interlagos-2.svg | Interlagos | 14 |
| las-vegas-1.svg | Las Vegas | 152 |
| lusail-1.svg | Losail | 150 |
| yas-marina-2.svg | Yas Marina Circuit | 70 |

## 写入 app.js 的数

offset / reverse / sectors 是运行时用的值。奥斯汀的 offset 不是这次投影的 0.537。

| 赛道 | key | year | offset | reverse | sectors | 残差 % | 置信度 | 赛段来源 |
| --- | ---: | ---: | ---: | --- | --- | ---: | --- | --- |
| jeddah-1.svg | 149 | 2022 | 0.071 | false | — | 0.51 | 高 | 未写，见下方 |
| melbourne-2.svg | 10 | 2022 | 0.083 | false | 0.335, 0.602 | 0.18 | 高 | 2026 澳大利亚，S1 1.753 km / S2 1.413 km |
| suzuka-2.svg | 46 | 2019 | 0.591 | false | 0.375, 0.810 | 0.09 | 高 | 2026 日本，S1 2.184 / S2 2.526 |
| shanghai-1.svg | 49 | 2019 | 0.436 | true | 0.278, 0.558 | 0.65 | 高 | 2026 中国，S1 1.430 / S2 1.569 |
| miami-1.svg | 151 | 2022 | 0.040 | false | 0.342, 0.664 | 0.37 | 高 | 2026 迈阿密，S1 1.866 / S2 1.730 |
| imola-3.svg | 6 | 2022 | 0.887 | false | — | 0.14 | 高 | 未写，见下方 |
| monaco-6.svg | 22 | 2019 | 0.335 | false | 0.317, 0.739 | 0.22 | 高 | 2026 摩纳哥，S1 1.051 / S2 1.419 |
| montreal-6.svg | 23 | 2019 | 0.415 | false | 0.251, 0.572 | 0.10 | 高 | 2026 加拿大，S1 1.092 / S2 1.396 |
| catalunya-6.svg | 15 | 2023 | 0.185 | false | 0.230, 0.599 | 0.09 | 高 | 2025 西班牙（巴塞罗那），T4 前 50 m、T10 前 89 m |
| spielberg-3.svg | 19 | 2022 | 0.182 | true | — | 2.24 | 中 | 公里数有，投影滑了，未写 |
| silverstone-8.svg | 2 | 2022 | 0.939 | false | 0.309, 0.730 | 0.12 | 高 | 2026 英国，S1 1.823 / S2 2.464 |
| hungaroring-3.svg | 4 | 2019 | 0.868 | false | 0.396, 0.748 | 0.08 | 高 | 2026 匈牙利，S1 1.736 / S2 1.542 |
| spa-francorchamps-4.svg | 7 | 2021 | 0.980 | false | 0.322, 0.724 | 0.09 | 高 | 2026 比利时，S1 2.254 / S2 2.820 |
| zandvoort-5.svg | 55 | 2021 | 0.135 | false | 0.352, 0.693 | 0.24 | 高 | 2026 荷兰，S1 1.483 / S2 1.452 |
| monza-7.svg | 39 | 2019 | 0.692 | false | 0.330, 0.644 | 0.04 | 高 | 2026 意大利，S1 1.909 / S2 1.823 |
| baku-1.svg | 144 | 2022 | 0.938 | false | 0.354, 0.675 | 0.70 | 高 | 2026 阿塞拜疆，S1 2.033 / S2 2.025 |
| marina-bay-4.svg | 61 | 2023 | 0.056 | false | 0.327, 0.694 | 0.24 | 高 | 2026 新加坡，S1 1.639 / S2 1.782 |
| austin-1.svg | 9 | 2021 | 0.522 | false | 0.311, 0.715 | 0.64 | 高 | 手调；投影约 0.537，仍用 0.522 |
| mexico-city-3.svg | 65 | 2021 | 0.014 | false | 0.432, 0.792 | 0.61 | 高 | 2025 墨西哥城，T4 前 136 m、T12 前 242 m |
| interlagos-2.svg | 14 | 2019 | 0.205 | false | — | 0.10 | 高 | 未写，见下方 |
| las-vegas-1.svg | 152 | 2023 | 0.475 | false | 0.262, 0.539 | 0.19 | 高 | 2025 拉斯维加斯，T5 后 90 m、T12 后 140 m |
| lusail-1.svg | 150 | 2023 | 0.004 | false | 0.341, 0.633 | 0.11 | 高 | 2025 卡塔尔，T6 前 80 m、T12 前 75 m |
| yas-marina-2.svg | 70 | 2021 | 0.623 | true | 0.233, 0.684 | 0.22 | 高 | 2025 阿布扎比，T5 前 205 m、T9 前 100 m |

## 跳过和没写赛段的

- **bahrain-3.svg（key 63）**：采样出来的闭环不像萨基尔大奖赛（没有那条内场），相似变换残差 9.7%，正反方向也分不开。不写相位，进度 0 仍是文件起点。
- **marina-bay.svg**：和 `marina-bay-4.svg` 字节相同，`CIRCUIT_SVG` 只用带版本号的那份。
- **spielberg-3.svg**：起终点可用（反向，offset 0.182），但示意图比中心线拉得开，残差 2.2%。FIA 2026 的 S1/S2 距离比例是 0.281 / 0.673，投到 SVG 上变成大约 0.332 / 0.699，差了一截，所以不写 sectors。
- **jeddah-1.svg、imola-3.svg、interlagos-2.svg**：起终点贴合（残差 0.51%、0.14%、0.10%）。没有找到能对上当前布局的 FIA 赛段公里数或弯心计时环，sectors 留空，赛段三等分。2026 年「巴林站在马来西亚」是雪邦，不能用来标萨基尔；2026 西班牙站是马德里，巴塞罗那用的是 2025 年笔记。

## 奥斯汀

投影（curveSteps 4，y 取负）给出 offset **0.537**、reverse false、残差 0.64%、flipY 不需要再翻（SVG 已经按运行时取过负）。先前用 curveSteps 24 的对照是 **0.536**，移位 188；这次移位 187。两点和手调的 **0.522** 都在 T20–T1 主直道上，相差大约 1.5% 圈程，所以 `CIRCUIT_PHASE` 仍是 0.522，sectors 仍是 `[0.311, 0.715]`。

2025 美国站图例：S1 在 T7 前 55 m，S2 在 T13 前 65 m。这和手调的两个终点是同一段直道，没有改数字。
