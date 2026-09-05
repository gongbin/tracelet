import { useState } from 'react';
import { create } from 'zustand';
import { sch, findPin, searchParts, BUILTIN_PARTS, type ReviewSuggestion, type ProjectEditor } from '@tracelet/kernel';
import { useApp, useEditor, useProject, useSheet } from '../store/app.js';
import { getAnalysis } from '../store/analysis.js';
import { locateItem } from './CheckPanel.js';

interface Msg { role: 'user' | 'assistant'; text: string; steps?: string[]; suggestions?: ReviewSuggestion[] }
interface AiState { msgs: Msg[]; push: (m: Msg) => void; clear: () => void }
const useAi = create<AiState>((set) => ({ msgs: [], push: (m) => set((s) => ({ msgs: [...s.msgs, m] })), clear: () => set({ msgs: [] }) }));

interface AiConfig { baseUrl: string; apiKey: string; model: string }
const CFG_KEY = 'tracelet:ai-config';
const loadCfg = (): AiConfig => { try { return JSON.parse(localStorage.getItem(CFG_KEY) ?? '') as AiConfig; } catch { return { baseUrl: 'https://api.anthropic.com', apiKey: '', model: 'claude-sonnet-5' }; } };

/** 执行审查建议：去耦电容 / 上拉电阻，都是内核命令，可 Undo。 */
export function applySuggestion(editor: ProjectEditor, s: ReviewSuggestion): boolean {
  const act = s.action; if (!act) return false;
  const sheetId = editor.project.schematic.sheets.find((sh) => sh.components.some((c) => c.id === act.componentId))?.id ?? editor.project.schematic.sheets[0].id;
  const comp = () => editor.project.schematic.sheets.find((sh) => sh.id === sheetId)!.components;
  const c = comp().find((x) => x.id === act.componentId); if (!c) return false;
  const g = findPin(c, act.pinNumber); if (!g) return false;
  const dir = g.horizontal ? Math.sign(g.end.x - g.base.x) || 1 : 1;
  if (act.kind === 'add-decoupling') {
    editor.begin(`添加去耦电容 (${c.ref})`);
    const cap = sch.placeComponent(editor.project, { sheetId, symbolId: 'sym:C', center: { x: g.end.x + dir * 700, y: g.end.y + 400 }, value: '100nF', footprint: 'fp:C_0402' });
    editor.dispatch(cap.command);
    editor.dispatch(sch.connectPins(sheetId, { componentId: c.id, pin: act.pinNumber }, { componentId: cap.id, pin: '1' }));
    const capC = comp().find((x) => x.id === cap.id)!; const g2 = findPin(capC, '2')!;
    const gnd = sch.placeComponent(editor.project, { sheetId, symbolId: 'sym:GND', center: { x: g2.end.x, y: g2.end.y + 300 }, value: 'GND' });
    editor.dispatch(gnd.command);
    editor.dispatch(sch.connectPins(sheetId, { componentId: cap.id, pin: '2' }, { componentId: gnd.id, pin: '1' }));
    editor.commit();
    return true;
  }
  if (act.kind === 'add-pullup') {
    editor.begin(`添加上拉电阻 (${c.ref})`);
    const r = sch.placeComponent(editor.project, { sheetId, symbolId: 'sym:R', center: { x: g.end.x + dir * 700, y: g.end.y - 500 }, value: '10kΩ', footprint: 'fp:R_0402' });
    editor.dispatch(r.command);
    editor.dispatch(sch.connectPins(sheetId, { componentId: c.id, pin: act.pinNumber }, { componentId: r.id, pin: '2' }));
    const rC = comp().find((x) => x.id === r.id)!; const g1 = findPin(rC, '1')!;
    const pwr = sch.placeComponent(editor.project, { sheetId, symbolId: 'sym:PWR', center: { x: g1.end.x, y: g1.end.y - 300 }, value: '+3V3' });
    editor.dispatch(pwr.command);
    editor.dispatch(sch.connectPins(sheetId, { componentId: r.id, pin: '1' }, { componentId: pwr.id, pin: '1' }));
    editor.commit();
    return true;
  }
  return false;
}

export function AiPanel() {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const a = getAnalysis(project);
  const { msgs, push, clear } = useAi();
  const [input, setInput] = useState('');
  const [cfg, setCfg] = useState<AiConfig>(loadCfg);
  const [showCfg, setShowCfg] = useState(false);
  const sheet = useSheet();
  const selRef = app.screen === 'pcb' ? project.board.footprints.filter((f) => app.pcbSelection.includes(f.id)).map((f) => f.ref).join(', ') : sheet.components.filter((c) => app.selection.includes(c.id)).map((c) => c.ref).join(', ');
  const configured = !!cfg.apiKey;

  const run = (raw: string) => {
    const text = raw.trim(); if (!text) return;
    push({ role: 'user', text });
    setInput('');
    const [cmd, ...rest] = text.split(/\s+/);
    const arg = rest.join(' ');
    if (cmd === '/审查' || /检查|审查|review/i.test(text) && !configured) {
      const steps = [`读取网表 · ${a.netlist.nets.length} 个网络`, `运行 ERC · ${a.erc.errors} 错误 ${a.erc.warnings} 警告`, `经验规则审查 · ${a.review.length} 条建议`];
      push({ role: 'assistant', text: a.review.length ? `我检查了原理图，发现 ${a.review.length} 个可以改进的地方：` : '原理图没有发现常见问题（去耦、上拉、限流）。', steps, suggestions: a.review });
      return;
    }
    if (cmd === '/解释选中') {
      if (!selRef) { push({ role: 'assistant', text: '先在画布里选中一个元件，我来解释它的作用与连接。' }); return; }
      const c = sheet.components.find((x) => app.selection.includes(x.id));
      if (c) {
        const nets = a.netlist.nets.filter((n) => n.pins.some((p) => p.componentId === c.id));
        push({ role: 'assistant', text: `${c.ref}（${c.value}）连接到 ${nets.length} 个网络：${nets.map((n) => `${n.name}（${n.pins.length} 引脚）`).join('、') || '尚未连线'}。`, steps: ['读取选中对象', '查询网表'] });
      } else push({ role: 'assistant', text: `${selRef} 在 PCB 上；切换到原理图选中它可以看电气连接。` });
      return;
    }
    if (cmd === '/找元件') {
      const r = searchParts(arg, BUILTIN_PARTS).slice(0, 3);
      push({ role: 'assistant', text: r.length ? `找到 ${r.length} 个候选：${r.map((p) => `${p.mpn}（${p.maker}，${p.price}）`).join('；')}。在「元件库」里搜「${arg}」即可放置。` : `内置库里没有「${arg}」。接入 LCSC 全量库后可以直接搜到。`, steps: [`搜索元件库 "${arg}"`] });
      return;
    }
    if (cmd === '/修复DRC' || cmd === '/修复ERC') {
      const rep = cmd === '/修复DRC' ? a.drc : a.erc;
      if (rep.items.length === 0) { push({ role: 'assistant', text: '当前没有需要修复的问题。' }); return; }
      const first = rep.items[0];
      push({ role: 'assistant', text: `共 ${rep.errors} 个错误、${rep.warnings} 个警告。第一条：${first.message}（${first.refs.join(' · ')}）。${first.why} 我已定位到问题位置，自动修复（移动/改线）会在模型接入后提供。`, steps: [`运行 ${cmd === '/修复DRC' ? 'DRC' : 'ERC'}`] });
      locateItem(first, cmd === '/修复DRC' ? 'pcb' : 'sch');
      return;
    }
    if (!configured) {
      push({ role: 'assistant', text: '还没有配置模型。现在可以用 / 命令做确定性检查（审查、解释、找元件、修复 DRC）；配置 API Key 后，我能读取你的图纸回答自由问题并给出可应用的修改。', steps: [] });
      setShowCfg(true);
      return;
    }
    push({ role: 'assistant', text: '模型调用（工具使用 + 结构化摘要）在下一里程碑接入；当前已配置的端点会在那时生效。', steps: [] });
  };

  const apply = (s: ReviewSuggestion) => {
    if (applySuggestion(editor, s)) { app.toast(`已应用：${s.title}（可 Undo）`, 'success'); if (app.screen !== 'sch') app.go('sch'); }
    else app.toast('这条建议暂无自动操作');
  };
  const appliable = (m: Msg) => (m.suggestions ?? []).filter((s) => s.action);

  return (
    <div className="col" style={{ height: '100%', gap: 0, fontSize: 12 }}>
      <div className="col" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', gap: 4 }}>
        <div className="row" style={{ gap: 6 }}><span style={{ color: 'var(--ai)' }}>✨</span><span style={{ fontWeight: 500, fontSize: 13 }}>助手</span>
          <span className="ml-auto field muted" style={{ height: 24, cursor: 'pointer' }} onClick={() => setShowCfg(!showCfg)}>{configured ? cfg.model : '未配置模型'} ▾</span>
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>正在看：<span style={{ color: 'var(--text)' }}>{app.screen === 'pcb' ? 'PCB' : '原理图'}</span> · 选中 <span className="mono" style={{ color: 'var(--text)' }}>{selRef || '无'}</span></div>
        {showCfg && (
          <div className="col" style={{ gap: 6, marginTop: 6 }}>
            <input className="input mono" placeholder="API Base URL" value={cfg.baseUrl} onChange={(e) => setCfg({ ...cfg, baseUrl: e.target.value })} />
            <input className="input mono" placeholder="API Key（只存在本机浏览器）" type="password" value={cfg.apiKey} onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })} />
            <input className="input mono" placeholder="模型" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} />
            <div className="row"><button className="btn sm primary" onClick={() => { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); setShowCfg(false); app.toast('已保存 AI 配置', 'success'); }}>保存</button><span className="dim xs">开源版允许接任何兼容端点</span></div>
          </div>
        )}
      </div>
      <div className="grow col" style={{ overflow: 'auto', padding: 12, gap: 12 }}>
        {msgs.length === 0 && (
          <div className="col" style={{ gap: 10 }}>
            <div className="muted">我能看到当前图纸与选中对象。试试：</div>
            <div className="ai-suggest" style={{ cursor: 'pointer' }} onClick={() => run('/审查')}>帮我检查电源部分有没有问题</div>
            <div className="ai-suggest" style={{ cursor: 'pointer' }} onClick={() => run('/找元件 3.3V LDO')}>找一个 3.3V 的 LDO</div>
            {a.review.length > 0 && <div className="row muted xs"><span style={{ color: 'var(--warning)' }}>⚠</span>审查发现 {a.review.length} 条建议，输入 /审查 查看</div>}
          </div>
        )}
        {msgs.map((m, i) => m.role === 'user' ? <div key={i} className="ai-msg-user">{m.text}</div> : (
          <div key={i} className="col" style={{ gap: 8 }}>
            {m.steps?.map((s, j) => <div key={j} className="row muted xs" style={{ gap: 6 }}><span style={{ color: 'var(--success)' }}>✓</span>{s}</div>)}
            <div>{m.text}</div>
            {m.suggestions?.map((s, j) => (
              <div key={s.id} className="ai-suggest">
                <div><span className="muted">{j + 1}.</span> <b style={{ fontWeight: 500 }}>{s.title}</b> — {s.detail}</div>
                <div className="row" style={{ gap: 6 }}>
                  {s.action && <button className="btn sm ai" onClick={() => apply(s)}>{s.action.kind === 'add-decoupling' ? '放置到原理图' : '添加上拉'}</button>}
                  <button className="btn sm quiet" onClick={() => { const c = sheet.components.find((x) => s.refs[0]?.startsWith(x.ref + '.')); if (c) { app.patch({ selection: [c.id], flyTo: { x: c.x, y: c.y, space: 'sch', seq: Date.now() } }); if (app.screen !== 'sch') app.go('sch'); } }}>定位</button>
                </div>
              </div>
            ))}
            {m.suggestions && <div className="row muted xs" style={{ gap: 6 }}><span style={{ color: 'var(--success)' }}>✓</span>已运行 ERC · {a.erc.errors} 错误 {a.erc.warnings} 警告</div>}
          </div>
        ))}
      </div>
      {msgs.some((m) => appliable(m).length) && (
        <div className="row" style={{ flex: 'none', borderTop: '1px solid var(--border)', padding: '10px 12px' }}>
          <span>建议操作 <span className="mono">({appliable(msgs[msgs.length - 1]).length})</span></span>
          <button className="btn sm ml-auto" onClick={clear}>清空</button>
          <button className="btn sm ai-solid" onClick={() => { let n = 0; for (const s of appliable(msgs[msgs.length - 1])) if (applySuggestion(editor, s)) n++; app.toast(`已应用 ${n} 条建议（可逐条 Undo）`, 'success'); }}>全部应用</button>
        </div>
      )}
      <div className="col" style={{ flex: 'none', borderTop: '1px solid var(--border)', padding: '10px 12px', gap: 8 }}>
        <div className="field" style={{ height: 32, padding: '0 10px' }}>
          <input className="grow" style={{ background: 'transparent', border: 0, color: 'var(--text)' }} placeholder="问点什么，或 / 选择动作…" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') run(input); }} />
          <span className="mono dim">⏎</span>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {['/审查', '/解释选中', '/找元件', '/修复DRC'].map((c) => <span key={c} className="chip ai" onClick={() => c === '/找元件' ? setInput('/找元件 ') : run(c)}>{c}</span>)}
        </div>
      </div>
    </div>
  );
}
