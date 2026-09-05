# Tracelet —— 面向个人与创客的开源在线 PCB 设计工具

TypeScript 无头内核 + Web 编辑器 + CLI（MCP 与服务端在后续里程碑）。方案与设计文档见 `docs/`。

## 结构

```
packages/kernel   无头内核：数据模型、命令系统（撤销/重做）、连通性/网表、ERC、原理图→PCB 同步、飞线、DRC、导出
packages/db       PostgreSQL schema（Drizzle，脚手架）
apps/web          React + Vite 编辑器（首页 / 原理图 / PCB / 3D / 库 / BOM / 制造）
apps/cli          eda 命令行，与 Web 共用内核
ui-demo/          交互式设计稿（Claude Design）
docs/             可行性评估、UX/UI 设计文档、存储模式
```

## 开始

```bash
pnpm install
pnpm dev                 # http://localhost:5173
pnpm test                # 内核单元测试 + Web 冒烟测试
pnpm typecheck
pnpm cli --help          # tracelet CLI
pnpm cli new demo.eda.json --demo && pnpm cli drc demo.eda.json
pnpm cli export zip demo.eda.json     # 全套制造文件
pnpm cli import kicad board.kicad_sch board.kicad_pcb -o board.eda.json
```

## 当前能力（v0.1）

- 原理图：放置 / 连线 / 标签 / 旋转 / 撤销重做，实时 ERC，确定性设计审查（去耦、上拉、限流）可一键应用
- PCB：45° 走线、过孔换层、铺铜（自动避让异网络铜、移除孤岛）、飞线、实时 DRC、图层与透明度
- 制造：Gerber RS-274X（铜 / 阻焊 / 锡膏 / 丝印 / 板框）+ Excellon（PTH / NPTH）+ BOM + 坐标文件，一键 zip；Gerber 预览由第三方解析器（tracespace）读取导出文件后渲染
- 库：内置零件目录，按型号 / 参数搜索，42 类元器件分类图标筛选
- 导入：KiCad 6/7/8 工程（多个 `.kicad_sch` = 多页，`.kicad_pcb`），符号 / 封装随项目保存；项目备份 zip 导入导出
- 原理图：多页与图纸模板（A4/A3/A2 边框 + 标题栏）、总线、结点、图形注释、测量、复制粘贴、⌥拖动复制
- PCB：框选、板框编辑、走线顶点/线段拖动、走线中实时间距检查、对齐分布、内置 A* 自动布线（建议预览后接受）
- 手势：触控板双指平移 / 捏合缩放（可切回滚轮缩放）、右键或双指轻触结束当前操作
- 界面：深色 / 浅色 / 跟随系统；简体中文 / English（`t()` 词典，`apps/web/src/i18n`）
- CLI：`tracelet erc | drc | review | sync | export gerber | export zip`，退出码可用于 CI

## 存储模式

- **个人（默认）**：浏览器本地存储，打开即用，无需任何服务。
- **小团队**：在设置里指向自建服务（`apps/server`，下一里程碑）+ PostgreSQL，获得协同与版本历史。
- 两种模式共用同一套项目 JSON 与 Drizzle schema，详见 `docs/03-存储与部署模式.md`。

## 快捷键

原理图：`A` 放元件 · `W` 连线 · `P` 电源/地 · `L` 标签 · `R/C/D` 快速放电阻/电容/LED · `R` 旋转选中 · `Del` 删除
PCB：`X` 走线 · `V` 走线中放过孔换层 · `Z` 铺铜 · `M` 测量 · `F` 翻面 · `R` 旋转 · `1-9` 切层
全局：`⌘K` 命令面板（`@` 元件 `#` 网络）· `⌘Z` 撤销 · `Tab` 焦点模式 · `F8` 下一个问题 · 空格+拖动 平移

## 许可证

MIT
