import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importAltiumProject, importAltiumPcb, importAltiumSch, looksLikeOle, buildSchematicNetlist, footprintPads, footprintBody, boardBounds, runDrc, RULE_SETS, registerProjectLibrary, getSymbol, pinGeoms } from '../src/index.js';

// 样例来自 KiCad 仓库 qa/data 的 Altium 测试文件（不入库）：TRACELET_ALTIUM_DIR=... npx vitest run test/altium.test.ts
const dir = process.env.TRACELET_ALTIUM_DIR ?? '';
const have = (f: string) => dir && existsSync(join(dir, f));
const load = (f: string) => new Uint8Array(readFileSync(join(dir, f)));

describe('Altium 导入', () => {
  it('非 OLE 数据被拒绝', () => {
    expect(looksLikeOle(new Uint8Array(1000))).toBe(false);
    expect(() => importAltiumPcb(new Uint8Array(1000))).toThrow();
  });
  it.skipIf(!have('eDP.PcbDoc'))('PcbDoc：板框 / 元件 / 焊盘 / 走线 / 过孔 / 铺铜，焊盘在本体内且在板内', () => {
    const r = importAltiumPcb(load('eDP.PcbDoc'));
    registerProjectLibrary({ symbols: [], footprints: r.footprints });
    const b = r.board; const bb = boardBounds(b);
    expect(bb.w).toBeGreaterThan(40); expect(bb.h).toBeGreaterThan(30);
    expect(b.copperCount).toBe(4);
    expect(b.footprints.length).toBeGreaterThan(100);
    expect(b.traces.length).toBeGreaterThan(1000);
    expect(b.vias.length).toBeGreaterThan(200);
    expect(b.zones.length).toBeGreaterThan(5);
    expect(new Set(b.traces.map((t) => t.net)).size).toBeGreaterThan(50);
    let outsideBoard = 0, outsideBody = 0, n = 0;
    for (const f of b.footprints) { const body = footprintBody(f); for (const p of footprintPads(f, b)) { n++; if (p.center.x < bb.x - 0.5 || p.center.x > bb.x + bb.w + 0.5 || p.center.y < bb.y - 0.5 || p.center.y > bb.y + bb.h + 0.5) outsideBoard++; if (p.center.x < body.x - 0.01 || p.center.x > body.x + body.w + 0.01 || p.center.y < body.y - 0.01 || p.center.y > body.y + body.h + 0.01) outsideBody++; } }
    expect(n).toBeGreaterThan(300); expect(outsideBoard).toBe(0); expect(outsideBody).toBe(0);
    // 已布好的板：按很小的间距跑 DRC，不应有大量"距离为 0"的重叠（说明几何解析错了）。
    // 非 90° 旋转的元件焊盘在本工程里是轴对齐近似，会有误报，排除在外。
    const rep = runDrc(b, { ...RULE_SETS.find((x) => x.id === 'generic')!, minClearance: 0.02, minTraceWidth: 0.05, minDrill: 0.1, minAnnularRing: 0.03 });
    const rotated = new Set(b.footprints.filter((f) => Math.abs(((f.rotation % 90) + 90) % 90) > 1e-6).map((f) => f.ref));
    const bad = rep.items.filter((i) => i.rule === 'clearance' && !i.refs.some((r) => [...rotated].some((ref) => r.includes(ref + '.'))));
    expect(bad.length).toBeLessThan(b.traces.length * 0.02);
  });
  it.skipIf(!have('eDP_core.SchDoc'))('SchDoc：元件 / 引脚落在栅格与导线端点上，网表成形', () => {
    const r = importAltiumSch(load('eDP_core.SchDoc'), { sheetName: 'core' });
    registerProjectLibrary({ symbols: r.symbols, footprints: [] });
    const s = r.sheet;
    expect(s.components.length).toBeGreaterThan(80);
    expect(s.wires.length).toBeGreaterThan(150);
    const ends = new Set(s.wires.flatMap((w) => w.points.map((p) => `${p.x},${p.y}`)));
    let total = 0, onGrid = 0, onWire = 0;
    for (const c of s.components) for (const g of pinGeoms(c, getSymbol(c.symbolId))) { total++; if (Math.abs(g.end.x % 100) < 1 && Math.abs(g.end.y % 100) < 1) onGrid++; if (ends.has(`${Math.round(g.end.x)},${Math.round(g.end.y)}`)) onWire++; }
    expect(onGrid).toBe(total);
    expect(onWire / total).toBeGreaterThan(0.7);
    const nl = buildSchematicNetlist({ sheets: [s], counters: {} });
    expect(nl.nets.length).toBeGreaterThan(50);
    expect(nl.unconnectedPins.length).toBeLessThan(total * 0.05);
  });
  it.skipIf(!have('eDP.PcbDoc') || !have('eDP_core.SchDoc'))('整工程：原理图元件与 PCB 封装按位号关联', () => {
    const r = importAltiumProject({ name: 'eDP', schematics: [{ name: 'core', data: load('eDP_core.SchDoc') }, { name: 'power', data: load('eDP_power.SchDoc') }], pcb: load('eDP.PcbDoc') });
    const p = r.project;
    expect(p.schematic.sheets.length).toBe(2);
    const linked = p.board.footprints.filter((f) => f.componentId).length;
    expect(linked / p.board.footprints.length).toBeGreaterThan(0.8);
    expect(p.library.footprints.length).toBeGreaterThan(10);
    expect(p.library.symbols.length).toBeGreaterThan(10);
  });
});
