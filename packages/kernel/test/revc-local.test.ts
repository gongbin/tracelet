import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allPads } from '../src/board/geometry.js';
import { importKicadProject, ruleSetOf, autoroute, computeRatsnest, runDrc } from '../src/index.js';
import { zoneFills, pointInFill } from '../src/board/zones.js';

// Opt-in integration check; the user's board is read in place, never copied or modified.
const dir = process.env.TRACELET_KICAD_TEST_DIR;
it.skipIf(!dir)('imports and routes a local KiCad project', () => {
  const stem = process.env.TRACELET_KICAD_TEST_STEM ?? 'door-revc';
  const { project, warnings } = importKicadProject({ name: 'local routing check',
    pcb: readFileSync(join(dir!, `${stem}.kicad_pcb`), 'utf8'),
    schematics: [{ name: stem, text: readFileSync(join(dir!, `${stem}.kicad_sch`), 'utf8') }]
  });
  const b = project.board, rules = ruleSetOf(project);
  if (process.env.TRACELET_ROUTING_LAYERS === '4') b.copperCount = 4;
  const full = process.env.TRACELET_ROUTING_FULL === '1';
  const t = performance.now(); const fills = zoneFills(b, rules); const fillMs = performance.now() - t;
  const before = computeRatsnest(b, rules).unrouted;
  console.log(JSON.stringify({ phase: 'import', warnings, footprints: b.footprints.length, traces: b.traces.length, vias: b.vias.length, zones: b.zones.length, polygons: fills.map(f => f.polygons.length), fillMs, before }));
  const result = autoroute(b, rules, { noRetry: !full, allowComponentMoves: full, maxNodes: Number(process.env.TRACELET_ROUTING_MAX_NODES ?? (full ? 200000 : 120000)) });
  const after = { ...b, footprints: b.footprints.map(fp => { const m = result.moves?.find(m=>m.id===fp.id); return m ? {...fp,x:m.x,y:m.y} : fp; }), traces: [...b.traces, ...result.traces.map((t, i) => ({ ...t, id: `local-tr-${i}` }))], vias: [...b.vias, ...result.vias.map((v, i) => ({ ...v, id: `local-v-${i}` }))] };
  const remaining = computeRatsnest(after, rules).unrouted;
  const counts = (board: typeof b) => { const out: Record<string, number> = {}; for (const i of runDrc(board, rules).items) out[i.rule] = (out[i.rule] ?? 0) + 1; return out; };
  console.log(JSON.stringify({ phase: 'route', ms: result.ms, routed: result.routed, total: result.total, remaining, traces: result.traces.length, vias: result.vias.length, failed: result.failed, drcBefore: counts(b), drcAfter: counts(after) }));
  // This board has no imported zones. Exercise fills explicitly on a disposable board copy.
  const zoned = { ...after, zones: (['F.Cu', 'B.Cu'] as const).map((layer) => ({ id: `test-${layer}`, layer, net: 'GND', polygon: b.outline, thermal: 'relief' as const, thermalGap: .3, spokeWidth: .4, clearance: 0 })) };
  const fillStart = performance.now(); const groundFills = zoneFills(zoned, rules);
  console.log(JSON.stringify({ phase: 'added-ground-zones', ms: performance.now() - fillStart, polygons: groundFills.map(f => f.polygons.length) }));
  expect(groundFills.every(f => f.polygons.length > 0)).toBe(true);
  for (const fill of groundFills) for (const p of allPads(zoned)) {
    if (p.layers.includes(fill.zone.layer) && p.net !== 'GND') expect(pointInFill(fill, p.center), `${p.ref}.${p.number}`).toBe(false);
  }
  expect(counts(after).clearance ?? 0).toBeLessThanOrEqual(counts(b).clearance ?? 0);
  expect(b.footprints.length).toBeGreaterThan(0);
  expect(remaining).toBeLessThanOrEqual(before);
  if (full) expect(remaining).toBe(0);
}, 180000);
