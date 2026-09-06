/** Compare two local router modules on the exact same disposable placed board.
 * node --import tsx scripts/compare-routing.mts project.eda.json path/to/baseline.ts
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { autoroute, optimizePlacement, applyPlacement, ruleSetOf, computeRatsnest, runDrc } from '../packages/kernel/src/index.js';
import { registerProjectLibrary } from '../packages/kernel/src/library/registry.js';

const [projectPath, baselinePath] = process.argv.slice(2);
if (!projectPath || !baselinePath) throw new Error('Expected project JSON and a local baseline router module');
const baseline = (await import(pathToFileURL(resolve(baselinePath)).href)).autoroute as typeof autoroute;
const project = JSON.parse(readFileSync(projectPath,'utf8'));
registerProjectLibrary(project.library);
const rules=ruleSetOf(project);
for(const copperCount of [2,4] as const) {
 const raw={...project.board,copperCount,traces:[],vias:[],zones:[]};
 const placement=optimizePlacement(raw,rules,{mode:'initial',iterations:10000,seed:1,verifyRouting:false});
 const board=applyPlacement(raw,placement.moves);
 for(const [engine,run] of [['baseline',baseline],['current',autoroute]] as const) {
  const r=run(board,rules,{timeBudgetMs:10000,maxNodes:120000});
  const output={...board,traces:r.traces.map((t,i)=>({...t,id:'t'+i})),vias:r.vias.map((v,i)=>({...v,id:'v'+i}))};
  const violations:Record<string,number>={};
  for(const i of runDrc(output,rules).items) if(i.severity==='error') violations[i.rule]=(violations[i.rule]??0)+1;
  console.log(JSON.stringify({engine,copperCount,remaining:computeRatsnest(output,rules).unrouted,violations,ms:r.ms,vias:r.vias.length,length:r.traces.reduce((s,t)=>s+t.points.slice(1).reduce((n,p,i)=>n+Math.hypot(p.x-t.points[i].x,p.y-t.points[i].y),0),0)}));
 }
}
