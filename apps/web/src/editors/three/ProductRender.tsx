import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { disposeObject } from './models.js';
import { studioLighting } from './studio.js';
import { usePrefs } from '../../i18n/index.js';
export function ProductRender({build,name,missing,onClose}:{build:()=>THREE.Group;name:string;missing:number;onClose:()=>void}){
  const zh=usePrefs(s=>s.locale).startsWith('zh'),host=useRef<HTMLDivElement>(null);
  const [side,setSide]=useState('iso'),[background,setBackground]=useState('white'),[size,setSize]=useState(1600),[error,setError]=useState('');
  const renderer=useRef<THREE.WebGLRenderer|null>(null);
  useEffect(()=>{
    let r:THREE.WebGLRenderer|undefined,g:THREE.Group|undefined,disposeStudio:(()=>void)|undefined;const el=host.current!;
    try{
      r=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.current=r;r.setPixelRatio(1);r.setSize(size,Math.round(size*0.75));r.domElement.style.width='100%';r.domElement.style.height='auto';el.appendChild(r.domElement);
      r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;r.toneMapping=THREE.ACESFilmicToneMapping;
      const scene=new THREE.Scene();scene.background=background==='transparent'?null:new THREE.Color(background==='white'?'#f5f5f3':'#161b23');
      g=build();g.traverse(o=>{if(o instanceof THREE.Mesh){o.castShadow=true;o.receiveShadow=true;}});scene.add(g);
      const box=new THREE.Box3().setFromObject(g),center=box.getCenter(new THREE.Vector3()),radius=Math.max(1,box.getSize(new THREE.Vector3()).length()/2);
      const camera=new THREE.OrthographicCamera(-radius*1.4,radius*1.4,radius*1.05,-radius*1.05,0.1,radius*15);
      const direction=side==='top'?new THREE.Vector3(0,0,1):side==='bottom'?new THREE.Vector3(0,0,-1):new THREE.Vector3(0.6,-0.8,1).normalize();
      camera.position.copy(center).addScaledVector(direction,radius*5);camera.up.set(0,1,0);camera.lookAt(center);
      disposeStudio=studioLighting(r,scene,{center,radius});
      r.render(scene,camera);setError('');
    }catch(e){setError(String(e));}
    return ()=>{renderer.current=null;disposeStudio?.();if(g)disposeObject(g);if(r){r.dispose();r.domElement.remove();}};
  },[build,side,background,size]);
  const save=()=>renderer.current?.domElement.toBlob(blob=>{if(!blob)return;const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${name.replace(/[^\w\u4e00-\u9fff-]+/g,'-')}-product-${side}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},'image/png');
  return <div className="overlay" onClick={onClose}><div className="dialog" style={{width:900,maxHeight:'94vh',overflow:'auto'}} onClick={e=>e.stopPropagation()}><div className="dialog-head"><strong>{zh?'产品渲染':'Product render'}</strong><button className="btn ml-auto" onClick={onClose}>✕</button></div><div style={{padding:16}}>
  <div className="row"><select className="input" value={side} onChange={e=>setSide(e.target.value)}><option value="iso">{zh?'等轴':'Isometric'}</option><option value="top">{zh?'顶面':'Top'}</option><option value="bottom">{zh?'底面':'Bottom'}</option></select><select className="input" value={background} onChange={e=>setBackground(e.target.value)}><option value="white">{zh?'浅色背景':'Light'}</option><option value="dark">{zh?'深色背景':'Dark'}</option><option value="transparent">{zh?'透明背景':'Transparent'}</option></select><select className="input" value={size} onChange={e=>setSize(Number(e.target.value))}>{[1200,1600,2400].map(s=><option key={s} value={s}>{s} × {s*0.75}</option>)}</select></div>
  <p className="small muted">{zh?`独立展示视角，不修改 PCB。${missing} 个元件仍使用占位模型。`:`Independent presentation camera; PCB is unchanged. ${missing} parts still use placeholders.`}</p><div ref={host}/>{error && <p role="alert">{error}</p>}<button className="btn primary" disabled={!!error} onClick={save}>{zh?'保存产品 PNG':'Save product PNG'}</button></div></div></div>;
}
