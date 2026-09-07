# Tracelet —— 面向个人与创客的开源在线 PCB 设计工具

[English](./README.md) · 简体中文

**在线演示：** [tracelet.org](https://tracelet.org/)

Tracelet 面向个人、极客和小团队，在浏览器中完成原理图 → PCB → 3D → 制造输出。采用 TypeScript 无头内核、Web 编辑器、CLI 与 MCP 服务；默认将项目保存在本地浏览器，也可连接自建远程存储。

## 主要功能特点

- **完整设计工作区**：多页原理图、PCB、3D、元件库、BOM、制造、装配与测试集中在一个项目中，支持撤销与重做。
- **2 / 4 / 6 层 PCB**：板框缺口、标尺、拖动对齐吸附、热焊盘铺铜、网络类约束，以及盲埋孔和背钻参数。
- **布局与布线辅助**：结合连接器方向、天线保护和器件关联给出可预览的布局建议；自动布线支持进度、取消，并在适用范围内提供差分成对搜索与长度补偿。
- **可查看依据的工程检查**：ERC、DRC、连通性检查，以及布局、布线、对齐、信号约束、阻抗估算和直流导体热估算报告。
- **一致的制造输出**：Gerber / 钻孔 / 坐标统一原点，底面角度约定可选，BOM / 坐标共用 DNP 策略并校验位号，支持 Gerber 文件回读；独立拼板输出包含工艺边、连接桥、鼠咬孔、定位孔及基准点。
- **可核对的器件信息**：来源与数据手册、引脚映射、实体轮廓、连接器方向、模型偏移，配合元件详情和可选的在线参考报价。
- **自动化与展示**：AI 助手、CLI、MCP 实时桥；元件 3D 模型、GLB 导出及独立产品 PNG 渲染。
- **多设备、多语言**：响应式导航与面板、触屏平移缩放、深浅主题，支持简体中文、繁体中文、英语、日语、韩语、德语、法语、西班牙语、巴西葡萄牙语和印地语；部分旧消息使用回退翻译。

## 制造、工程与产品展示

**制造页**集中展示工程报告、制造设置、拼板、文件预览与 ZIP 导出。BOM 按 MPN / LCSC 编号区分物料；装配导出检查缺失、重复位号和元件身份，不完整项目仍可单独导出裸板 Gerber。Gerber、钻孔和坐标采用同一原点、Y 轴向上、底层 XY 从顶面观察的约定；底面角度需与装配厂约定核对。DNP 设置同时作用于 BOM 和坐标，不删除板上的铜与焊盘。

**拼板**生成独立制造包，不改动原始单板。当前支持同向阵列，包含连续工艺边、安全直边上的连接桥、鼠咬孔、三枚定位孔和三枚顶层基准点；按实际板框、推断的天线区域及连接器信息检查保护区域。拼板导出目前支持通孔工艺，不支持的高级钻孔和不安全的连接桥会被拒绝。铣刀半径、连接桥强度和制造公差仍需板厂确认。

**器件属性**保存来源、数据手册、人工核对状态、引脚到焊盘映射、实体尺寸、卧式 / 立式连接器方向及导入模型偏移。修改实体轮廓不移动焊盘；缺失信息不会被自动标为可信。导入的 STEP 路径属于元数据，不代表自动完成模型转换。

原理图 **“整理并校验”**保守整理完整连接分组和显式功能分组，尽可能避让器件文字、简化冗余连线顶点；应用前比较电气身份，支持撤销。含图形或总线的图纸保留现有分组位置。**“同步到 PCB”**位于右侧属性面板。

**装配页**提供分组物料清单、板面与旋转视图、元件高亮和完成标记。**测试页**根据网络和元件生成板上探测位置及检查建议，不控制仪器，也不认证电路功能。**3D 页**提供独立产品渲染：顶面 / 底面 / 等轴视角、浅色 / 深色 / 透明背景，最高 2400 × 1800 PNG；未匹配模型仍明确显示为占位。

## 工程能力边界

- 自动布局和布线属于启发式辅助，不保证全通、全局最优或无信号干扰。天线与连接器的推断必须结合数据手册和外壳结构核对。
- 差分布线目前支持适用的双端、等线宽、单层成对路径、间距校验和板内长度补偿，不支持成对换层过孔与分支差分网络。
- 阻抗使用单端微带线 / 带状线闭式公式估算，不是场求解器。热工具为直流导体集中参数模型，温升需要用户提供热阻及受支持的无分支走线路径；不等同于 SI / EMI 或整板热仿真。
- ERC / DRC 与评分依赖正确的几何、引脚类型和规则。未评估项不会自动视为通过，高分不能覆盖错误，制造与装配前仍需工程复核。
- 已支持 GLB 和 PNG。暂不提供原生 STEP 导出、通用 STEP 自动导入转换或多人实时共同编辑。

## 零件库：内置 + 社区更新 + 我的

- **内置**：`packages/kernel/src/library/partsBase.ts`，约 150 个常用零件（0402/0603 E 系列电阻、MLCC、电感 / 磁珠 / 保险丝 / 电解、二极管 / TVS / ESD、三极管 / MOS、LDO / DC-DC / 充电、555 / 运放 / 比较器 / 移位寄存器 / CH340C / SPI Flash / DS18B20、ESP32 模块、晶振、轻触开关、排针 / JST / USB-C）。IC 都带真实引脚名的符号，封装按名字参数化生成。型号 / 引脚只写有把握的，价格与库存不写死，LCSC 编号只填确定的。
- **社区**：网页「元件库 → 零件库 → 从网络更新」拉取 `data/parts.json`（默认指向本仓库 main 分支，可改成自己的 URL），存在浏览器本地。维护方式：改 `partsBase.ts` 或直接编辑 `data/parts.json` 后提交，`node scripts/build-parts.mjs` 可从内置库重新生成。
- **我的**：同一页签支持导入 CSV / JSON（列名中英文都认：型号 / mpn、厂商、描述、封装 / package、引脚 / pins、LCSC、值；嘉立创 / LCSC 导出的表格可直接用）、手动录入、导出。描述会自动推断分类，符号按类别或引脚列自动生成（`1:VDD;2:GND;…` 生成带引脚名的框符号，只给数量则按编号），封装按名字参数化生成。
- 搜索、放置、AI 的 `search_parts`、BOM 单价都用合并后的全部零件；同 id 时"我的"覆盖"社区"覆盖"内置"。

## AI 助手：对话里直接附原理图

右侧「AI」面板的对话框支持 📎 附件（PDF / PNG / JPG / WebP，可多选、拖入或直接粘贴截图）。附上原理图后回车，模型会读取附件抽取元件、引脚与网络，调用 `generate_sheet_from_spec` 生成图纸并用 ERC / 经验审查复核；也可以在文字里要求"对照附件修改当前图纸"。助手拥有完整读写工具：放置 / 删除 / 移动 / 旋转元件、改值 / 封装 / 位号、连线、网络标签、新建 / 切换图纸、自动布线，全部可 Undo。「参考设计」页签保留用于搜索厂商参考设计 PDF。

## 用户姓名与标题栏作者

右上角头像可编辑姓名：新建工程的每张图纸标题栏作者自动填该姓名，未填作者的旧图纸显示与 PDF 导出也用它。本地模式存在浏览器；远程模式通过 `GET/PUT /api/me` 存到服务器：文件存储写 `data/_user.json`，PostgreSQL 写 `users` 表并在首次启动时插入种子用户（`owner@tracelet.local` / 设计者）。

## Altium Designer 导入

支持直接导入 .SchDoc / .PcbDoc（OLE 复合文档二进制格式，独立实现的解析器，格式知识参考 KiCad / altium2kicad 等公开实现）：

- 原理图：元件（符号图形、引脚、位号、Comment、封装名）、导线、总线、结点、网络标签、端口、电源端口（映射为内置 GND / 电源符号）、图纸符号与入口（按名字连通）、自由文字与线框。多部件元件按当前部件导入。
- PCB：板框（Board Shape / Keep-Out）、元件与封装（焊盘形状 / 孔 / 旋转 / 底面镜像）、走线、圆弧、过孔、铺铜轮廓（Polygon）与矩形填充、丝印文字，2 / 4 / 6 层（最多映射四个内层，更多内层不保留）。
- 原理图元件与 PCB 封装按位号关联；焊盘网络来自 PCB，缺失时用原理图网表补全。
- 暂不支持：SchLib / PcbLib / IntLib 库文件、盲埋孔、槽孔、内电层分割（Split Plane，这些网络会显示为未布线）、规则（Rules）到网络类的映射、图片。非 90° 旋转的元件焊盘按轴对齐矩形近似，DRC 可能对这类元件误报。

用法：网页里多选全部 .SchDoc + .PcbDoc 拖入（或首页「导入」）；CLI `tracelet import altium a.SchDoc b.SchDoc board.PcbDoc -o out.eda.json`；MCP `import_altium`。


## 布局检查与优化

PCB 工具栏「布局优化」（也在向导里）先检查再给可预览的移动建议，规则来自常见 PCB 布局经验：

- 合法性：不出板、不重叠、器件间留 0.5–1.5 mm 通道、焊盘间 ≥0.6 mm、离板边 ≥ 铜到板边 + 0.3 mm。板外 / 重叠的器件先按连接关系"构造式"摆进板内（IC 优先，其余按连接强度就近落位），再退火细调。
- 亲源性：与 IC 共享网络的无源件贴近对应引脚。共享两个网络的电容（升压 / 降压的输入输出电容、去耦）最强，电感 / 二极管（开关节点）次之，电阻最弱；去耦电容额外要求靠近电源脚，晶振靠近 MCU。
- 美观与均衡：相邻同类小件同向、成排对齐；没有固定件时整体居中，不堆在一边。
- 连接器：优先采用显式的卧式 / 立式安装和局部插拔方向；缺少信息时使用名称与几何启发式，布线前需核对推断方向。
- 天线：识别具有明显无焊盘伸出端的射频模块并保护对应区域，优化时保留现有天线器件位置；推断不能替代数据手册规定的净空。
- 干扰：晶振 / 模拟器件远离开关、驱动类器件。

原布局合法时，建议会先用自动布线验证"不变差"才展示；原布局不合法（板外 / 重叠）时直接给出可布通的整理结果。

## 板厂规则（DRC）与嘉立创工艺能力对照

内置 `jlc` / `jlcpcb` 规则集采用下表参考值，并保留一定余量。下单时请核对板厂最新[工艺能力](https://www.jlc.com/portal/vtechnology.html)；此表不是实时工艺数据：

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
apps/web          React + Vite 编辑器（首页 / 原理图 / PCB / 3D / 库 / BOM / 制造 / 测试 / 装配）
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
- 元件详情：库里任意条目可打开详情弹窗——参数、引脚表，符号 / 封装 / 立体示意全部本地渲染（不引用外部图片），外加可选的参考价。在线查价默认关闭；开启后查 JLC / LCSC 装配库的库存与阶梯价（本机缓存 24 小时），装配库里没有原型号时给出参数相近的同类可选。其余分销商（Digi-Key / Mouser / Farnell / TME / Octopart 等）只提供搜索链接——这里尚未接入它们的 API 直连。开关、数据源地址与缓存在左侧工具栏底部的「⋯」设置里，任何返回同样格式的接口（比如自建代理）都能替换默认源
- 模板：ESP32 最小系统 / STM32F103 最小系统 / Arduino UNO 扩展板，一键生成原理图 + 预布局 PCB
- 向导：顶部「向导」入口按步骤给出完成度与一键操作（原理图：放置 → 连线 → ERC → 同步；PCB：板框 → 布局 → 安装孔 → 布线 → 一键铺地 → DRC → 丝印 → 3D → 导出）
- 我的库存：记录手头元件（型号 / 值 / 符号 / 封装 / 数量 / 位置），CSV 导入导出，可直接放置
- 导入：KiCad S-expression 工程（特定版本功能可能近似或遗漏）（多个 `.kicad_sch` = 多页，`.kicad_pcb`）；嘉立创 EDA 标准版 JSON（文件 → 导出 → EasyEDA 源码：原理图 / PCB / 符号 / 封装，专业版请先导出标准版或 KiCad）；符号 / 封装随项目保存；项目备份 zip 导入导出
- 原理图：多页与图纸模板（A5–A1 / 自定义长宽，标题栏文字与标签可编辑）、总线、结点、图形注释（均可拖动）、测量、复制粘贴、⌥拖动复制、自定义属性、栅格切换
- PCB：框选、板框编辑、走线顶点/线段拖动、走线中实时间距检查、对齐分布、内置自动布线（全局最短优先严格布线 → 软冲突探测定向拆线重布 → 推挤 → 盘中孔候选 → 45° 倒角；层方向偏好、真实几何间距校验；Web Worker 运行，进度 / 取消，建议预览后接受）、开孔工具（M2–M4 螺丝孔 / 金属化孔）、仅板级封装（定位孔 / 基准点 / Logo）直接放置、板框改尺寸 / 整板拖动 / 适配内容、状态栏栅格 / 线宽 / 过孔选择、层叠与工艺参数（板厚、铜厚、表面处理、阻焊 / 丝印颜色）
- 手势：触控板双指平移 / 捏合缩放（可切回滚轮缩放）、右键或双指轻触结束当前操作
- 3D：Three.js 真实几何（板体带孔、焊盘、走线、铺铜、丝印）+ KiCad 标准库 3D 模型（244 个常用封装转成 GLB，按封装名自动匹配；可导入自己的 GLB，STEP 请先用 KiCad / FreeCAD 转 GLB），截图 PNG / 导出 GLB，点选联动 PCB 选择
- 铺铜：热焊盘（间隙、辐条宽可调）或实心连接，Gerber 同步生效
- URL：`/p/<项目ID>/sch/<图纸ID>`、`/p/<项目ID>/pcb|3d|lib|bom|fab|qc|asm`，刷新与分享链接都能回到原处
- AI 助手：配置自己的 Anthropic API Key 后，模型可通过内核工具读取网表 / 运行 ERC、DRC / 放置连线 / 自动布线（全部可 Undo）；「参考设计」模式：搜索厂商开发板原理图 PDF（内置目录 + 联网搜索）→ 识别元件与连接 → 一键生成新图纸；也可上传自己的 PDF / 截图识别
- 界面：深色 / 浅色 / 跟随系统；10 种语言（见上方主要功能，词典位于 `apps/web/src/i18n`）；语言与主题入口在顶部导航
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

[GPL-3.0-or-later](./LICENSE)，与 KiCad 相同。允许使用、修改与商业销售；分发修改版时必须以同一协议公开源码。内核、CLI、Web 与服务端均适用。第三方资源沿用各自协议（KiCad 3D 模型：CC-BY-SA 4.0 附 KiCad 库例外条款，见 `apps/web/public/models3d`）。
