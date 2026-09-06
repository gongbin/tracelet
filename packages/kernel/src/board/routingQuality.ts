import { referenceSupports } from './engineeringRules.js';
import { engineeringChecks } from './engineeringChecks.js';
import type { Board, Trace } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import type { CheckItem } from '../schematic/erc.js';
import { netClassFor } from './geometry.js';
import { zoneFills, pointInFill } from './zones.js';
import { copperLayers } from '../model/board.js';
import { pointSegDist } from '../geometry.js';

const length = (t: Trace) => t.points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x-t.points[i].x,p.y-t.points[i].y),0);
/** Conservative, auditable electrical checks. Length is total copper, not endpoint delay. */
export function electricalChecks(board: Board, rules?: RuleSet): Omit<CheckItem,'id'>[] {
  const out: Omit<CheckItem,'id'>[] = [];
  const nets = new Set(board.traces.map(t => t.net));
  for (const net of nets) {
    const nc = netClassFor(board, net); if (!nc) continue;
    const traces = board.traces.filter(t => t.net === net);
    const report = (rule: string, message: string, ts: Trace[]) => out.push({rule, message, severity:'error', why:'不满足约束', refs:[net,nc.name], objectIds:ts.map(t=>t.id), location:ts[0]?.points[0]});
    const forbidden = traces.filter(t=>nc.allowedLayers && !nc.allowedLayers.includes(t.layer));
    if (forbidden.length) report('allowed-layers','允许布线层：不满足约束',forbidden);
    if (nc.maxLength !== undefined && traces.reduce((n,t)=>n+length(t),0) > nc.maxLength+1e-6) report('max-length',`总铜线长度上限 (mm)：> ${nc.maxLength}`,traces);
    if (nc.neckdown) {
      const narrow = traces.filter(t=>t.width < nc.traceWidth-1e-6);
      // Total narrow copper is intentionally conservative, preventing split traces from bypassing the budget.
      if (narrow.length && (!nc.neckdown.allowed || narrow.some(t=>t.width < nc.neckdown!.minWidth-1e-6) || narrow.reduce((n,t)=>n+length(t),0) > nc.neckdown.maxLength+1e-6)) report('neckdown','缩颈策略：不满足约束',narrow);
    }
  }
  for (const pair of board.differentialPairs ?? []) {
    const a=board.traces.filter(t=>t.net===pair.positive),b=board.traces.filter(t=>t.net===pair.negative);
    const ids=[...a,...b].map(t=>t.id);
    const report=(rule:string,message:string)=>out.push({rule,message,severity:'warning',why:'几何筛查，不是耦合布线或阻抗验证；参考平面采样不能证明回流连续。',refs:[pair.positive,pair.negative],objectIds:ids});
    if(!a.length || !b.length){report('differential-incomplete','差分对检查：不满足约束');continue;}
    const skew=Math.abs(a.reduce((n,t)=>n+length(t),0)-b.reduce((n,t)=>n+length(t),0));
    if(skew>pair.maxSkew+1e-6)report('differential-skew',`总铜长差上限：${skew.toFixed(3)} > ${pair.maxSkew} mm`);
    const coverage=(own:Trace[],other:Trace[])=>own.every(t=>t.points.slice(1).every((end,i)=>{
      const start=t.points[i],dx=end.x-start.x,dy=end.y-start.y,len=Math.hypot(dx,dy);if(len<1e-9)return true;
      // Samples are screening evidence, never a proof of continuous coupling.
      const steps=Math.min(2000,Math.max(1,Math.ceil(len/.5)));
      for(let j=0;j<=steps;j++){
        const p={x:start.x+dx*j/steps,y:start.y+dy*j/steps};
        const ok=other.some(u=>u.layer===t.layer && u.points.slice(1).some((v,k)=>{
          const w=u.points[k],ux=v.x-w.x,uy=v.y-w.y,ul=Math.hypot(ux,uy);
          return ul>1e-9 && Math.abs(dx*uy-dy*ux)/(len*ul)<.01 && Math.abs(pointSegDist(p,w,v)-(t.width+u.width)/2-pair.gap)<=pair.tolerance+1e-6;
        }));
        if(!ok)return false;
      }
      return true;
    }));
    if(!coverage(a,b)||!coverage(b,a))report('differential-gap','差分对检查：铜边间距 / 允许布线层：不满足约束');
    report('differential-unverified','差分对检查：需要人工复核');
  }
  for(const nc of board.netClasses)if(nc.referenceLayer || nc.referenceNet){
    const traces=board.traces.filter(t=>netClassFor(board,t.net)===nc);
    if(!traces.length)continue;
    const fills=rules?zoneFills(board,rules).filter(f=>f.zone.layer===nc.referenceLayer && f.zone.net===nc.referenceNet):[];
    const layers=copperLayers(board.copperCount);
    const missing=traces.filter(t=>t.points.slice(1).some((end,i)=>!referenceSupports(board,fills,t.net,t.layer,t.points[i],end,t.width/2)));
    if(missing.length)out.push({rule:'reference-plane',severity:'warning',message:'参考铜层 / 参考网络：不满足约束',why:'几何筛查，不是耦合布线或阻抗验证；参考平面采样不能证明回流连续。',refs:[nc.name,nc.referenceNet??''],objectIds:missing.map(t=>t.id)});
  }
  return [...out,...engineeringChecks(board,rules)];
}

