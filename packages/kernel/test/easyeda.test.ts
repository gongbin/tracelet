import { describe, it, expect } from 'vitest';
import { importEasyEdaProject, findEasyEdaDocs, svgPathToPolylines, importLibraryFile, buildSchematicNetlist, footprintPads, findFootprint, looksLikeEasyEda } from '../src/index.js';

const resistor = (ox: number, oy: number, ref: string, gid: string) => {
  const X = (dx: number) => ox + dx, Y = (dy: number) => oy + dy;
  return [
    `T~P~${X(10)}~${Y(-10)}~0~#000080~~7pt~~~~~${ref}~1~start~${gid}a~0`,
    `T~N~${X(10)}~${Y(20)}~0~#000080~~7pt~~~~~10k~1~start~${gid}b~0`,
    `R~${X(-5)}~${Y(0)}~2~2~10~30~#A00000~1~0~none~${gid}c~0`,
    `P~show~0~1~${X(0)}~${Y(-10)}~90~${gid}d~0^^${X(0)}~${Y(-10)}^^M ${X(0)} ${Y(-10)} v 10~#880000^^0~${X(3)}~${Y(-5)}~0~1~start~~~#0000FF^^1~${X(-2)}~${Y(-5)}~0~1~end~~~#0000FF^^0~${X(0)}~${Y(-10)}^^0~M ${X(0)} ${Y(-10)}`,
    `P~show~0~1~${X(0)}~${Y(40)}~270~${gid}e~0^^${X(0)}~${Y(40)}^^M ${X(0)} ${Y(40)} v -10~#880000^^0~${X(3)}~${Y(35)}~0~2~start~~~#0000FF^^1~${X(-2)}~${Y(35)}~0~2~end~~~#0000FF^^0~${X(0)}~${Y(40)}^^0~M ${X(0)} ${Y(40)}`
  ].join('#@$');
};
const schDoc = {
  head: { docType: '1', c_para: { title: 'Demo Sheet' } },
  canvas: 'CA~1000~1000~#FFFFFF~yes~#CCCCCC~5~1000~1000~line~5~pixel~5~0~0',
  shape: [
    `LIB~400~300~package\`R0603\`spicePre\`R\`Manufacturer_Part\`0603WAF1002T5E\`Supplier Part\`C25744\`~0~~gge1~0#@$${resistor(400, 300, 'R1', 'g1')}`,
    'W~400 290 400 270~#008800~1~0~none~gge2~0',
    'N~400~270~0~#0000FF~VIN~gge3~400~270~1~start',
    'J~400~270~2.5~#CC0000~gge4~0',
    'W~400 340 400 360~#008800~1~0~none~gge5~0',
    'F~part_netLabel_gnD~400~360~0~gge6~0#@$T~L~405~372~0~#000080~~7pt~~~~~GND~1~start~gge7~0',
    `LIB~500~300~package\`R0603\`spicePre\`R\`~90~~gge8~0#@$${resistor(500, 300, 'R2', 'g2')}`,
    'W~510 300 530 300~#008800~1~0~none~gge9~0',
    'N~530~300~0~#0000FF~OUT~gge10~530~300~1~start',
    'T~L~100~100~0~#000000~~9pt~~~~comment~Hello~1~start~gge11~0'
  ]
};
const pcbDoc = {
  head: { docType: '3' },
  canvas: 'CA~1000~1000~#000000~yes~#FFFFFF~10~1000~1000~line~1~mil~1~45~45~4000~3000~0~yes',
  shape: [
    'LIB~4100~3050~package`R0603`~90~~gge20~0#@$PAD~RECT~4100~3046.75~3.54~3.74~1~VIN~1~0~~90~gge21~0~~Y~0~0~0.2~#@$PAD~RECT~4100~3053.25~3.54~3.74~1~GND~2~0~~90~gge22~0~~Y~0~0~0.2~#@$TEXT~P~4100~3040~0.8~90~~3~~4.5~R1~~~gge23~~0#@$TRACK~0.6~3~~4096 3044 4104 3044 4104 3056 4096 3056 4096 3044~gge24~0',
    'TRACK~1~1~VIN~4100 3046.75 4150 3046.75~gge25~0',
    'VIA~4150~3046.75~2.4~VIN~1.2~gge26~0',
    'COPPERAREA~1~2~GND~M 4010 3010 L 4190 3010 L 4190 3140 L 4010 3140 Z~1~solid~gge27~spoke~yes~~0',
    'TRACK~1~10~~4000 3000 4200 3000 4200 3150~gge28~0',
    'ARC~1~10~~M 4200 3150 A 10 10 0 0 1 4190 3160~~gge29~0',
    'TRACK~1~10~~4190 3160 4000 3160 4000 3000~gge30~0',
    'HOLE~4020~3020~6.3~gge31~0',
    'TEXT~L~4100~3120~0.8~0~~3~~5~v1.0~~~gge32~~0'
  ]
};

describe('EasyEDA 标准版导入', () => {
  it('SVG 路径子集', () => {
    const pl = svgPathToPolylines('M 0 0 h 10 v 5 L 0 5 Z');
    expect(pl[0].map((p) => [p.x, p.y])).toEqual([[0, 0], [10, 0], [10, 5], [0, 5], [0, 0]]);
    const arc = svgPathToPolylines('M 0 0 A 5 5 0 0 1 10 0', 4)[0];
    expect(arc.length).toBe(5); expect(arc[2].y).toBeCloseTo(-5, 1);
  });
  it('原理图：元件、旋转后引脚与导线连通、标签 / 地符号 / 结点', () => {
    const { project, warnings } = importEasyEdaProject({ name: 'e', files: [{ name: 'sch.json', text: JSON.stringify(schDoc) }] });
    expect(warnings).toEqual([]);
    const sh = project.schematic.sheets[0];
    expect(sh.name).toBe('Demo Sheet');
    const r1 = sh.components.find((c) => c.ref === 'R1')!, r2 = sh.components.find((c) => c.ref === 'R2')!;
    expect(r1.value).toBe('10k'); expect(r1.props.lcsc).toBe('C25744'); expect(r1.footprint).toBe('fp:easyeda:R0603');
    expect(r2.rotation).toBe(90);
    expect(r1.symbolId).toBe(r2.symbolId); // 相同几何去重
    expect(sh.junctions.length).toBe(1); expect(sh.graphics.some((g) => g.kind === 'text' && g.text === 'Hello')).toBe(true);
    const nl = buildSchematicNetlist(project.schematic);
    const netOf = (ref: string, pin: string) => nl.nets.find((n) => n.pins.some((p) => p.ref === ref && p.pinNumber === pin))?.name;
    expect(netOf('R1', '1')).toBe('VIN'); expect(netOf('R1', '2')).toBe('GND'); expect(netOf('R2', '1')).toBe('OUT');
    expect(sh.wires.every((w) => w.points.length >= 2 && (w.points[0].x !== w.points[1].x || w.points[0].y !== w.points[1].y))).toBe(true);
  });
  it('PCB：封装局部坐标、走线 / 过孔 / 铺铜 / 板框 / 孔 / 丝印，并与原理图关联', () => {
    const { project, warnings } = importEasyEdaProject({ name: 'e', files: [{ name: 'sch.json', text: JSON.stringify(schDoc) }, { name: 'pcb.json', text: JSON.stringify(pcbDoc) }] });
    expect(warnings).toEqual([]);
    const b = project.board;
    expect(b.outline.length).toBeGreaterThanOrEqual(4);
    const xs = b.outline.map((p) => p.x), ys = b.outline.map((p) => p.y);
    expect(Math.max(...xs)).toBeCloseTo(50.8, 1); expect(Math.max(...ys)).toBeCloseTo(40.64, 1);
    const r1 = b.footprints.find((f) => f.ref === 'R1')!;
    expect(r1.x).toBeCloseTo(25.4, 2); expect(r1.y).toBeCloseTo(12.7, 2); expect(r1.rotation).toBe(90);
    const def = findFootprint(r1.footprintId)!;
    const p1 = def.pads.find((p) => p.number === '1')!; expect(p1.x).toBeCloseTo(-0.8255, 2); expect(p1.y).toBeCloseTo(0, 3); expect(p1.w).toBeCloseTo(0.899, 2); expect(p1.h).toBeCloseTo(0.95, 2);
    expect(r1.padNets).toEqual({ '1': 'VIN', '2': 'GND' });
    const pads = footprintPads(r1, b);
    expect(pads.find((p) => p.number === '1')!.center.y).toBeCloseTo((3046.75 - 3000) * 0.254, 2);
    expect(r1.componentId).toBe(project.schematic.sheets[0].components.find((c) => c.ref === 'R1')!.id);
    expect(b.traces.length).toBe(1); expect(b.traces[0].width).toBeCloseTo(0.254, 3); expect(b.traces[0].layer).toBe('F.Cu');
    expect(b.vias[0].net).toBe('VIN'); expect(b.zones[0].layer).toBe('B.Cu'); expect(b.zones[0].net).toBe('GND'); expect(b.zones[0].polygon.length).toBe(5);
    const hole = b.footprints.find((f) => f.ref === 'H1')!; expect(findFootprint(hole.footprintId)!.pads[0]).toMatchObject({ npth: true, drill: 3.2 });
    expect(b.texts[0]).toMatchObject({ text: 'v1.0', layer: 'F.Silk' });
    expect(b.copperCount).toBe(2);
  });
  it('工程导出结构（schematics / pcbs + dataStr 字符串）与库文档', () => {
    const bundle = { schematics: [{ title: 'Sheet_1', dataStr: JSON.stringify(schDoc) }], pcbs: [{ title: 'PCB_1', dataStr: pcbDoc }] };
    expect(findEasyEdaDocs(bundle).map((d) => [String(d.head.docType), d.title])).toEqual([['1', 'Sheet_1'], ['3', 'PCB_1']]);
    const r = importEasyEdaProject({ files: [{ name: 'proj.json', text: JSON.stringify(bundle) }] });
    expect(r.project.schematic.sheets[0].name).toBe('Sheet_1'); expect(r.project.board.footprints.length).toBe(2);
    const symDoc = { head: { docType: '2', x: 400, y: 300, c_para: { name: 'NE555', pre: 'U?', package: 'DIP-8' } }, shape: resistor(400, 300, 'U?', 's').split('#@$') };
    const fpDoc = { head: { docType: '4', x: 4000, y: 3000, c_para: { package: 'MYFP' } }, shape: ['PAD~ELLIPSE~3990~3000~6~6~11~~1~1.5~~0~gge40~0~~Y~0~0~0.3~', 'PAD~RECT~4010~3000~6~6~11~~2~1.5~~0~gge41~0~~Y~0~0~0.3~'] };
    const lib = importLibraryFile('parts.json', JSON.stringify([symDoc, fpDoc]));
    expect(lib.symbols.length).toBe(1); expect(lib.symbols[0].name).toBe('NE555'); expect(lib.symbols[0].prefix).toBe('U'); expect(lib.symbols[0].pins.length).toBe(2); expect(lib.symbols[0].defaultFootprint).toBe('fp:easyeda:DIP-8');
    expect(lib.footprints.length).toBe(1); expect(lib.footprints[0].id).toBe('fp:easyeda:MYFP'); expect(lib.footprints[0].pads[0]).toMatchObject({ drill: 0.762, shape: 'circle', x: -2.54 });
    expect(looksLikeEasyEda(JSON.stringify(bundle))).toBe(true); expect(looksLikeEasyEda('{"format":"eda-project"}')).toBe(false);
    expect(() => importEasyEdaProject({ files: [{ name: 'x.json', text: '{"a":1}' }] })).toThrow(/EasyEDA/);
  });
});
