import {useEffect,useState,type RefObject} from 'react';
import type {VP} from '../../hooks/useViewport.js';
import type {Vec} from '@tracelet/kernel';
import {rulerTicks} from './alignment.js';
export function PcbRulers({vp,svgRef,cursor}:{vp:VP;svgRef:RefObject<SVGSVGElement|null>;cursor:Vec}){
 const [size,setSize]=useState({w:0,h:0});
 useEffect(()=>{const el=svgRef.current;if(!el)return;const measure=()=>{const r=el.getBoundingClientRect();setSize({w:r.width,h:r.height});};measure();if(typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(measure);observer.observe(el);return()=>observer.disconnect();},[svgRef]);
 const x=cursor.x*vp.k+vp.x,y=cursor.y*vp.k+vp.y;
 return <g aria-label="PCB rulers (mm)" pointerEvents="none" fontSize={9} fill="#ADB6C5">
  <rect width={size.w} height={22} fill="#202630"/><rect width={22} height={size.h} fill="#202630"/>
  {rulerTicks(vp.x,vp.k,size.w).map(t=><g key={`x${t.value}`}><line x1={t.pixel} x2={t.pixel} y1={t.major?12:17} y2={22} stroke="#788496"/>{t.major&&<text x={t.pixel+3} y={10}>{t.value}</text>}</g>)}
  {rulerTicks(vp.y,vp.k,size.h).map(t=><g key={`y${t.value}`}><line y1={t.pixel} y2={t.pixel} x1={t.major?12:17} x2={22} stroke="#788496"/>{t.major&&<text transform={`translate(10 ${t.pixel+3}) rotate(-90)`} textAnchor="end">{t.value}</text>}</g>)}
  {x>22&&x<size.w&&<path d={`M${x-3} 14 L${x+3} 14 L${x} 21Z`} fill="#F0A040"/>}
  {y>22&&y<size.h&&<path d={`M14 ${y-3} L14 ${y+3} L21 ${y}Z`} fill="#F0A040"/>}
  <rect width={22} height={22} fill="#202630"/><text x={3} y={14}>mm</text>
 </g>;
}
