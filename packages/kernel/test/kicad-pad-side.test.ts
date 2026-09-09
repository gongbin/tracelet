import { describe, expect, it } from 'vitest';
import { importKicadPcb } from '../src/io/kicad.js';
import { registerFootprints } from '../src/library/registry.js';
import { footprintPads } from '../src/board/geometry.js';
import type { Board } from '../src/model/board.js';

/**
 * 两个真实板上暴露出来的导入 bug（keezyboost40，93 器件 511 走线的键盘板，导入后 131/132 未布通）：
 *  1. 焊盘可以显式声明在与封装**相反**的一面（Kailh 热插拔插座：本体正面装、焊盘背面焊），
 *     旧代码按封装面推导焊盘层，把它们放到了错误的铜层。
 *  2. 底面封装做了 x 镜像后，旋转的手性被翻转，角度不能再取负，否则左右焊盘对调。
 * 两者都不报错，只是让连通性 / DRC / 飞线 / 布线静默出错。
 */
const pcb = (body: string) => `(kicad_pcb (version 20240108) (generator "pcbnew")
  (general (thickness 1.6))
  (paper "A4")
  (layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user))
  (net 0 "")
  (net 1 "N1")
  (net 2 "N2")
${body})`;

const fp = (ref: string, layer: 'F.Cu' | 'B.Cu', at: string, padLayers: string) => `  (footprint "L:F" (layer "${layer}") (uuid "u-${ref}") (at ${at})
    (property "Reference" "${ref}" (at 0 -2 0) (layer "${layer === 'F.Cu' ? 'F' : 'B'}.SilkS") (uuid "r-${ref}"))
    (attr smd)
    (pad "1" smd rect (at -1.65 0) (size 1 1) (layers ${padLayers}) (net 1 "N1") (uuid "p1-${ref}"))
    (pad "2" smd rect (at 1.65 0) (size 1 1) (layers ${padLayers}) (net 2 "N2") (uuid "p2-${ref}")))`;

function pads(text: string, ref: string) {
  const r = importKicadPcb(text);
  registerFootprints(r.footprints);
  const board = { ...r.board, copperCount: 2 } as Board;
  const f = board.footprints.find((x) => x.ref === ref)!;
  const ps = footprintPads(f, board);
  return { f, byNumber: (n: string) => ps.find((p) => p.number === n)! };
}

describe('KiCad 导入：焊盘所在面', () => {
  it('焊盘显式声明在封装的对面时，铜层跟着焊盘走而不是跟着封装走', () => {
    const { byNumber } = pads(pcb(fp('U1', 'F.Cu', '100 100', '"B.Cu" "B.Paste" "B.Mask"')), 'U1');
    expect(byNumber('1').layers).toEqual(['B.Cu']);
    expect(byNumber('1').def.oppositeSide).toBe(true);
  });

  it('同面焊盘不会被误标为对面', () => {
    const { byNumber } = pads(pcb(fp('U1', 'F.Cu', '100 100', '"F.Cu" "F.Paste" "F.Mask"')), 'U1');
    expect(byNumber('1').layers).toEqual(['F.Cu']);
    expect(byNumber('1').def.oppositeSide).toBeUndefined();
    const b = pads(pcb(fp('U2', 'B.Cu', '100 100', '"B.Cu" "B.Paste" "B.Mask"')), 'U2');
    expect(b.byNumber('1').layers).toEqual(['B.Cu']);
    expect(b.byNumber('1').def.oppositeSide).toBeUndefined();
  });

  it('底面封装旋转 90°：焊盘左右不对调（镜像已翻转旋转手性，角度不再取负）', () => {
    // 取自真实板 keezyboost40 的 D30：(footprint (layer "B.Cu") (at 225.7751 61.8 90))，
    // 文件里 Net-(D30-Pad2) 的走线正起于 (225.7751, 60.15)，即 pad 2 在 y−1.65 处。
    const { f, byNumber } = pads(pcb(fp('D30', 'B.Cu', '225.7751 61.8 90', '"B.Cu" "B.Paste" "B.Mask"')), 'D30');
    expect(f.side).toBe('B');
    expect(byNumber('2').center.x).toBeCloseTo(225.7751, 4);
    expect(byNumber('2').center.y).toBeCloseTo(60.15, 4);
    expect(byNumber('1').center.y).toBeCloseTo(63.45, 4);
  });

  it('顶面封装旋转 90° 的既有行为不变', () => {
    const { f, byNumber } = pads(pcb(fp('R1', 'F.Cu', '100 100 90', '"F.Cu" "F.Paste" "F.Mask"')), 'R1');
    expect(f.side).toBe('F');
    expect(byNumber('2').center.x).toBeCloseTo(100, 4);
    expect(byNumber('2').center.y).toBeCloseTo(98.35, 4);
    expect(byNumber('1').center.y).toBeCloseTo(101.65, 4);
  });
});
