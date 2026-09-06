/**
 * Read-only benchmark: pnpm exec tsx scripts/benchmark-pcb.ts [project.eda.json]
 * Results describe recomputed output connectivity, never internal route counters alone.
 */
import { readFileSync } from 'node:fs';
import { registerProjectLibrary } from '../packages/kernel/src/library/registry.js';
import { parseProject, createFromTemplate, ruleSetOf, optimizePlacement, applyPlacement, autoroute, computeRatsnest, runDrc } from '../packages/kernel/src/index.js';

const inputs = process.argv.slice(2);
const projects = inputs.length ? inputs.map(path => parseProject(readFileSync(path, 'utf8'))) : ['stm32', 'esp32'].map(id => createFromTemplate(id));
for (const project of projects) {
  registerProjectLibrary(project.library);
  const rules = ruleSetOf(project);
  for (const copperCount of [2, 4] as const) {
    // Strip routing on a disposable board; preserve imported mechanical placement.
    const board = { ...project.board, copperCount, traces: [], vias: [], zones: [] };
    const mode = process.env.TRACELET_PLACEMENT_MODE === 'initial' ? 'initial' : 'incremental';
    const placement = optimizePlacement(board, rules, { mode, iterations: 10000, seed: 1, verifyRouting: false });
    const placed = applyPlacement(board, placement.moves);
    const routed = autoroute(placed, rules, { timeBudgetMs: 10000, maxNodes: 120000 });
    const output = { ...placed,
      traces: routed.traces.map((t, i) => ({ ...t, id: 'bench-t-' + i })),
      vias: routed.vias.map((v, i) => ({ ...v, id: 'bench-v-' + i })) };
    const violations: Record<string, number> = {};
    for (const issue of runDrc(output, rules).items) if (issue.severity === 'error') violations[issue.rule] = (violations[issue.rule] ?? 0) + 1;
    console.log(JSON.stringify({ name: project.name, copperCount, mode, seed: 1,
      components: board.footprints.length, placementBefore: placement.before,
      placementAfter: placement.after, placementRejected: placement.rejected,
      placementMs: placement.ms, routeMs: routed.ms,
      unroutedBefore: computeRatsnest(placed, rules).unrouted,
      unroutedAfter: computeRatsnest(output, rules).unrouted, violations,
      vias: output.vias.length,
      lengthMm: output.traces.reduce((sum,t) => sum + t.points.slice(1).reduce((n,p,i) => n + Math.hypot(p.x-t.points[i].x,p.y-t.points[i].y),0),0),
      heapUsedBytes: process.memoryUsage().heapUsed }));
  }
}
