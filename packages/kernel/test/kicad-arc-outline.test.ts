import { describe, expect, it } from 'vitest';
import { importKicadPcb } from '../src/io/kicad.js';

/**
 * KiCad 5 的圆弧参数化与 KiCad 6+ 完全不同，连 `start` 的含义都不一样：
 *   KiCad 5    (gr_arc (start 圆心) (end 起点) (angle 张角°))
 *   KiCad 6+   (gr_arc (start 起点) (mid 中点) (end 终点))
 * 只认三点式的话，KiCad 5 板子的**圆角会被静默丢掉**，Edge.Cuts 的链在圆角处断开，
 * 板框退化成一条缝或一个小矩形，于是器件全被判成"在板外"、布局器把它们挤成一堆重叠。
 * 语料库里 67 块板是 KiCad 5 格式，31 块评估板里有 9 块 Edge.Cuts 上带这种弧。
 * 实测 STRF（RF 板）导入后板框从 39×15 mm 变成 18.8×0.1 mm。
 */
const k5 = (body: string) => `(kicad_pcb (version 20171130) (host pcbnew "(5.1.5)-3")
  (general (thickness 1.6))
  (layers (0 F.Cu signal) (31 B.Cu signal) (44 Edge.Cuts user))
${body}
)`;

/** 20×10 的圆角矩形：四条直边 + 四个 2mm 圆角，全部用 KiCad 5 的参数化写。 */
const roundedRect = k5(`
  (gr_line (start 2 0) (end 18 0) (layer Edge.Cuts) (width 0.05))
  (gr_line (start 20 2) (end 20 8) (layer Edge.Cuts) (width 0.05))
  (gr_line (start 18 10) (end 2 10) (layer Edge.Cuts) (width 0.05))
  (gr_line (start 0 8) (end 0 2) (layer Edge.Cuts) (width 0.05))
  (gr_arc (start 18 2) (end 18 0) (angle 90) (layer Edge.Cuts) (width 0.05))
  (gr_arc (start 18 8) (end 20 8) (angle 90) (layer Edge.Cuts) (width 0.05))
  (gr_arc (start 2 8) (end 2 10) (angle 90) (layer Edge.Cuts) (width 0.05))
  (gr_arc (start 2 2) (end 0 2) (angle 90) (layer Edge.Cuts) (width 0.05))
`);

const bbox = (pts: { x: number; y: number }[]) => ({
  w: Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x)),
  h: Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y))
});

describe('KiCad 5 圆弧板框', () => {
  it('圆角矩形的尺寸与点数正确，而不是退化成一条缝', () => {
    const { board } = importKicadPcb(roundedRect);
    const b = bbox(board.outline);
    expect(b.w).toBeCloseTo(20, 1);
    expect(b.h).toBeCloseTo(10, 1);
    // 四段弧各展开成多个点，远多于只连直边时的 8 个端点
    expect(board.outline.length).toBeGreaterThan(20);
  });

  it('圆弧展开的点都落在圆角半径上，说明张角的方向没弄反', () => {
    const { board } = importKicadPcb(roundedRect);
    // 右下圆角：圆心 (18,2)，半径 2。方向若反了，点会跑到板外（离圆心 2 但在错误象限）
    const near = board.outline.filter((p) => Math.abs(Math.hypot(p.x - 18, p.y - 2) - 2) < 0.01);
    expect(near.length).toBeGreaterThan(0);
    for (const p of near) { expect(p.x).toBeGreaterThanOrEqual(18 - 0.01); expect(p.y).toBeLessThanOrEqual(2 + 0.01); }
  });

  it('KiCad 6+ 的三点式圆弧不受影响', () => {
    const { board } = importKicadPcb(`(kicad_pcb (version 20240108) (generator "pcbnew")
      (general (thickness 1.6)) (layers (0 "F.Cu" signal) (44 "Edge.Cuts" user))
      (gr_line (start 2 0) (end 18 0) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 20 2) (end 20 10) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 20 10) (end 0 10) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 0 10) (end 0 0) (layer "Edge.Cuts") (width 0.05))
      (gr_line (start 0 0) (end 2 0) (layer "Edge.Cuts") (width 0.05))
      (gr_arc (start 18 0) (mid 19.414 0.586) (end 20 2) (layer "Edge.Cuts") (width 0.05))
    )`);
    const b = bbox(board.outline);
    expect(b.w).toBeCloseTo(20, 1);
    expect(b.h).toBeCloseTo(10, 1);
  });
});

/**
 * KiCad 库名里的 `_Vertical` / `_Horizontal` 是封装作者写的约定，可以读；
 * 但**只读对接方式、绝不读出方向**——方向错了整块板报废，那个值只能来自核对过实物的人。
 */
describe('从封装名读对接方式', () => {
  const connOf = (lib: string) => {
    const { board, footprints } = importKicadPcb(`(kicad_pcb (version 20171130) (host pcbnew "(5.1.5)-3")
      (general (thickness 1.6))
      (layers (0 F.Cu signal) (31 B.Cu signal) (44 Edge.Cuts user))
      (gr_line (start 0 0) (end 20 0) (layer Edge.Cuts) (width 0.05))
      (gr_line (start 20 0) (end 20 10) (layer Edge.Cuts) (width 0.05))
      (gr_line (start 20 10) (end 0 10) (layer Edge.Cuts) (width 0.05))
      (gr_line (start 0 10) (end 0 0) (layer Edge.Cuts) (width 0.05))
      (module ${lib} (layer F.Cu) (at 5 5)
        (fp_text reference J1 (at 0 0) (layer F.SilkS))
        (pad 1 smd rect (at 0 0) (size 1 1) (layers F.Cu))
      )
    )`);
    const id = board.footprints[0].footprintId;
    return footprints.find((d) => d.id === id)!.connector;
  };

  it('_Vertical → 立式，无面内方向', () => {
    const c = connOf('Connector_PinHeader_1.27mm:PinHeader_2x05_P1.27mm_Vertical');
    expect(c?.mounting).toBe('vertical');
    expect(c?.direction).toBeUndefined();   // 立式没有方向，也绝不编一个
  });

  it('EdgeMount → 卧式，但方向仍然未知', () => {
    const c = connOf('Connector_Coaxial:SMA_Samtec_SMA-J-P-X-ST-EM1_EdgeMount');
    expect(c?.mounting).toBe('horizontal');
    expect(c?.direction).toBeUndefined();   // 名字里没有方向信息，仍需人工确认
  });

  it('厂商料号名 → 什么都不声明', () => {
    expect(connOf('10118193-0001LF:101181930001LF')).toBeUndefined();
  });
});
