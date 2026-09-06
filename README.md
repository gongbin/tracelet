# Tracelet — open-source online PCB design for makers

English · [简体中文](./README.zh-CN.md)

A TypeScript headless kernel + web editor + CLI + MCP server, with an optional self-hosted remote storage server. Schematic → PCB → 3D → fab files, all in the browser; your data stays local by default.

## Parts library: built-in + community updates + mine

- **Built-in**: `packages/kernel/src/library/partsBase.ts`, ~150 common parts (0402/0603 E-series resistors, MLCCs, inductors / ferrite beads / fuses / electrolytics, diodes / TVS / ESD, BJTs / MOSFETs, LDOs / DC-DC / chargers, 555 / op-amps / comparators / shift registers / CH340C / SPI flash / DS18B20, ESP32 modules, crystals, tactile switches, pin headers / JST / USB-C). ICs come with real pin names; footprints are generated parametrically from the package name. Only part numbers and pins we are sure about are written; prices and stock are never hard-coded; LCSC codes only where certain.
- **Community**: Parts panel → Parts → "Update from web" fetches `data/parts.json` (defaults to this repo's main branch; point it at your own URL) and stores it in the browser. Maintain it by editing `partsBase.ts` or `data/parts.json`; `node scripts/build-parts.mjs` regenerates it from the built-in set.
- **Mine**: the same tab imports CSV / JSON (Chinese or English column names: mpn, maker, description, package, pins, LCSC, value; JLC / LCSC exports work as is), manual entry and export. The description drives auto-categorization; symbols are generated from the category or the pin list (`1:VDD;2:GND;…` yields a box symbol with pin names, a bare count yields numbered pins), footprints from the package name.
- Search, placement, the AI `search_parts` tool and BOM prices all use the merged set; on the same id "mine" overrides "community" overrides "built-in".

## AI assistant: attach a schematic right in the chat

The AI panel's chat box accepts 📎 attachments (PDF / PNG / JPG / WebP, multi-select, drag-in or paste a screenshot). Attach a schematic and press Enter: the model extracts parts, pins and nets, calls `generate_sheet_from_spec` to create the sheet and double-checks it with ERC and the rule-of-thumb review. You can also ask it to "modify the current sheet to match the attachment". The assistant has full read / write tools: place / delete / move / rotate parts, change value / footprint / reference, wire, net labels, new / switch sheet, autoroute, all undoable. The "Reference designs" tab still searches vendor reference-design PDFs.

## User name and title-block author

Click the avatar (top right) to set your name: every sheet in a new project gets it as the title-block author, and older sheets without an author show and export it too. Local mode keeps it in the browser; remote mode stores it via `GET/PUT /api/me` (file storage writes `data/_user.json`, PostgreSQL uses a `users` table seeded on first start with `owner@tracelet.local`).

## Altium Designer import

Imports .SchDoc / .PcbDoc directly (OLE compound binary; an independent parser whose format knowledge comes from public implementations such as KiCad and altium2kicad):

- Schematic: components (symbol graphics, pins, reference, Comment, footprint name), wires, buses, junctions, net labels, ports, power ports (mapped to built-in GND / power symbols), sheet symbols and entries (connected by name), free text and frames. Multi-part components import the current part.
- PCB: board outline (Board Shape / Keep-Out), components and footprints (pad shapes / holes / rotation / bottom-side mirroring), tracks, arcs, vias, polygon pour outlines and rectangular fills, silkscreen text, 2 or 4 layers (only the first two inner layers are kept).
- Schematic components and PCB footprints are linked by reference; pad nets come from the PCB and are filled from the schematic netlist when missing.
- Not yet: SchLib / PcbLib / IntLib libraries, blind / buried vias, slots, split planes (those nets show as unrouted), rule → net class mapping, images. Pads of components rotated by non-90° angles are approximated as axis-aligned rectangles, so DRC may report false positives there.

Usage: multi-select all .SchDoc + .PcbDoc and drop them on the page (or Home → Import); CLI `tracelet import altium a.SchDoc b.SchDoc board.PcbDoc -o out.eda.json`; MCP `import_altium`.

## Placement check and optimization

The PCB toolbar's "Placement" tool (also in the Guide) checks first, then proposes previewable moves based on common layout practice:

- Legality: inside the outline, no overlaps, 0.5–1.5 mm channels between parts, ≥0.6 mm between pads, ≥ copper-to-edge + 0.3 mm from the edge. Parts outside / overlapping are first placed constructively by connectivity (ICs first, the rest near their strongest neighbors), then refined by annealing.
- Affinity: passives sharing nets with an IC sit at the matching pins. Capacitors sharing two nets (boost / buck in-out caps, decoupling) weigh most, inductors / diodes (switch node) next, resistors least; decoupling caps must also be near power pins, crystals near the MCU.
- Aesthetics and balance: neighboring small parts of a kind share orientation and line up in rows; without fixed parts the layout is centered rather than piled on one side.
- Connectors: at the edge, facing outward (judged from pad centroid vs body center).
- Antennas: the pad-free end of an RF module is treated as the antenna area with a 5 mm keep-out, pushed toward the edge.
- Interference: crystals / analog parts away from switching and driver parts.

When the original placement is legal, the suggestion is verified by a trial autoroute and shown only if routing does not get worse; when it is illegal (outside / overlapping), a routable cleanup is offered directly.

## Fab rules (DRC) vs. JLCPCB capabilities

The `jlc` / `jlcpcb` rule sets follow JLC's public capability page ([www.jlc.com/portal/vtechnology.html](https://www.jlc.com/portal/vtechnology.html), checked 2026-09) with margin over the fab limits:

| Item | JLC limit / recommendation | Tracelet default |
|---|---|---|
| Trace / space (2-layer 1 oz) | 0.10 / 0.10 | error < 0.127 |
| Trace / space (2 oz outer) | 0.16 / 0.16 | 0.16 when stackup copper ≥ 2 oz |
| Via drill | 0.15 limit · 0.3 standard | error < 0.2, surcharge note < 0.3 |
| Via annular ring (OD − ID)/2 | ≥ 0.05 | error < 0.1 |
| THT annular ring | 0.18 limit · 0.25 recommended | error < 0.18, warning < 0.25 |
| Hole edge to hole edge | via 0.2 · THT 0.45 | error < 0.2, THT warning < 0.45 |
| THT hole edge to other-net copper | 0.28 limit · 0.35 recommended | error < 0.28 |
| Non-plated hole keep-out | 0.2 | error when copper < 0.2 from an NPTH |
| Copper to board edge | routed 0.2 · V-cut 0.4 | warning < 0.3 |
| Silk height / silk to pad | 1.0 / 0.15 | warning below 1.0, warning over pads |
| Minimum board | 3 × 3 mm | error below |
| Thickness | 0.4 – 2.0 standard steps | warning for non-standard |

Solder-mask dams (0.1 mm), slots, castellated holes and gold fingers are not covered by DRC yet.

## Layout

```
packages/kernel   headless kernel: data model, commands (undo/redo), connectivity/netlist, ERC, schematic→PCB sync, ratsnest, DRC, export
packages/db       PostgreSQL schema (Drizzle)
apps/web          React + Vite editor (home / schematic / PCB / 3D / library / BOM / fab)
apps/cli          tracelet CLI + MCP server, shares the kernel with the web app
apps/server       remote storage server (Hono REST; PostgreSQL or JSON files) for small teams to self-host
scripts/          KiCad standard 3D model → GLB conversion (models in apps/web/public/models3d)
```

## Getting started

```bash
pnpm install
pnpm dev                 # http://localhost:5173
pnpm test                # kernel unit tests + web smoke tests
pnpm typecheck
pnpm cli --help          # tracelet CLI
pnpm cli new demo.eda.json --demo && pnpm cli drc demo.eda.json
pnpm cli new stm32.eda.json -t stm32  # templates: blank | esp32 | stm32 | arduino (pnpm cli templates)
pnpm cli export zip demo.eda.json     # full fab package (incl. assembly PDF)
pnpm cli export pdf demo.eda.json     # schematic PDF
pnpm cli import kicad board.kicad_sch board.kicad_pcb -o board.eda.json
pnpm cli import easyeda Schematic_x.json PCB_x.json -o x.eda.json          # EasyEDA Standard
pnpm cli import lib demo.eda.json MyParts.kicad_sym Package.pretty/*.kicad_mod   # KiCad libraries → project library
pnpm cli footprint gen demo.eda.json LQFP-48_7x7mm_P0.5mm                        # parametric footprint
```

## What works today (v0.1)

- Schematic: place / wire / label / rotate / undo-redo, live ERC, deterministic design review (decoupling, pull-ups, current limiting) with one-click fixes
- PCB: 45° routing, via layer changes, zones (avoid other-net copper, drop islands), ratsnest, live DRC, layer visibility and opacity
- Fab: Gerber RS-274X (copper / mask / paste / silk / outline) + Excellon (PTH / NPTH) + BOM + placement file + assembly PDF (top / bottom) + schematic PDF + README (process parameters) in one zip; an "Ordering guide" lists parameters and popular vendors (no redirects); Gerber preview renders the exported files through a third-party parser (tracespace)
- Library: built-in parts catalog searchable by part number / specs, 42 category icons for filtering; All / Project / Favorites / Parts tabs; KiCad library import (`.kicad_sym` multi-symbol / multi-unit / derived symbols, `.kicad_mod`); parametric footprints (0201–2512 SMD, SOIC/TSSOP, LQFP, QFN, DIP, headers / sockets, SOT-23); KiCad-style footprint names (e.g. `LQFP-48_7x7mm_P0.5mm`) get real geometry on import and sync
- Templates: ESP32 minimal system / STM32F103 minimal system / Arduino UNO shield, one click to schematic + pre-placed PCB
- Guide: the top-bar guide shows progress and one-click actions step by step (schematic: place → wire → ERC → sync; PCB: outline → placement → mounting holes → routing → pour GND → DRC → silkscreen → 3D → export)
- Inventory: track parts on hand (part number / value / symbol / footprint / qty / location), CSV in / out, place directly
- Import: KiCad 6/7/8 projects (several `.kicad_sch` = several sheets, `.kicad_pcb`); EasyEDA Standard JSON (File → Export → EasyEDA source: schematic / PCB / symbols / footprints; Pro users export Standard or KiCad first); Altium .SchDoc / .PcbDoc; symbols / footprints are saved with the project; project backup zip in / out
- Schematic extras: multiple sheets and sheet templates (A5–A1 / custom size, editable title block text and labels), buses, junctions, graphic notes (all draggable), measure, copy / paste, ⌥-drag duplicate, custom properties, grid switching
- PCB extras: box select, outline editing (rounded rectangles, polygons), trace vertex / segment dragging, live clearance check while routing, align / distribute, built-in autorouter (global shortest-first strict routing → soft-conflict probing with targeted rip-up → shove → via-in-pad candidates → fine-grid retry → 45° chamfer; layer direction preference, real geometric clearance validation; runs in a Web Worker with progress / cancel, preview before accept), hole tool (M2–M4 screw holes / plated holes), board-only footprints (mounting holes / fiducials / logos) placed directly, resize / drag the whole board / fit to content, status-bar grid / trace width / via selection, stackup and process parameters (thickness, copper, finish, mask / silk colors), part search / hide, clear routing tool, trace length statistics
- Gestures: trackpad two-finger pan / pinch zoom (wheel zoom optional), right-click or two-finger tap to end the current action
- 3D: Three.js real geometry (board with holes, pads, traces, zones, silk) + KiCad standard-library 3D models (244 common footprints converted to GLB, matched by footprint name; import your own GLB, convert STEP with KiCad / FreeCAD first), screenshot PNG / export GLB, click to select on the PCB
- Zones: thermal reliefs (gap and spoke width adjustable) or solid connections, reflected in Gerber
- URLs: `/p/<projectId>/sch/<sheetId>`, `/p/<projectId>/pcb|3d|lib|bom|fab`; reload and shared links return to the same place
- AI assistant: with your own Anthropic API key the model reads the netlist / runs ERC and DRC / places and wires / autoroutes through kernel tools (all undoable); "Reference designs" searches vendor dev-board schematic PDFs (built-in catalog + web) → recognizes parts and connections → generates a new sheet; upload your own PDF / screenshot too
- UI: dark / light / system; 简体中文 / English (`t()` dictionary plus a runtime fallback translator in `apps/web/src/i18n`)
- CLI: `tracelet new -t | templates | erc | drc | review | sync | placement check|optimize | export gerber|zip|pdf|assembly | import kicad|altium|easyeda|lib | footprint gen`, exit codes usable in CI

## MCP server

Full documentation (both modes, client configs, every tool's parameters, troubleshooting): [MCP.md](./MCP.md).

Exposes the Tracelet kernel to MCP clients such as Claude Code / Claude Desktop / Cursor (stdio). Two targets:

**1. The project open in your browser (recommended, a Figma-like live bridge)**

```bash
claude mcp add tracelet -- pnpm --dir /path/to/tracelet cli serve --mcp --live
```

Then in the web app: avatar menu → "Local agent (MCP live bridge)" → Enable (port 8790 by default, 127.0.0.1 only). Once the top bar shows "✨ Agent connected", the agent operates on your open project by id: `list_open_projects` lists `prj_xxx`, `use_project` selects it (auto-selected when only one is open), and every tool then acts in the browser as an undoable "Agent edit"; `undo` is forwarded to the browser; `new_project` / `new_from_template` without `file` open directly in the browser. Works with local and remote storage.

**2. A local file**

```bash
claude mcp add tracelet -- pnpm --dir /path/to/tracelet cli serve --mcp -f /path/to/project.eda.json
```

Tools: `open_project / new_project / new_from_template / list_templates / list_open_projects / use_project / import_kicad / import_altium / import_easyeda / import_library / generate_footprint / project_summary / get_netlist / get_component / run_erc / run_drc / review_schematic / search_parts / place_component / connect_pins / add_net_label / set_component_value / sync_to_pcb / move_footprint / set_board_outline / check_placement / optimize_placement / autoroute / trace_lengths / export_fab / export_pdf / undo`. In file mode every change is saved back to the open file.

## Storage modes

- **Personal (default)**: browser storage (IndexedDB), nothing to install.
- **Small team**: self-host `apps/server`; in the web app, avatar menu → Storage → Remote, enter the URL and token ("Test connection" available).

```bash
# File storage (zero dependencies, projects saved as ./data/*.json)
TRACELET_TOKEN=your-token pnpm --filter @tracelet/server start
# PostgreSQL
DATABASE_URL=postgres://user:pass@host/tracelet TRACELET_TOKEN=... PORT=8787 pnpm --filter @tracelet/server start
```

API: `GET /api/health`, `GET /api/projects`, `GET|PUT|DELETE /api/projects/:id` (PUT body is the project JSON, validated by the kernel), `GET|PUT /api/me`. Schema in `packages/db` (the `projects` table is created on first start).

## Shortcuts

Schematic: `A` part · `W` wire · `P` power / GND · `L` label · `R/C/D` quick resistor / capacitor / LED · `R` rotate selection · `Del` delete
PCB: `X` route · `V` via while routing · `Z` zone · `A` board-only footprint · `M` measure · `F` flip · `R` rotate · `1-9` layer
Global: `⌘K` command palette (`@` parts, `#` nets) · `⌘Z` undo · `Tab` focus mode · `F8` next issue · Space + drag to pan

## License

[GPL-3.0-or-later](./LICENSE), the same license as KiCad. You may use, modify and sell Tracelet, including in commercial products; if you distribute a modified version you must publish its source under the same license. The kernel, CLI, web app and server are all covered. Third-party assets keep their own licenses (KiCad 3D models: CC-BY-SA 4.0 with the KiCad library exception; see `apps/web/public/models3d`).
