import { pcb, DEFAULT_STACKUP, type Stackup } from '@tracelet/kernel';
import { use3d, MASK_COLORS } from '../editors/three/ThreeView.js';
import { useApp, useEditor, useProject } from '../store/app.js';
import { useT } from '../i18n/index.js';

const FINISH: [Stackup['finish'], string][] = [['HASL', 'HASL'], ['LeadFreeHASL', '无铅 HASL'], ['ENIG', 'ENIG'], ['OSP', 'OSP']];

export function View3dPanel() {
  const t = useT();
  const s = use3d();
  const app = useApp();
  const project = useProject();
  const editor = useEditor();
  const st: Stackup = { ...DEFAULT_STACKUP, ...(project.board.stackup ?? {}) };
  const set = (patch: Partial<Stackup>) => editor.dispatch(pcb.setBoardProps({ stackup: patch }));
  const toggles = [['components', '元件 3D'], ['labels', t('three.labels')], ['silk', '丝印'], ['mask', '阻焊'], ['traces', t('three.traces')], ['zones', t('three.zones')], ['copper', '铜层透视'], ['autoRotate', '自动旋转']] as const;
  return (
    <div className="panel-pad">
      <label className="kicker" htmlFor="three-mode">{t('three.mode')}</label>
      <select id="three-mode" className="input" style={{ width: '100%', marginBottom: 8 }} value={s.mode} onChange={e => s.set({ mode: e.target.value as typeof s.mode })}>
        <option value="inspect">{t('three.inspect')}</option><option value="realistic">{t('three.realistic')}</option>
      </select>
      <p className="muted xs" style={{ lineHeight: 1.6, margin: '0 0 14px' }}>{t(s.mode === 'inspect' ? 'three.inspectHint' : 'three.realisticHint')}</p>
      <div className="kicker">显示</div>
      <div className="col" style={{ gap: 8 }}>
        {toggles.map(([k, label]) => <label key={k} className="row" style={{ gap: 10, cursor: 'pointer' }}><input type="checkbox" checked={s[k]} onChange={e => s.set({ [k]: e.target.checked })} />{label}</label>)}
      </div>
      {s.mode === 'inspect' && <div className="col" style={{ gap: 10, marginTop: 16 }}>
        {(['traceColor', 'zoneColor'] as const).map((key, i) => <label key={key} className="row" style={{ justifyContent: 'space-between' }}>{t(i ? 'three.zoneColor' : 'three.traceColor')}<input aria-label={t(i ? 'three.zoneColor' : 'three.traceColor')} type="color" value={s[key]} onInput={e => s.set({ [key]: e.currentTarget.value })} onChange={e => s.set({ [key]: e.target.value })} style={{ width: 38, height: 26, padding: 2, cursor: 'pointer', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 4 }} /></label>)}
      </div>}
      <div className="divider" />
      <div className="kicker">工艺外观 · 随项目保存</div>
      <div className="kv">
        <label className="k" htmlFor="three-mask">阻焊颜色</label>
        <select id="three-mask" className="input" value={st.maskColor} onChange={(e) => set({ maskColor: e.target.value as Stackup['maskColor'] })}>{Object.keys(MASK_COLORS).map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <label className="k" htmlFor="three-silk">丝印颜色</label>
        <select id="three-silk" className="input" value={st.silkColor} onChange={(e) => set({ silkColor: e.target.value as Stackup['silkColor'] })}>{['白', '黑', '黄'].map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <label className="k" htmlFor="three-finish">表面处理</label>
        <select id="three-finish" className="input" value={st.finish} onChange={(e) => set({ finish: e.target.value as Stackup['finish'] })}>{FINISH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </div>
      <div className="divider" />
      <div className="col" style={{ gap: 8 }}>
        <button className="btn" style={{ height: 30, justifyContent: 'center' }} disabled={!s.capture} onClick={() => s.capture?.()}>📷 截图 PNG</button>
        <button className="btn" style={{ height: 30, justifyContent: 'center' }} disabled={!s.exportGlb} onClick={() => void s.exportGlb?.()}>⇩ 导出 3D（GLB）</button>
        <div className="dim xs">{t('models.exportHint')}</div>
        <button className="btn ghost" style={{ height: 28, justifyContent: 'center' }} onClick={() => app.go('fab')}>制造与下单参数 →</button>
      </div>
    </div>
  );
}
