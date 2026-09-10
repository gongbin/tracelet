import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { footprintDef, pcb, type BoardFootprint, type Model3d, type Project } from '@tracelet/kernel';
import { useApp, useProject } from '../../store/app.js';
import { useT } from '../../i18n/index.js';
import { MODEL_CATALOG, catalogModel, modelFor, needsModel, loadModel, disposeObject } from './models.js';
import { modelCandidates, modelSearchLinks, modelSearchTerm, padSpan } from './modelSearch.js';
import { ModelPreview, modelBounds } from './ModelPreview.js';
import { importModelFile, type ImportStage } from './importModel.js';
import { ModelImportError } from './stepGeometry.js';
import './models.css';

export function ModelMatcher({ close }: { close: () => void }) {
  const project = useProject(), t = useT();
  const groups = [...new Map(project.board.footprints.filter(needsModel).map(f => [f.footprintId, f])).values()];
  const [selected, setSelected] = useState((groups.find(f => !modelFor(f,project.board)) ?? groups[0])?.footprintId ?? '');
  const f = groups.find(f => f.footprintId === selected);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current?.focus(); return () => previous?.focus(); }, []);
  return <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={t('models.title')} className="model-matcher" onKeyDown={e => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const items = Array.from(dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type=hidden]),select:not(:disabled),a[href]')).filter(el=>el.getClientRects().length);
      const first=items[0],last=items.at(-1);
      if (e.shiftKey && (document.activeElement===first || document.activeElement===dialog.current)) { e.preventDefault();last?.focus(); }
      else if (!e.shiftKey && document.activeElement===last) { e.preventDefault();first?.focus(); }
    }
  }}>
    <div className="row"><b>{t('models.title')}</b><button className="btn sm ml-auto" onClick={close}>{t('models.close')}</button></div>
    <p className="dim">{t('models.scope')}</p>
    <label className="model-field">{t('models.footprint')}<select className="input" value={selected} onChange={e => setSelected(e.target.value)}>
      {groups.map(g => <option key={g.footprintId} value={g.footprintId}>{g.footprintId.split(':').pop()} · {project.board.footprints.filter(f => f.footprintId === g.footprintId).map(f => f.ref).join(', ')} · {t(modelFor(g,project.board) ? 'models.assigned' : 'models.missing')}</option>)}
    </select></label>
    {f ? <ModelDraft key={`${project.id}:${selected}`} f={f} project={project} close={close}/> : <p>{t('models.empty')}</p>}
  </div>;
}

function ModelDraft({ f, project, close }: { f: BoardFootprint; project: Project; close: () => void }) {
  const t = useT(), app = useApp(), editor = app.editor!;
  const initial = useRef(project.board.models3d?.[f.footprintId]);
  const [draft,setDraft] = useState<Model3d | undefined>(initial.current), [query,setQuery] = useState(modelSearchTerm(f,project)), [filter,setFilter] = useState('');
  const [busy,setBusy] = useState<ImportStage | undefined>(), [error,setError] = useState(''), [model,setModel] = useState<THREE.Group>(), [retry,setRetry] = useState(0), [reviewed,setReviewed] = useState(false);
  const input = useRef<HTMLInputElement>(null), importing = useRef<AbortController | undefined>(undefined);
  const config = useMemo(() => draft ?? modelFor(f,{...project.board,models3d:{}}), [draft,f,project.board]);
  const source = config?.source, approximate = !!config && (config.provenance?.kind === 'approximate' || source?.startsWith('catalog:') && source.slice(8)!==f.footprintId.split(':').pop());
  useEffect(() => () => importing.current?.abort(), []);
  useEffect(() => {
    const abort = new AbortController(); let loaded: THREE.Group | undefined;
    setModel(undefined);setError('');
    if (source) void loadModel(source,abort.signal,retry>0).then(g => {
      if(abort.signal.aborted) disposeObject(g); else {loaded=g;setModel(g);}
    }).catch(() => {if(!abort.signal.aborted) setError(t('models.loadError'));});
    return () => {abort.abort(); if(loaded) disposeObject(loaded);};
  }, [source,retry]);
  const box = useMemo(() => model && config ? modelBounds(model,config) : undefined, [model,config]);
  const size = box?.getSize(new THREE.Vector3()), def = footprintDef(f), body = def.physicalBody ?? def.body;
  const span = padSpan(f), catalog = source?.startsWith('catalog:') ? MODEL_CATALOG[source.slice(8)] : undefined;
  const changed = JSON.stringify(initial.current) !== JSON.stringify(draft);
  const update = (next?: Model3d) => {setDraft(next);setReviewed(false);};
  const upload = async (file?: File) => {
    if (!file) return;
    importing.current?.abort();const abort=new AbortController();importing.current=abort;setError('');
    try {
      const imported=await importModelFile(file,abort.signal,setBusy);
      if(!abort.signal.aborted && useApp.getState().editor===editor) update(imported);
    } catch(e) {
      if(!abort.signal.aborted) setError(t(e instanceof ModelImportError ? `models.error.${e.code}` : 'models.error.invalid'));
    } finally {if(importing.current===abort){setBusy(undefined);if(input.current) input.current.value='';}}
  };
  const apply = () => {
    if (useApp.getState().editor!==editor || busy || config && !model || approximate && !reviewed) return;
    const saved = draft ? {...draft,provenance:{...(draft.provenance ?? {kind:'import' as const}),reviewedAt:new Date().toISOString()}} : undefined;
    editor.dispatch(pcb.setFootprintModel(f.footprintId,saved));close();
  };
  const tuple = (key:'offset'|'rotation',axis:number,n:number) => {
    if (!config || !Number.isFinite(n)) return;
    const next=[...config[key]] as [number,number,number];next[axis]=n;update({...config,[key]:next});
  };
  const dim = (values: number[]) => values.map(v=>v.toFixed(2)).join(' × ');
  return <>
    <div className="model-matcher-grid">
      <div className="model-controls">
        <label className="model-field">{t('models.search')}<input className="input" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        <div className="model-actions">{query.trim() && modelSearchLinks(query).map(link=><a className="btn sm" key={link.name} href={link.url} target="_blank" rel="noopener noreferrer">{link.name==='manufacturer'?t('models.manufacturer'):link.name} ↗</a>)}</div>
        <p className="dim xs">{t('models.searchHint')}</p>
        <label className="model-field">{t('models.catalog')}<input className="input" aria-label={t('models.filter')} placeholder={t('models.filter')} value={filter} onChange={e=>setFilter(e.target.value)}/>
          <select className="input" value={source?.startsWith('catalog:')?source.slice(8):''} disabled={!!busy} onChange={e=>{if(e.target.value) update(catalogModel(f,e.target.value));}}>
            <option value="">{t('models.choose')}</option>{[...new Set([...(catalog?[source!.slice(8)]:[]),...modelCandidates(f,filter)])].map(k=><option key={k} value={k}>{k===f.footprintId.split(':').pop()?'✓ ':''}{k}</option>)}
          </select>
        </label>
        <div className="model-actions">
          <button className="btn" disabled={!!busy} onClick={()=>input.current?.click()}>{t('models.import')}</button>
          <button className="btn sm" disabled={!!busy} onClick={()=>update(undefined)}>{t('models.auto')}</button>
          {busy && <button className="btn sm" onClick={()=>importing.current?.abort()}>{t('models.cancel')}</button>}
        </div>
        <input ref={input} type="file" accept=".glb,.step,.stp" aria-label={t('models.import')} hidden onChange={e=>void upload(e.target.files?.[0])}/>
        <p className="dim xs">{t('models.importHint')}</p>
        {busy && <p role="status">{t(`models.stage.${busy}`)}</p>}
        <p className="model-current">{t('models.current')}: <strong>{config?.name ?? t('models.missing')}</strong></p>
        {approximate && <p className="model-notice">{t('models.approximate')}</p>}
        {config && <fieldset disabled={!!busy} className="model-calibration">
          <legend>{t('models.calibration')}</legend>
          <label className="model-field">{t('models.scale')}<ModelNumber min={.001} step={1} value={config.scale} onValue={scale=>update({...config,scale})}/></label>
          {(['offset','rotation'] as const).map(key=><div key={key}><span>{t(key==='offset'?'models.offset':'models.rotation')}</span><div className="model-axes">{['X','Y','Z'].map((axis,i)=><label key={axis}>{axis}<ModelNumber label={`${t(key==='offset'?'models.offset':'models.rotation')} ${axis}`} step={key==='offset'?.1:90} value={config[key][i]} onValue={n=>tuple(key,i,n)}/></label>)}</div></div>)}
          <div className="model-actions"><button className="btn sm" onClick={()=>tuple('rotation',2,(config.rotation[2]+90)%360)}>{t('models.rotate')}</button><button className="btn sm" disabled={!box} onClick={()=>{if(box){const center=box.getCenter(new THREE.Vector3());update({...config,offset:[config.offset[0]+(body.x??0)-center.x,config.offset[1]-(body.y??0)-center.y,config.offset[2]]});}}}>{t('models.center')}</button></div>
          <label className="model-field">{t('models.source')}<input className="input" value={config.provenance?.source ?? ''} onChange={e=>update({...config,provenance:{...(config.provenance ?? {kind:'import'}),source:e.target.value}})}/></label>
          <label className="model-field">{t('models.license')}<input className="input" value={config.provenance?.license ?? ''} onChange={e=>update({...config,provenance:{...(config.provenance ?? {kind:'import'}),license:e.target.value}})}/></label>
        </fieldset>}
      </div>
      <div className="model-inspection">
        <ModelPreview footprint={f} config={config} model={model}/>
        {source && !model && !error && <p role="status">{t('models.loading')}</p>}
        <table className="model-dimensions"><tbody>
          <tr><th>{t('models.modelSize')}</th><td>{size ? dim([size.x,size.y,size.z]) : '—'} mm</td></tr>
          <tr><th>{t('models.bodySize')}</th><td>{dim([body.w,body.h])} mm</td></tr>
          <tr><th>{t('models.padSize')}</th><td>{dim(span)} mm</td></tr>
          {catalog?.padBox && <tr><th>{t('models.catalogPads')}</th><td>{dim(catalog.padBox)} mm</td></tr>}
        </tbody></table>
        <p className="dim xs">{t('models.dimensionHint')}</p>
        {config?.provenance?.sha256 && <p className="dim xs model-hash">SHA-256: {config.provenance.sha256}</p>}
        {error && <div role="alert" className="model-notice">{error}<button className="btn sm" onClick={()=>setRetry(n=>n+1)} disabled={!!busy || !source}>{t('models.retry')}</button></div>}
      </div>
    </div>
    <div className="model-footer">
      {approximate && <label className="model-review"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>{t('models.review')}</label>}
      <div className="model-actions"><a href={`${import.meta.env.BASE_URL}models3d/kicad/ATTRIBUTION.md`} target="_blank" rel="noreferrer">{t('models.attribution')}</a><a href={`${import.meta.env.BASE_URL}licenses/step-import.txt`} target="_blank" rel="noreferrer">STEP / WASM</a><button className="btn ml-auto" onClick={close}>{t('models.cancel')}</button><button className="btn primary" disabled={!changed || !!busy || !!config && !model || approximate && !reviewed} onClick={apply}>{t('models.apply')}</button></div>
    </div>
  </>;
}

/** Retain intermediate input (empty, minus sign, decimal) while typing; never save it as zero. */
function ModelNumber({ value, onValue, label, min, step }: { value: number; onValue: (n:number)=>void; label?:string; min?:number; step:number }) {
  const [text,setText]=useState(String(value));
  useEffect(()=>setText(String(value)),[value]);
  return <input className="input" type="number" aria-label={label} min={min} step={step} value={text} onChange={e=>{
    const raw=e.target.value;setText(raw);const n=Number(raw);
    if(raw.trim() && Number.isFinite(n) && (min===undefined || n>=min)) onValue(n);
  }} onBlur={()=>setText(String(value))}/>;
}
