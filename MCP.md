# Tracelet MCP 使用指南

Tracelet 通过 MCP（Model Context Protocol）把内核能力暴露给 Claude Code、Claude Desktop、Cursor 等 AI 客户端。同一个 MCP server 有两种工作目标：

| 模式 | 操作对象 | 适合场景 | 启动参数 |
|---|---|---|---|
| **浏览器实时桥**（推荐） | 你在 Tracelet 网页里当前打开的项目，按项目 ID 定位 | 边看画面边让 Agent 改，类似 Figma MCP | `serve --mcp --live` |
| **本地文件** | 磁盘上的 `.eda.json` | CI、脚本、离线批处理 | `serve --mcp [-f 文件]` |

两种模式可同时开启：加了 `--live` 后仍能用 `open_project` 打开文件，`use_project file` 切回文件目标。

---

## 1. 浏览器实时桥

### 原理

```
Claude Code ──stdio──► tracelet serve --mcp --live ──ws://127.0.0.1:8790──► 浏览器（Tracelet 网页）
                                  ▲ 镜像项目（id / rev / 文档）          │
                                  └────────── apply / undo / open ───────┘
```

- MCP 进程在本机开一个 WebSocket（只监听 127.0.0.1）。
- 网页在「头像菜单 → 本地 Agent」里开启连接后，把**当前打开的项目**（项目 ID 就是地址栏里的 `prj_xxx`）镜像给 MCP，并在你每次编辑后同步。
- Agent 的每次修改推回浏览器，作为一条可撤销的命令「Agent 修改」应用；`undo` 工具会转发给浏览器，等价于你按 ⌘Z。
- 本地存储与远程存储模式都可用，项目仍按原来的方式自动保存。

### 步骤

1. 注册 MCP server（以 Claude Code 为例，路径改成你的仓库）：

   ```bash
   claude mcp add tracelet -- pnpm --dir /path/to/tracelet cli serve --mcp --live
   ```

   端口默认 8790，可加 `--port 8795`。

2. 打开 Tracelet 网页（`pnpm dev` → http://localhost:5173），头像菜单 → **本地 Agent（MCP 实时桥）** → 「开启连接」。端口要与上面一致。设置会记住，下次打开网页自动重连。

3. 打开任意项目，顶栏出现 **✨ Agent 已连接**。

4. 在 Claude Code 里用自然语言即可，例如：

   > 给 U1 的 EN 加一个 10k 上拉到 3V3，然后跑 ERC。

   Agent 通常的调用序列：`list_open_projects` → （多个项目时）`use_project` → `place_component` → `connect_pins` / `add_net_label` → `run_erc`。

### 实时模式的特别之处

- `list_open_projects` 返回所有已连接浏览器（可多个标签页）里打开的项目 `{ id, name, rev }` 与当前激活的 `active`。只有一个项目时自动激活。
- `new_project` / `new_from_template` **省略 `file` 参数**时，直接在浏览器里新建并打开。
- `open_project` / `save_project` / `export_fab` / `export_pdf` / `import_*` 这类涉及磁盘路径的工具照常可用：导出会写到 MCP 进程所在机器的路径。
- 项目在浏览器里关闭后，MCP 收到 `closed`，再调用工具会提示先选择项目。

---

## 2. 本地文件模式

```bash
# Claude Code
claude mcp add tracelet -- pnpm --dir /path/to/tracelet cli serve --mcp -f /path/to/project.eda.json

# 手动运行（用于调试；正常由客户端拉起）
pnpm cli serve --mcp -f demo.eda.json
```

- `-f` 可省略，之后用 `open_project` / `new_project` / `import_kicad` / `import_easyeda` 打开或创建。
- 每次修改自动写回打开的文件；网页里用「导入项目」即可查看，或 `pnpm cli drc file.eda.json` 复核。
- 一个 MCP 进程同时只有一个文件目标。

---

## 3. 各客户端配置

**Claude Code**

```bash
claude mcp add tracelet -- pnpm --dir /path/to/tracelet cli serve --mcp --live
claude mcp list          # 查看
/mcp                     # 会话内查看状态
```

**Claude Desktop / Cursor / Cline 等（JSON 配置）**

```json
{
  "mcpServers": {
    "tracelet": {
      "command": "pnpm",
      "args": ["--dir", "/path/to/tracelet", "cli", "serve", "--mcp", "--live"]
    }
  }
}
```

文件模式把 `"--live"` 换成 `"-f", "/path/to/project.eda.json"`。

要求：Node ≥ 20，仓库已 `pnpm install`。`pnpm` 不在 PATH 时把 `command` 换成绝对路径（`which pnpm`）。

---

## 4. 工具一览

`?` 表示可选参数。长度单位：原理图 mil，PCB mm。

### 项目与目标

| 工具 | 说明 | 参数 |
|---|---|---|
| `list_open_projects` | 实时模式：已连接浏览器里打开的项目及当前激活项 | — |
| `use_project` | 选择要操作的浏览器项目；`"file"` 切回文件模式 | `id` |
| `open_project` | 打开 `.eda.json` | `file` |
| `new_project` | 新建项目；实时模式省略 `file` 直接在浏览器打开 | `file?`, `name?`, `layers?`(2/4), `demo?` |
| `list_templates` | 模板列表：blank / esp32 / stm32 / arduino | — |
| `new_from_template` | 按模板新建；实时模式省略 `file` 直接在浏览器打开 | `file?`, `template`, `name?`, `layers?` |
| `save_project` | 保存（可另存） | `file?` |
| `project_summary` | 图纸、元件、网络、ERC/DRC、PCB 统计 | — |
| `undo` | 撤销上一步（实时模式转发给浏览器） | — |

### 导入

| 工具 | 说明 | 参数 |
|---|---|---|
| `import_kicad` | KiCad 工程：多个 `.kicad_sch`（多页）+ 一个 `.kicad_pcb` | `files[]`, `out?` |
| `import_easyeda` | 嘉立创 EDA 标准版 JSON（原理图 / PCB / 工程导出） | `files[]`, `out?` |
| `import_library` | `.kicad_sym` / `.kicad_mod` / 立创符号封装 JSON → 项目库 | `files[]` |
| `generate_footprint` | 按 KiCad 风格名生成封装并加入项目库（`LQFP-48_7x7mm_P0.5mm`、`SOIC-8_3.9x4.9mm_P1.27mm`、`R_0603_1608Metric`、`PinHeader_1x04_P2.54mm_Vertical`、`SOT-23-5`…） | `name` |

### 读取与检查

| 工具 | 说明 | 参数 |
|---|---|---|
| `get_netlist` | 每个网络及其引脚 | — |
| `get_component` | 元件的值、封装、引脚与所接网络 | `ref` |
| `search_parts` | 内置零件目录 | `query`, `category?` |
| `list_symbols` | 内置与项目内符号 id | — |
| `run_erc` | 电气规则检查 | — |
| `run_drc` | PCB 设计规则检查 + 未布线数 | `rules?`(jlc / jlcpcb / generic) |
| `review_schematic` | 经验规则审查：去耦 / 上拉 / 限流 | — |

### 原理图编辑

| 工具 | 说明 | 参数 |
|---|---|---|
| `place_component` | 放置元件，`symbol` 可以是符号 id（`sym:R`）或零件 id / 型号 | `symbol`, `value?`, `x?`, `y?`, `sheet?` |
| `connect_pins` | 连接两个引脚，格式 `ref.pin`（编号或名称） | `a`, `b` |
| `add_net_label` | 给引脚加网络标签（跨页 / 远距离连接） | `pin`, `net` |
| `set_component_value` | 修改元件值 | `ref`, `value` |

### PCB 与导出

| 工具 | 说明 | 参数 |
|---|---|---|
| `sync_to_pcb` | 原理图 → PCB（新增 / 删除封装、更新焊盘网络） | — |
| `set_board_outline` | 矩形板框 | `width`, `height` |
| `move_footprint` | 移动 / 旋转封装 | `ref`, `x`, `y`, `rotation?` |
| `check_placement` | 布线前布局检查：重叠 / 出板 / 间距 / 去耦距离 / 晶振距离 / 连接器位置 / 干扰 / 长飞线 / 对齐 | — |
| `optimize_placement` | 模拟退火整理布局（不动锁定件、连接器、已布线器件），用试布线验证不变差才应用（可 undo） | `timeMs?`, `apply?` |
| `autoroute` | A* 自动布线并应用（可 undo） | `nets?[]` |
| `trace_lengths` | 按网络统计走线长度 / 段数 / 过孔 / 各层长度 | `net?` |
| `export_fab` | Gerber + Excellon + BOM + 坐标写入目录 | `dir` |
| `export_pdf` | 原理图 / 装配图 PDF | `schematic?`, `assembly?` |

---

## 5. 典型对话

1. **从零到制造文件（文件模式）**
   “用 esp32 模板新建 /tmp/demo.eda.json，跑 ERC，同步到 PCB，板框 50×40，自动布线，导出制造文件到 /tmp/demo-fab”
   → `new_from_template` → `run_erc` → `sync_to_pcb` → `set_board_outline` → `check_placement` / `optimize_placement` → `autoroute` → `export_fab`

2. **改我正在画的板子（实时桥）**
   “R3 改成 4.7k，再给 U1 的 IO0 加下拉”
   → `list_open_projects` → `set_component_value` → `place_component` → `connect_pins`；画面即时更新，不满意直接 ⌘Z。

3. **导入 KiCad 工程并体检**
   “导入 ~/kicad/door 里的工程，告诉我 DRC 有什么问题”
   → `import_kicad` → `run_drc` → `project_summary`

---

## 6. 排错

| 现象 | 处理 |
|---|---|
| 工具报“浏览器还没有连接” | 网页 头像菜单 → 本地 Agent 未开启，或端口不一致；顶栏应显示「Agent 已连接」 |
| 顶栏一直「Agent 连接中」 | MCP 进程没起来（客户端只在会话开始时拉起），或 `--port` 与网页设置不同；`lsof -i :8790` 查看占用 |
| 报“有 N 个浏览器项目，请先 use_project” | 多个标签页打开了不同项目，用 `list_open_projects` 选一个 |
| Agent 改动后画面没变 | 看网页控制台是否有 `[bridge]` 报错；重开一次连接开关会重新镜像 |
| 文件模式改了但网页没变化 | 网页读取的是浏览器存储，不会自动读磁盘；用「导入项目」或改用实时桥 |
| `pnpm: command not found` | 客户端的 PATH 不含 pnpm，配置里用绝对路径 |

安全说明：实时桥只监听 127.0.0.1，没有鉴权，任何本机进程都能连；不要在共享主机上开启。Agent 的修改都可撤销，但 `export_*` 会直接写磁盘。
