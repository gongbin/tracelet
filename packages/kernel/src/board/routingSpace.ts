import type { Board, CopperLayer } from '../model/board.js';
import { copperLayers } from '../model/board.js';
import type { RuleSet } from '../model/project.js';
import { segRectDist, pointSegDist, type Vec, type Rect } from '../geometry.js';
import { allPads, netClassFor } from './geometry.js';

type Obstacle = { net: string; layers: CopperLayer[]; clearance: number } & ({ rect: Rect } | { a: Vec; b: Vec; radius: number });

/** Exact copper geometry indexed in millimetre buckets; thin pads need not become oversized grid obstacles. */
export class RoutingSpace {
  private buckets = new Map<string, Obstacle[]>();
  private readonly bucketSize = 2;
  private readonly margin: number;
  constructor(private board: Board, private rules: RuleSet) {
    this.margin = Math.max(1, ...board.netClasses.map(n => Math.max(n.traceWidth, n.viaSize) / 2 + n.clearance));
    for (const p of allPads(board)) this.add({ rect: p.rect, net: p.def.npth ? '' : p.net, layers: p.layers, clearance: this.gap(p.net) });
    for (const t of board.traces) for (let i = 1; i < t.points.length; i++) this.segment(t.points[i - 1], t.points[i], t.width / 2, [t.layer], t.net);
    for (const v of board.vias) this.segment(v, v, v.size / 2, copperLayers(board.copperCount), v.net);
  }
  reserveEscapes() {
    // Protect a short outward corridor for every fine-pitch pad before other nets surround it.
    const pads = allPads(this.board);
    for (const p of pads) {
      if (!p.net || p.through || p.def.npth || Math.min(p.rect.w,p.rect.h) > .65) continue;
      const fp = this.board.footprints.find(f=>f.id===p.footprintId)!;
      const horizontal = p.rect.w >= p.rect.h;
      const direction = Math.sign(horizontal ? p.center.x-fp.x : p.center.y-fp.y) || 1;
      const half = (horizontal ? p.rect.w : p.rect.h)/2;
      const peers = pads.filter(q=>q.footprintId===p.footprintId && !q.through && q.net && (q.rect.w >= q.rect.h)===horizontal && (Math.sign(horizontal?q.center.x-fp.x:q.center.y-fp.y)||1)===direction).sort((a,b)=>horizontal?a.center.y-b.center.y:a.center.x-b.center.x);
      const ordinal = peers.indexOf(p), offset = (ordinal-(peers.length-1)/2)*.3;
      const elbow = {x:p.center.x+(horizontal?direction*(half+.4):0),y:p.center.y+(horizontal?0:direction*(half+.4))};
      const end = { x:elbow.x+(horizontal?direction*(Math.abs(offset)+.6):offset), y:elbow.y+(horizontal?offset:direction*(Math.abs(offset)+.6)) };
      const width = Math.max(this.rules.minTraceWidth,Math.min(netClassFor(this.board,p.net)?.traceWidth??.25,Math.min(p.rect.w,p.rect.h)));
      const radius = (netClassFor(this.board,p.net)?.viaSize??.6)/2;
      let clear=true;
      for(const [a,b] of [[p.center,elbow],[elbow,end]])for(let k=0;k<=16;k++){const q={x:a.x+(b.x-a.x)*k/16,y:a.y+(b.y-a.y)*k/16};if(!this.free(q,width/2,p.layers[0],p.net,this.gap(p.net))){clear=false;break;}}
      if(clear){this.segment(p.center,elbow,width/2,p.layers,p.net);this.segment(elbow,end,width/2,p.layers,p.net);if(this.free(end,radius,p.layers[0],p.net,this.gap(p.net)))this.segment(end,end,radius,p.layers,p.net);}

    }
  }
  private gap(net: string) { return Math.max(this.rules.minClearance, netClassFor(this.board, net)?.clearance ?? 0); }
  private add(o: Obstacle) {
    const r = 'rect' in o ? o.rect : { x: Math.min(o.a.x, o.b.x) - o.radius, y: Math.min(o.a.y, o.b.y) - o.radius, w: Math.abs(o.a.x - o.b.x) + 2 * o.radius, h: Math.abs(o.a.y - o.b.y) + 2 * o.radius };
    const m = this.margin + o.clearance, s = this.bucketSize;
    for (let y = Math.floor((r.y - m) / s); y <= Math.floor((r.y + r.h + m) / s); y++) for (let x = Math.floor((r.x - m) / s); x <= Math.floor((r.x + r.w + m) / s); x++) {
      const key = `${x},${y}`; let list = this.buckets.get(key); if (!list) { list = []; this.buckets.set(key, list); } list.push(o);
    }
  }
  segment(a: Vec, b: Vec, radius: number, layers: CopperLayer[], net: string) { this.add({ a, b, radius, layers, net, clearance: this.gap(net) }); }
  free(p: Vec, radius: number, layer: CopperLayer, net: string, clearance: number): boolean {
    const list = this.buckets.get(`${Math.floor(p.x / this.bucketSize)},${Math.floor(p.y / this.bucketSize)}`) ?? [];
    for (const o of list) {
      if ((o.net && o.net === net) || !o.layers.includes(layer)) continue;
      const d = 'rect' in o ? segRectDist(p, p, o.rect) : pointSegDist(p, o.a, o.b) - o.radius;
      if (d < radius + Math.max(clearance, o.clearance) - 1e-7) return false;
    }
    return true;
  }
}
