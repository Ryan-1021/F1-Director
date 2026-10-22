# F1 导播台 / F1-Director

在直播画面四周环绕显示 F1 计时看板，像导播台一样操作。

**项目名：** F1 导播台 / F1-Director  
**当前版本：** `0.2.0+20261021`（见根目录 [`VERSION`](VERSION)）

## 与原版的关系（重要）

本项目是对原版 **F1-RaceControl Desktop** 的**套壳 / 壳层增强**，**不是**从零重写计时服务。  
**本仓库版本号（`0.2.0+20261021`）只标识导播台壳层**；上游计时 jar 仍为 **0.1.15**，二者不要混用。

| 层级 | 来源 | 说明 |
|------|------|------|
| 计时核心（jar、F1 SignalR、本地 HTTP/SSE、看板数据） | **原作者项目** | 仍使用 `F1-RaceControl-Desktop.jar`（当前包内为 **0.1.15**） |
| 导播台壳（`director.html`、布局锁、关页停服、UI 补丁等） | 本仓库实现 | 启动时把壳与补丁发布进 `share/web/`，由原版 jar 同端口托管 |

原版项目（请优先致谢上游作者）：

- **GitHub：** https://github.com/Xixixiao2007/F1-RaceControl-Desktop  
- 包名 / 入口：`com.haf1.racecontrol` · `DesktopMain`  
- 壳层控制台窗口标题为 `F1-Director-Server`；上游 jar 文件名仍为 `F1-RaceControl-Desktop.jar`

本仓库对 jar 仅做了与导播需求相关的小补丁能力（如 Position / 赛道图所需接口）；**计时协议与服务主体仍是上游实现**。

## 致谢与分工

| 角色 | 谁 | 做什么 |
|------|-----|--------|
| **思路 / 产品方向** | **Ryan** | 提出导播台形态、布局与交互需求，并验收效果 |
| **代码实现** | **Lumi**（本助手 / Grok Bot） | 导播台壳、启动脚本、布局持久化、UI 补丁与联调 |
| **原版 Race Control** | [Xixixiao2007](https://github.com/Xixixiao2007/F1-RaceControl-Desktop) | 官方/公开的桌面计时看板与本地服务 |

请勿把上游计时核心说成是本壳层原创；也请勿把本壳层代码写成Ryan手写——**思路归Ryan，实现归 Lumi，底座归原作者**。

## 开源协议

本仓库（**F1 导播台 / F1-Director** 壳层：`director/` 下的启动脚本、导播台页面与 UI 补丁等）采用 **MIT** 协议，见根目录 [`LICENSE`](LICENSE)。版权声明：`Copyright (c) 2026 Ryan / F1 导播台`。

上游计时底座：

| 项目 | 协议 | 链接 |
|------|------|------|
| **F1-RaceControl**（安卓 / 共享源码） | **MIT**（`Copyright (c) 2026 Xixixiao2007`） | https://github.com/Xixixiao2007/F1-RaceControl |
| **F1-RaceControl-Desktop**（桌面仓库） | 仓库内**暂无独立 `LICENSE` 文件**；README 写明复用上述安卓侧共享源码（MIT） | https://github.com/Xixixiao2007/F1-RaceControl-Desktop |

再分发或上传本项目时请：

- 保留本仓库 `LICENSE` 中的版权与许可声明
- 保留并对上游致谢（安卓 MIT 版权声明与上述两个链接）
- **`share/F1-RaceControl-Desktop.jar`（及便携 JRE）仍属上游产物**，不因本壳层 MIT 而改其归属；使用与再分发须同时遵守上游许可与致谢要求

## 目录结构

| 路径 | 说明 |
|------|------|
| `director/` | 导播台启动与源 UI |
| `director/Start.cmd` | **日常入口**：清旧进程 → 发布 UI → 起 jar → Edge/Chrome 打开导播台 |
| `director/Stop.cmd` | 强制停 jar（释放 `:8720`；调用 `Stop-Director.ps1`） |
| `director/director.html` | 导播台页面（可拖拽面板） |
| `director/web-override/` | 看板 UI 补丁（`app.js` / `style.css` / 赛道 SVG 等）；每次启动拷到 `share/web/` |
| `director/layouts.json` | 首次启动时的布局种子（仅当 `share/web/layouts.json` 不存在时才拷贝） |
| `director/TRACKMAP.md` | 赛道图（trackmap）说明 |
| `share/` | 运行时：jar + JRE + 已发布的 `web/` |
| `share/F1-RaceControl-Desktop.jar` | 上游计时 jar **0.1.15**（含 Position 等补丁能力） |
| `share/jre/` | 便携 JRE，无需安装系统 Java |
| `share/web/layouts.json` | **当前布局与命名预设的持久化文件**（打包可带走） |
| `share/Start.cmd` | 仅裸计时看板 UI（不用导播台壳；窗口标题为 F1 Director） |
| `VERSION` | 壳层版本号（如 `0.2.0+20261021`） |
| `.gitignore` | 忽略 `share/jre/`、`share/web/` 发布产物、日志与系统垃圾文件 |

## 怎么启动

1. 双击 `director\Start.cmd`（或同目录中文快捷 `导播台.cmd` / `Start-Director.cmd`）
2. 脚本会：
   - 清理上次残留的 Director 实例（同 jar / 占用 `8720` 的进程）
   - 把 `director/web-override/` + `director.html` 发布到 `share/web/`
   - 用 `share/jre` 启动 **原版** jar（端口 **8720**，UTF-8 控制台）
   - 用 Edge / Chrome 打开 `http://127.0.0.1:8720/director.html`（可用普通窗口；应用模式 `--app=` 亦可）
3. **关掉导播台标签/窗口后约 3 秒内自动停 jar**（关页发 `/goodbye`；F5 刷新会重连取消，不会误停）；异常杀进程时约 15 秒心跳兜底。也可 `director\Stop.cmd` 或在启动控制台按 Enter

端口：

- Director / 导播台页面：`8720`
- 导播台生命周期心跳：`8721`（仅本机）

不要直接双击 `director.html`（`file://` 会误报未连接，且多看板 SSE 会撞连接上限）。

## 主要功能（当前实现）

- **可拖拽布局**：成绩榜、赛段成绩、赛道图、旗语、天气、轮胎、通报、最快圈、场次等面板；拖标题交换、拖空白避让、拖边缩放时挤压邻块、互不重叠
- **布局预设**：顶栏「布局」菜单；命名预设写入 `share/web/layouts.json`（有文件就用，没有则回默认）
- **布局锁定**：顶栏锁图标；锁上后不能拖、改大小、加减面板，也不能删除命名预设；窗口缩放只做画面适配、不写回文件；切板子类型与成绩榜「列」仍可用
- **等比布局缩放**：按保存时的宽高比统一缩放，避免全屏后横竖间距被拉歪；多出来的边留白
- **成绩榜列选择**：收在面板标题栏圆形按钮里弹出；列偏好写入 `layouts.json`
- **赛段成绩板**：面板类型 `sectors`（下拉「赛段成绩」）；按车显示最快圈 / 本圈 / S1–S3。当前上游 jar 的 `cars` 通常只有 `bestLap` 等字段、不下发赛段，有字段时自动显示，否则为 —
- **赛道图工具**：状态说明、ℹ、旋转收在赛道图面板标题栏，不另占底行
- **轮胎列**：S / M / H / I / W 等显示
- **顶栏信息条**：旗语 / 天气 / 赛道状态等条带
- **赛道图（trackmap）**：官方 Position.z 优先，否则 OpenF1；圆环「赛段状态」仍是 `ring`
- **直播面板**：粘贴链接载入；可藏 URL/工具条；延迟同步滑条对齐直播画面
- **深色导播台风**：顶栏红点、胶囊按钮、Noto Sans SC
- **共用一条 SSE**：iframe 看板用 `?once=1`，由导播台推状态，多块同类型也能亮
- **局域网主机**：用局域网 IP 打开时，SSE/接口跟同一主机，不再死盯 `127.0.0.1`

## 布局文件说明

- 权威路径：`share/web/layouts.json`
- 含：`current`、`presets`、`theme`、`streamUrl`（种子为空，自行粘贴直播链接）、`liveToolbarHidden`、`layoutLocked`、`timingColumns` 等
- `Start.cmd` **不会**用种子覆盖已有的 `share/web/layouts.json`
- 浏览器 `localStorage` 仍作缓存；以项目内该文件为准，便于备份与带走

## 注意

- 不要删本地的 `share/jre` 或 `share/F1-RaceControl-Desktop.jar`（JRE 体积大，默认不进 git；见 `.gitignore`）
- `share/web/` 是启动时发布产物，以 `director/` 为源；日常改 UI 请改 `director/web-override/` 与 `director/director.html`，再跑一次 `Start.cmd`
- 个人布局写在 `share/web/layouts.json`（被 gitignore）；仓库种子是 `director/layouts.json`（不含私人直播链接）
- 若只要裸计时看板、不要导播台壳：用 `share\Start.cmd` / `share\Start-LAN.cmd`
- 原版说明与更新请看上游仓库：https://github.com/Xixixiao2007/F1-RaceControl-Desktop

## 克隆后怎么跑

1. 准备 `share/F1-RaceControl-Desktop.jar` 与 `share/jre/`（可从上游桌面分享包拷入）
2. 双击 `director\Start.cmd`
3. 首次启动会把 `director/layouts.json` 种子拷到 `share/web/layouts.json`；之后以 `share/web/` 里那份为准
