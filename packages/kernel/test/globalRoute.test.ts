import { describe, it, expect } from 'vitest';
import { globalRoute } from '../src/board/globalRoute.js';
import { createFromTemplate, autoroute, ruleSetOf, netRules } from '../src/index.js';

describe('全局路由（粗网格协商拥塞）', () => {
  it('两条连接争用一条只容一线的通道时，协商后不再超容量', () => {
    // 细网格 64×32，中间一堵墙只留 4 格宽的口子（粗格 f=4 → 恰好 1 个粗格，容量 ≈ 1 线）
    const W = 64, H = 32, f = 4;
    const blocked = (x: number, y: number) => x >= 30 && x <= 33 && !(y >= 14 && y <= 17);
    const lines = [
      { net: 'A', a: { x: 4, y: 8 }, b: { x: 60, y: 8 } },
      { net: 'B', a: { x: 4, y: 24 }, b: { x: 60, y: 24 } }
    ];
    const r = globalRoute({ W, H, L: 2, f, lines, toCell: (p) => ({ x: p.x, y: p.y }), cellFree: (x, y) => !blocked(x, y), viaFree: (x, y) => !blocked(x, y), layersAt: () => undefined, pitch: 0.38, coarseMm: 0.38 * 1.2, maxIters: 30 });
    expect(r.CW).toBe(16); expect(r.CH).toBe(8);
    expect(r.corridors.get('A')).toBeTruthy(); expect(r.corridors.get('B')).toBeTruthy();
    // 通道粗格 (7..8, 4) 上两条线不能都挤在同一层
    expect(r.overused).toBe(0);
    const a = r.corridors.get('A')!, b = r.corridors.get('B')!;
    const cidx = (x: number, y: number, l: number) => (l * r.CH + y) * r.CW + x;
    const gateBoth = [0, 1].every((l) => a[cidx(7, 4, l)] === 1 && b[cidx(7, 4, l)] === 1);
    expect(gateBoth).toBe(false);
  });
  it('可作为布线器的实验开关运行，结果仍连通且可与默认路径比较', () => {
    const p = createFromTemplate('esp32');
    const on = autoroute(p.board, ruleSetOf(p), { globalRoute: true });
    const off = autoroute(p.board, ruleSetOf(p));
    expect(on.routed).toBe(on.total); expect(off.routed).toBe(off.total);
    expect(netRules(p.board, ruleSetOf(p), 'GND').width).toBe(0.5);
  });
});
