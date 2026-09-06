# Tracelet —— 面向个人与创客的开源在线 PCB 设计工具

TypeScript 无头内核 + Web 编辑器 + CLI + MCP server + 可选的自建远程存储服务端。



## Altium Designer 导入

支持直接导入 .SchDoc / .PcbDoc（OLE 复合文档二进制格式，独立实现的解析器，格式知识参考 KiCad / altium2kicad 等公开实现）：

- 原理图：元件（符号图形、引脚、位号、Comment、封装名）、导线、总线、结点、网络标签、端口、电源端口（映射为内置 GND / 电源符号）、图纸符号与入口（按名字连通）、自由文字与线框。多部件元件按当前部件导入。
- PCB：板框（Board Shape / Keep-Out）、元件与封装（焊盘形状 / 孔 / 旋转 / 底面镜像）、走线、圆弧、过孔、铺铜轮廓（Polygon）与矩形填充、丝印文字，2 层或 4 层（多于两个内层只取前两个）。
- 原理图元件与 PCB 封装按位号关联；焊盘网络来自 PCB，缺失时用原理图网表补全。
- 暂不支持：SchLib / PcbLib / IntLib 库文件、盲埋孔、槽孔、内电层分割（Split Plane，这些网络会显示为未布线）、规则（Rules）到网络类的映射、图片。非 90° 旋转的元件焊盘按轴对齐矩形近似，DRC 可能对这类元件误报。

用法：网页里多选全部 .SchDoc + .PcbDoc 拖入（或首页「导入」）；CLI `tracelet import altium a.SchDoc b.SchDoc board.PcbDoc -o out.eda.json`；MCP `import_altium`。

## 板厂规则（DRC）与嘉立创工艺能力对照

规则集 `jlc` / `jlcpcb` 按嘉立创公开的工艺能力页（[www.jlc.com/portal/vtechnology.html](https://www.jlc.com/portal/vtechnology.html)，2026-09 核对）设置，默认比板厂极限留有余量：

| 项目 | 嘉立创极限 / 建议 | Tracelet 默认判定 |
|---|---|---|
| 线宽 / 线距（双面 1oz） | 0.10 / 0.10 | < 0.127 报错 |
| 线宽 / 线距（2oz 外层） | 0.16 / 0.16 | 层叠铜厚 ≥2oz 时按 0.16 |
| 过孔孔径 | 0.15 极限 · 0.3 常规 | < 0.2 报错，< 0.3 提示加价 |
| 过孔焊环（外径 − 内径）/2 | ≥ 0.05 | < 0.1 报错 |
| 插件孔焊环 | 0.18 极限 · 0.25 建议 | < 0.18 报错，< 0.25 警告 |
| 孔边到孔边 | 过孔 0.2 · 插件孔 0.45 | < 0.2 报错，插件孔 < 0.45 警告 |
| 插件孔孔边到异网络铜 | 0.28 极限 · 0.35 建议 | < 0.28 报错 |
| 无铜孔周围掏空 | 0.2 | 铜距无铜孔 < 0.2 报错 |
| 铜到板边 | 锣边 0.2 · V 割 0.4 | < 0.3 警告 |
| 丝印字高 / 字符到焊盘 | 1.0 / 0.15 | 字高 < 1.0 警告，压焊盘警告 |
| 最小单板 | 3 × 3 mm | 小于报错 |
| 板厚 | 0.4 – 2.0 常规档 | 非常规档警告 |

阻焊桥（0.1 mm）、槽孔、半孔、金手指等目前不在 DRC 范围内。

## 结构

```
packages/kernel   无头内核：数据模型、命令系统（撤销/重做）、连通性/网表、ERC、原理图→PCB 同步、飞线、DRC、导出
packages/db       PostgreSQL schema（Drizzle）
apps/web          React + Vite 编辑器（首页 / 原理图 / PCB / 3D / 库 / BOM / 制造）
apps/cli          tracelet 命令行 + MCP server，与 Web 共用内核
apps/server       远程存储服务端（Hono REST；PostgreSQL 或 JSON 文件），供小团队自建
scripts/          KiCad 标准 3D 模型 → GLB 转换脚本（模型目录见 apps/web/public/models3d）
```

## 开始

```bash
pnpm install
pnpm dev                 # http://localhost:5173
pnpm test                # 内核单元测试 + Web 冒烟测试
pnpm typecheck
pnpm cli --help          # tracelet CLI
pnpm cli new demo.eda.json --demo && pnpm cli drc demo.eda.json
pnpm cli new stm32.eda.json -t stm32  # 模板：blank | esp32 | stm32 | arduino（pnpm cli templates）
pnpm cli export zip demo.eda.json     # 全套制造文件（含装配图 PDF）
pnpm cli export pdf demo.eda.json     # 原理图 PDF
pnpm cli import kicad board.kicad_sch board.kicad_pcb -o board.eda.json
pnpm cli import easyeda Schematic_x.json PCB_x.json -o x.eda.json          # 嘉立创 EDA 标准版
pnpm cli import lib demo.eda.json MyParts.kicad_sym Package.pretty/*.kicad_mod   # KiCad 库 → 项目库
pnpm cli footprint gen demo.eda.json LQFP-48_7x7mm_P0.5mm                        # 参数化封装
```

## 当前能力（v0.1）

- 原理图：放置 / 连线 / 标签 / 旋转 / 撤销重做，实时 ERC，确定性设计审查（去耦、上拉、限流）可一键应用
- PCB：45° 走线、过孔换层、铺铜（自动避让异网络铜、移除孤岛）、飞线、实时 DRC、图层与透明度
- 制造：Gerber RS-274X（铜 / 阻焊 / 锡膏 / 丝印 / 板框）+ Excellon（PTH / NPTH）+ BOM + 坐标文件 + 装配图 PDF（顶 / 底）+ 原理图 PDF + README（工艺参数），一键 zip；「下单指引」给出参数与主流平台建议（不跳转厂商）；Gerber 预览由第三方解析器（tracespace）读取导出文件后渲染
- 库：内置零件目录，按型号 / 参数搜索，42 类元器件分类图标筛选；全部 / 项目库 / 收藏 / 官方库标签；导入 KiCad 库文件（`.kicad_sym` 多符号 / 多单元 / 派生符号，`.kicad_mod`）；参数化封装生成（0201–2512 贴片、SOIC/TSSOP、LQFP、QFN、DIP、排针排母、SOT-23），KiCad 风格封装名（如 `LQFP-48_7x7mm_P0.5mm`）在导入与同步时自动生成真实几何
- 模板：ESP32 最小系统 / STM32F103 最小系统 / Arduino UNO 扩展板，一键生成原理图 + 预布局 PCB
- 向导：右侧「向导」标签按步骤给出完成度与一键操作（原理图：放置 → 连线 → ERC → 同步；PCB：板框 → 布局 → 安装孔 → 布线 → 一键铺地 → DRC → 丝印 → 3D → 导出），自动布线接受后自动打开
- 我的库存：记录手头元件（型号 / 值 / 符号 / 封装 / 数量 / 位置），CSV 导入导出，可直接放置
- 导入：KiCad 6/7/8 工程（多个 `.kicad_sch` = 多页，`.kicad_pcb`）；嘉立创 EDA 标准版 JSON（文件 → 导出 → EasyEDA 源码：原理图 / PCB / 符号 / 封装，专业版请先导出标准版或 KiCad）；符号 / 封装随项目保存；项目备份 zip 导入导出
- 原理图：多页与图纸模板（A5–A1 / 自定义长宽，标题栏文字与标签可编辑）、总线、结点、图形注释（均可拖动）、测量、复制粘贴、⌥拖动复制、自定义属性、栅格切换
- PCB：框选、板框编辑、走线顶点/线段拖动、走线中实时间距检查、对齐分布、内置自动布线（全局最短优先严格布线 → 软冲突探测定向拆线重布 → 推挤 → 盘中孔候选 → 45° 倒角；层方向偏好、真实几何间距校验；Web Worker 运行，进度 / 取消，建议预览后接受）、开孔工具（M2–M4 螺丝孔 / 金属化孔）、仅板级封装（定位孔 / 基准点 / Logo）直接放置、板框改尺寸 / 整板拖动 / 适配内容、状态栏栅格 / 线宽 / 过孔选择、层叠与工艺参数（板厚、铜厚、表面处理、阻焊 / 丝印颜色）
- 手势：触控板双指平移 / 捏合缩放（可切回滚轮缩放）、右键或双指轻触结束当前操作
- 3D：Three.js 真实几何（板体带孔、焊盘、走线、铺铜、丝印）+ KiCad 标准库 3D 模型（244 个常用封装转成 GLB，按封装名自动匹配；可导入自己的 GLB，STEP 请先用 KiCad / FreeCAD 转 GLB），截图 PNG / 导出 GLB，点选联动 PCB 选择
- 铺铜：热焊盘（间隙、辐条宽可调）或实心连接，Gerber 同步生效
- URL：`/p/<项目ID>/sch/<图纸ID>`、`/p/<项目ID>/pcb|3d|lib|bom|fab`，刷新与分享链接都能回到原处
- AI 助手：配置自己的 Anthropic API Key 后，模型可通过内核工具读取网表 / 运行 ERC、DRC / 放置连线 / 自动布线（全部可 Undo）；「参考设计」模式：搜索厂商开发板原理图 PDF（内置目录 + 联网搜索）→ 识别元件与连接 → 一键生成新图纸；也可上传自己的 PDF / 截图识别
- 界面：深色 / 浅色 / 跟随系统；简体中文 / English（`t()` 词典，`apps/web/src/i18n`）
- CLI：`tracelet new -t | templates | erc | drc | review | sync | export gerber|zip|pdf|assembly | import kicad|lib | footprint gen`，退出码可用于 CI

## MCP server

完整说明（两种模式、各客户端配置、全部工具参数、排错）见 [MCP.md](./MCP.md)。

把 Tracelet 内核暴露给 Claude Code / Claude Desktop / Cursor 等 MCP 客户端（stdio）。两种目标：

**1. 浏览器里正在打开的项目（推荐，类似 Figma 的实时桥）**

```bash
claude mcp add tracelet -- pnpm --dir /path/to/tracelet cli serve --mcp --live
```

然后在网页 头像菜单 → 「本地 Agent（MCP 实时桥）」→ 开启连接（默认端口 8790，只连 127.0.0.1）。顶栏出现「✨ Agent 已连接」后，Agent 就能按项目 ID 操作你当前打开的项目：`list_open_projects` 看到 `prj_xxx`，`use_project` 选择（只开一个时自动选中），之后所有工具直接作用在浏览器里，每次修改是一条可撤销的「Agent 修改」；`undo` 会转发给浏览器；`new_project` / `new_from_template` 省略 `file` 时直接在浏览器里打开。本地存储与远程存储模式都可用。

**2. 本地文件**

```bash
claude mcp add tracelet -- pnpm --dir /path/to/tracelet cli serve --mcp -f /path/to/project.eda.json
```

工具：`open_project / new_project / new_from_template / list_templates / list_open_projects / use_project / import_kicad / import_altium / import_easyeda / import_library / generate_footprint / project_summary / get_netlist / get_component / run_erc / run_drc / review_schematic / search_parts / place_component / connect_pins / add_net_label / set_component_value / sync_to_pcb / move_footprint / set_board_outline / check_placement / optimize_placement / autoroute / trace_lengths / export_fab / export_pdf / undo`。文件模式下每次修改自动保存到打开的文件。

## 存储模式

- **个人（默认）**：浏览器本地存储，打开即用，无需任何服务。
- **小团队**：自建 `apps/server`，Web 端头像菜单 → 存储 → 远程，填入地址与令牌即可（有「测试连接」）。

```bash
# 文件存储（零依赖，项目存为 ./data/*.json）
TRACELET_TOKEN=换成你的令牌 pnpm --filter @tracelet/server start
# PostgreSQL
DATABASE_URL=postgres://user:pass@host/tracelet TRACELET_TOKEN=... PORT=8787 pnpm --filter @tracelet/server start
```

API：`GET /api/health`、`GET /api/projects`、`GET|PUT|DELETE /api/projects/:id`（PUT 体为项目 JSON，服务端用内核校验）。表结构见 `packages/db`（首次启动自动建 `projects` 表）。

## 快捷键

原理图：`A` 放元件 · `W` 连线 · `P` 电源/地 · `L` 标签 · `R/C/D` 快速放电阻/电容/LED · `R` 旋转选中 · `Del` 删除
PCB：`X` 走线 · `V` 走线中放过孔换层 · `Z` 铺铜 · `A` 放板级封装 · `M` 测量 · `F` 翻面 · `R` 旋转 · `1-9` 切层
全局：`⌘K` 命令面板（`@` 元件 `#` 网络）· `⌘Z` 撤销 · `Tab` 焦点模式 · `F8` 下一个问题 · 空格+拖动 平移

## 许可证

MIT
