import { useId } from 'react';
import { LAYER_COLORS, type CopperLayer, type Vec } from '@tracelet/kernel';

/** Display colors only; copper dimensions and exported layer data remain physical. */
export const PCB_DISPLAY = {
  error: '#FF69D4', warning: '#FFD166', selected: '#FFE28A',
  plated: '#D8B86A', clearance: '#73DCC4', backdrop: '#171B24',
};
export function padColor(layer: CopperLayer): string {
  const rgb=LAYER_COLORS[layer].slice(1).match(/../g)!;
  return '#'+rgb.map(c=>Math.round(parseInt(c,16)*.65+255*.35).toString(16).padStart(2,'0')).join('');
}
/** Do not round 0.127 mm to 0.13 mm in a width readout. */
export const pcbWidthText=(width:number)=>String(width);
const pathOf=(points:readonly Vec[])=>points.map((p,i)=>`${i?'L':'M'}${p.x} ${p.y}`).join(' ');

/** Only the outer boundary is painted; the keep-clear region is never a thick trace. */
export function ClearanceOutline({points,width,clearance,scale,blocked}:{points:readonly Vec[];width:number;clearance:number;scale:number;blocked:boolean}) {
  const id=useId(),outer=width+2*clearance,border=Math.min(1/scale,clearance/2),d=pathOf(points);
  if(points.length<2||clearance<=0)return null;
  const margin=outer/2+border,x=Math.min(...points.map(p=>p.x))-margin,y=Math.min(...points.map(p=>p.y))-margin;
  const w=Math.max(...points.map(p=>p.x))-x+margin,h=Math.max(...points.map(p=>p.y))-y+margin;
  return <g data-route-clearance pointerEvents="none">
    <defs><mask id={id} maskUnits="userSpaceOnUse" x={x} y={y} width={w} height={h} style={{maskType:'luminance'}}>
      <path d={d} fill="none" stroke="white" strokeWidth={outer} strokeLinecap="round" strokeLinejoin="round"/>
      <path d={d} fill="none" stroke="black" strokeWidth={outer-2*border} strokeLinecap="round" strokeLinejoin="round"/>
    </mask></defs>
    <path d={d} fill="none" stroke={blocked?PCB_DISPLAY.error:PCB_DISPLAY.clearance} strokeWidth={outer} strokeLinecap="round" strokeLinejoin="round" mask={`url(#${id})`} opacity={.8}/>
  </g>;
}

/** Fixed screen-size symbols distinguish diagnostics by shape as well as color. */
export function PcbCheckMarker({point,scale,severity,active=false}:{point:Vec;scale:number;severity:string;active?:boolean}) {
  const error=severity==='error',color=error?PCB_DISPLAY.error:PCB_DISPLAY.warning;
  return <g data-pcb-check={severity} transform={`translate(${point.x} ${point.y}) scale(${1/scale})`} pointerEvents="none">
    <path d="M0 0L9 -9" stroke={color} strokeWidth={1}/>
    <circle r={2} fill={color}/>
    <g transform="translate(15 -15)">
      {active&&<circle r={13} fill="none" stroke={color} strokeWidth={1.5} strokeDasharray="3 2"/>}
      <path d={error?'M0 -10L10 0L0 10L-10 0Z':'M0 -11L10 8L-10 8Z'} fill={PCB_DISPLAY.backdrop} stroke={color} strokeWidth={2}/>
      <text y={error?4:5} textAnchor="middle" fontFamily="system-ui,sans-serif" fontWeight="800" fontSize={13} fill={color}>!</text>
    </g>
  </g>;
}
