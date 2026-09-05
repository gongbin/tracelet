import { useState } from 'react';
import { createProject, createDemoProject, RULE_SETS } from '@tracelet/kernel';
import { useApp } from '../store/app.js';

const FABS = [
  { id: 'jlc', name: '嘉立创', rule: '线宽/间距 0.127 · 孔 0.3' },
  { id: 'jlcpcb', name: 'JLCPCB', rule: '0.127 · 0.3' },
  { id: 'generic', name: '通用（保守）', rule: '0.2 · 0.4' }
];
const TEMPLATES = [['blank', '空白'], ['esp32', 'ESP32'], ['stm32', 'STM32'], ['arduino', 'Arduino 扩展板']] as const;

export function Wizard() {
  const { set, openProjectObject, toast } = useApp();
  const [name, setName] = useState('LED 闪灯板');
  const [layers, setLayers] = useState<2 | 4>(2);
  const [fab, setFab] = useState('jlc');
  const [unit, setUnit] = useState<'mm' | 'mil'>('mm');
  const [tpl, setTpl] = useState<string>('blank');
  const close = () => set('wizardOpen', false);

  const create = () => {
    const fabName = RULE_SETS.find((r) => r.id === fab)?.name ?? '嘉立创';
    let p;
    if (tpl === 'esp32') { p = createDemoProject(); p = { ...p, name: name || 'ESP32 项目', settings: { ...p.settings, unit, ruleSetId: fab, fab: fabName } }; }
    else {
      if (tpl !== 'blank') toast(`${tpl.toUpperCase()} 模板即将提供，已创建空白项目`);
      p = createProject({ name: name || '未命名项目', copperCount: layers, unit, ruleSetId: fab, fab: fabName });
    }
    openProjectObject(p);
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <div><div style={{ fontWeight: 600, fontSize: 15 }}>新建项目</div><div className="small muted" style={{ marginTop: 2 }}>三步设置，之后都能在"项目设置"里改</div></div>
          <span className="ml-auto muted" style={{ cursor: 'pointer', fontSize: 16 }} onClick={close}>✕</span>
        </div>
        <div className="dialog-body kv" style={{ gap: '14px 12px' }}>
          <span className="k">项目名</span><input className="input lg input-focus-ring" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
          <span className="k">层数</span>
          <div className="seg"><span className={`seg-opt${layers === 2 ? ' on' : ''}`} onClick={() => setLayers(2)}>2 层 · 大多数创客项目</span><span className={`seg-opt${layers === 4 ? ' on' : ''}`} onClick={() => setLayers(4)}>4 层</span></div>
          <span className="k">板厂规则</span>
          <div className="col" style={{ gap: 6 }}>
            {FABS.map((f) => (
              <label key={f.id} className="row" style={{ gap: 10, padding: '8px 10px', borderRadius: 4, cursor: 'pointer', background: fab === f.id ? 'var(--bg-raised)' : 'transparent', border: `1px solid ${fab === f.id ? 'var(--accent)' : 'var(--border)'}` }} onClick={() => setFab(f.id)}>
                <span style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${fab === f.id ? 'var(--accent)' : 'var(--text-3)'}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: fab === f.id ? 'var(--accent)' : 'var(--text-3)' }} /></span>
                <span>{f.name}</span><span className="ml-auto muted mono xs">{f.rule}</span>
              </label>
            ))}
          </div>
          <span className="k">单位</span>
          <div className="seg" style={{ width: 160 }}><span className={`seg-opt${unit === 'mm' ? ' on' : ''}`} onClick={() => setUnit('mm')}>mm</span><span className={`seg-opt${unit === 'mil' ? ' on' : ''}`} onClick={() => setUnit('mil')}>mil</span></div>
          <span className="k">模板</span>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {TEMPLATES.map(([id, label]) => <span key={id} className={`chip${tpl === id ? ' on' : ''}`} style={{ padding: '5px 10px' }} onClick={() => setTpl(id)}>{label}</span>)}
          </div>
        </div>
        <div className="dialog-foot">
          <span className="xs dim">不确定？默认值适合第一块板。</span>
          <button className="btn lg ghost ml-auto" onClick={create}>跳过向导</button>
          <button className="btn lg primary" onClick={create}>创建并打开原理图 →</button>
        </div>
      </div>
    </div>
  );
}
