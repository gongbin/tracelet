import { command, validateAssembly, type Project } from '@tracelet/kernel';
import { useEditor, useProject } from '../store/app.js';
import { usePrefs } from '../i18n/index.js';
export function ManufacturingSettings() {
  const p=useProject(), editor=useEditor(), zh=usePrefs(s=>s.locale).startsWith('zh');
  const settings=p.settings.manufacturing ?? {origin:{x:0,y:0},bottomRotation:'top-view' as const,includeDnp:false};
  const update=(patch:Partial<NonNullable<Project['settings']['manufacturing']>>)=>editor.dispatch(command('Manufacturing settings',p=>({...p,settings:{...p.settings,manufacturing:{...settings,...patch}}})));
  const issues=validateAssembly(p);
  return <section className="col" style={{gap:10}}><h3>{zh?'制造输出一致性':'Manufacturing consistency'}</h3>
    <div className="row" style={{flexWrap:'wrap',gap:16}}>{(['x','y'] as const).map(axis=><label key={axis}>{zh?'原点':'Origin'} {axis.toUpperCase()} / mm <input aria-label={`Origin ${axis}`} className="input" type="number" style={{width:90}} value={settings.origin[axis]} onChange={e=>{if(e.target.value!=='' && Number.isFinite(e.target.valueAsNumber)) update({origin:{...settings.origin,[axis]:e.target.valueAsNumber}});}} /></label>)}
    <label>{zh?'底面角度':'Bottom rotation'} <select className="input" value={settings.bottomRotation} onChange={e=>update({bottomRotation:e.target.value as typeof settings.bottomRotation})}><option value="top-view">{zh?'从顶面看':'Viewed from top'}</option><option value="bottom-view">{zh?'从底面看':'Viewed from bottom'}</option></select></label>
    <label><input type="checkbox" checked={settings.includeDnp} onChange={e=>update({includeDnp:e.target.checked})}/>{zh?'BOM 与坐标包含 DNP':'Include DNP in BOM and placement'}</label></div>
    <p className="muted small">{zh?'Gerber、钻孔与坐标均使用同一原点：X 向右、Y 向上；底层 XY 不镜像。底面角度须与装配厂零度约定核对。DNP 只影响装配清单，不移除板上铜与焊盘。':'Gerber, drill and placement share one origin: X right, Y up. Bottom XY is not mirrored. Confirm bottom rotation zero with the assembler. DNP affects assembly lists, not copper or pads.'}</p>
    {issues.length ? <div role="alert">{zh?'装配导出需先修复：':'Resolve before assembly export: '}{issues.map((i,k)=><div key={k}>{i.code}: {i.refs.join(', ')}</div>)}</div> : <div>{zh?'BOM / 坐标位号及身份检查通过':'BOM / placement reference and identity checks passed'}</div>}
  </section>;
}
