import { AdvancedStackup } from './AdvancedStackup.js';
import { LayerCountSelect } from '../components/LayerCountSelect.js';
import { pcb, DEFAULT_STACKUP, copperLayers, LAYER_COLORS, type Stackup } from '@tracelet/kernel';
import { useApp, useEditor, useProject } from '../store/app.js';

const FINISH: [Stackup['finish'], string][] = [['HASL', '有铅喷锡 HASL'], ['LeadFreeHASL', '无铅喷锡'], ['ENIG', '沉金 ENIG'], ['OSP', 'OSP']];
const MASK: Stackup['maskColor'][] = ['绿', '黑', '白', '蓝', '红', '黄', '紫'];
const MASK_HEX: Record<string, string> = { 绿: '#1E6B3A', 黑: '#2B2B2B', 白: '#E8E8E4', 蓝: '#1F4E8C', 红: '#8C1F1F', 黄: '#B59A1E', 紫: '#5B2D8C' };

/** 层叠 / 工艺：层数、板厚、铜厚、表面处理、阻焊与丝印颜色。参数写入项目，3D 视图与制造 README 同步。 */
export function StackupDialog({ close }: { close: () => void }) {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const b = project.board;
  const st: Stackup = { ...DEFAULT_STACKUP, ...(b.stackup ?? {}) };
  const set = (patch: Partial<Stackup>) => editor.dispatch(pcb.setBoardProps({ stackup: patch }));
  const cu = copperLayers(b.copperCount);
  const cuUm = (oz: number) => Math.round(oz * 35);
  // 简化的物理叠层：外层铜 / 半固化片 / 内层铜 / 芯板
  const totalCopper = (2 * cuUm(st.copperWeight) + (b.copperCount - 2) * cuUm(st.innerCopperWeight)) / 1000;
  const weights = b.copperCount === 6 ? [0.1, 0.25, 0.3, 0.25, 0.1] : b.copperCount === 4 ? [0.2, 0.6, 0.2] : [1];
  const dielectric = weights.map(w => Math.max(0, b.thickness - totalCopper) * w);
  const rows: { name: string; kind: 'cu' | 'core' | 'pp'; t: string; color?: string }[] = [];
  cu.forEach((l, i) => {
    const inner = l.startsWith('In');
    rows.push({ name: l, kind: 'cu', t: `${cuUm(inner ? st.innerCopperWeight : st.copperWeight)} µm (${inner ? st.innerCopperWeight : st.copperWeight} oz)`, color: LAYER_COLORS[l] });
    if (i < cu.length - 1) rows.push({ name: b.copperCount > 2 && i % 2 === 1 ? '芯板 FR-4' : b.copperCount > 2 ? '半固化片' : '芯板 FR-4', kind: b.copperCount > 2 && i % 2 === 0 ? 'pp' : 'core', t: `${dielectric[i].toFixed(2)} mm` });
  });
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog" style={{ width: 720, maxHeight: '90vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="dialog-head"><div><div style={{ fontWeight: 600, fontSize: 15 }}>层叠与工艺</div><div className="small muted" style={{ marginTop: 2 }}>写入项目：3D 外观、制造 README 与下单参数保持一致</div></div><span className="ml-auto muted" style={{ cursor: 'pointer', fontSize: 16 }} onClick={close}>✕</span></div>
        <div className="dialog-body row" style={{ gap: 20, alignItems: 'flex-start' }}>
          <div className="kv grow" style={{ gap: '10px 12px' }}>
            <span className="k">层数</span><LayerCountSelect />
            <span className="k">板厚</span><div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>{[0.6, 0.8, 1.0, 1.2, 1.6, 2.0].map((t) => <span key={t} className={`chip mono${b.thickness === t ? ' on' : ''}`} onClick={() => editor.dispatch(pcb.setBoardProps({ thickness: t }))}>{t}</span>)}<span className="dim xs">mm</span></div>
            <span className="k">外层铜厚</span><div className="row" style={{ gap: 4 }}>{[0.5, 1, 2].map((oz) => <span key={oz} className={`chip mono${st.copperWeight === oz ? ' on' : ''}`} onClick={() => set({ copperWeight: oz })}>{oz} oz</span>)}</div>
            {b.copperCount > 2 && <><span className="k">内层铜厚</span><div className="row" style={{ gap: 4 }}>{[0.5, 1].map((oz) => <span key={oz} className={`chip mono${st.innerCopperWeight === oz ? ' on' : ''}`} onClick={() => set({ innerCopperWeight: oz })}>{oz} oz</span>)}</div></>}
            <span className="k">表面处理</span><select className="input" value={st.finish} onChange={(e) => set({ finish: e.target.value as Stackup['finish'] })}>{FINISH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <span className="k">阻焊颜色</span><div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{MASK.map((c) => <span key={c} className={`chip${st.maskColor === c ? ' on' : ''}`} style={{ gap: 6 }} onClick={() => set({ maskColor: c })}><span style={{ width: 10, height: 10, borderRadius: 2, background: MASK_HEX[c], display: 'inline-block', border: '1px solid rgba(255,255,255,.2)' }} />{c}</span>)}</div>
            <span className="k">丝印颜色</span><div className="row" style={{ gap: 6 }}>{(['白', '黑', '黄'] as const).map((c) => <span key={c} className={`chip${st.silkColor === c ? ' on' : ''}`} onClick={() => set({ silkColor: c })}>{c}</span>)}</div>
            <span className="k">材料</span><div className="row" style={{ gap: 4 }}>{['FR-4', 'FR-4 高 Tg', '铝基板', 'Rogers'].map((m) => <span key={m} className={`chip${st.material === m ? ' on' : ''}`} onClick={() => set({ material: m })}>{m}</span>)}</div>
            <span className="k">其他</span><div className="col" style={{ gap: 6 }}><label className="row" style={{ gap: 8, cursor: 'pointer' }} onClick={() => set({ impedance: !st.impedance })}><span className={`check${st.impedance ? ' on' : ''}`}>{st.impedance ? '✓' : ''}</span>阻抗控制（写入 README，下单时勾选）</label><label className="row" style={{ gap: 8, cursor: 'pointer' }} onClick={() => set({ viaTenting: !st.viaTenting })}><span className={`check${st.viaTenting ? ' on' : ''}`}>{st.viaTenting ? '✓' : ''}</span>过孔盖油</label></div>
          </div>
          <div className="col" style={{ width: 200, flex: 'none', gap: 2 }}>
            <div className="kicker">叠层（自上而下）</div>
            {rows.map((r, i) => <div key={i} className="row mono xs" style={{ gap: 8, padding: '4px 8px', borderRadius: 3, background: r.kind === 'cu' ? 'var(--bg-raised)' : r.kind === 'core' ? 'rgba(200,180,120,.12)' : 'rgba(200,180,120,.06)', border: r.kind === 'cu' ? `1px solid ${r.color}` : '1px dashed var(--border)' }}><span style={{ color: r.color ?? 'var(--text-2)' }}>{r.name}</span><span className="ml-auto muted">{r.t}</span></div>)}
            <div className="dim xs" style={{ marginTop: 6 }}>总厚 {b.thickness} mm · 介质厚度为示意值，以板厂叠层为准</div>
          </div>
        </div>
        <div style={{padding:20}}><AdvancedStackup /></div>
        <div className="dialog-foot"><span className="xs dim">全部可 Undo。</span><button className="btn lg primary ml-auto" onClick={close}>完成</button></div>
      </div>
    </div>
  );
}
