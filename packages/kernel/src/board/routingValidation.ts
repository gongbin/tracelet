import { copperShorts } from './copperConnectivity.js';
import type { Board, Trace, Via } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import { runDrc } from './drc.js';
import { computeRatsnest } from './ratsnest.js';

/** Remove newly generated copper implicated in hard DRC errors; never remove imported copper. */
export function validateRoutingProposal(board: Board, rules: RuleSet, traces: Omit<Trace,'id'>[], vias: Omit<Via,'id'>[]) {
  const used = new Set([...board.traces,...board.vias,...board.footprints].map(o=>o.id));
  const fresh = (kind:string,i:number) => { let id=`__routing_${kind}_${i}`; while(used.has(id)) id+='_'; used.add(id); return id; };
  const ts = traces.map((t,i)=>({...t,id:fresh('trace',i)})), vs = vias.map((v,i)=>({...v,id:fresh('via',i)}));
  const owners = new Map([...ts,...vs].map(o=>[o.id,o.net]));
  const materialize = (rejected:Set<string>): Board => ({...board,traces:[...board.traces,...ts.filter(t=>!rejected.has(t.net))],vias:[...board.vias,...vs.filter(v=>!rejected.has(v.net))]});
  const rejected = new Set<string>(), errors = new Set<string>();
  // Removing copper can expose constraints checked by extensions; reach a fixed point.
  for (;;) {
    let changed = false;
    for (const item of [...runDrc(materialize(rejected),rules).items,...copperShorts(materialize(rejected),rules)]) {
      if (item.severity !== 'error' || item.rule === 'unrouted') continue;
      for (const id of item.objectIds ?? []) {
        const net = owners.get(id);
        if (net !== undefined && !rejected.has(net)) { rejected.add(net); errors.add(`${net}: ${item.rule}`); changed = true; }
      }
    }
    for(const pair of board.differentialPairs??[])if(rejected.has(pair.positive)||rejected.has(pair.negative)){
      for(const net of [pair.positive,pair.negative])if(!rejected.has(net)){rejected.add(net);errors.add(`${net}: differential pair rejected atomically`);changed=true;}
    }
    if (!changed) break;
  }
  return {traces:traces.filter(t=>!rejected.has(t.net)),vias:vias.filter(v=>!rejected.has(v.net)),rejectedNets:[...rejected],errors:[...errors],remaining:computeRatsnest(materialize(rejected),rules).lines};
}
