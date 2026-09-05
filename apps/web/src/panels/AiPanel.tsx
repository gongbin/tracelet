import { useRef, useState } from 'react';
import { create } from 'zustand';
import type Anthropic from '@anthropic-ai/sdk';
import { searchParts, BUILTIN_PARTS, generateSchematic, sch, type ReviewSuggestion, type ExtractedSchematic } from '@tracelet/kernel';
import { useApp, useEditor, useProject, useSheet } from '../store/app.js';
import { getAnalysis } from '../store/analysis.js';
import { locateItem } from './CheckPanel.js';
import { applySuggestion } from './AiPanelActions.js';
import { useAiConfig, isAiConfigured } from '../ai/config.js';
import { chatWithTools } from '../ai/agent.js';
import { recognizeSchematic, fileToSource, type RecognizeSource } from '../ai/recognize.js';
import { searchCatalog, searchReferenceDesigns, type RefDesign } from '../ai/refdesigns.js';

interface Msg { role: 'user' | 'assistant'; text: string; steps?: string[]; suggestions?: ReviewSuggestion[]; error?: boolean }
interface AiState { msgs: Msg[]; history: Anthropic.Beta.BetaMessageParam[]; busy: boolean; mode: 'chat' | 'ref'; push: (m: Msg) => void; set: (p: Partial<AiState>) => void; clear: () => void }
const useAi = create<AiState>((set) => ({ msgs: [], history: [], busy: false, mode: 'chat', push: (m) => set((s) => ({ msgs: [...s.msgs, m] })), set: (p) => set(p), clear: () => set({ msgs: [], history: [] }) }));

const MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5-1'];

export function AiPanel() {
  const project = useProject();
  const editor = useEditor();
  const app = useApp();
  const a = getAnalysis(project);
  const sheet = useSheet();
  const ai = useAi();
  const { cfg, set: setCfg, save } = useAiConfig();
  const [input, setInput] = useState('');
  const [showCfg, setShowCfg] = useState(false);
  const configured = isAiConfigured(cfg);
  const selRef = app.screen === 'pcb' ? project.board.footprints.filter((f) => app.pcbSelection.includes(f.id)).map((f) => f.ref).join(', ') : sheet.components.filter((c) => app.selection.includes(c.id)).map((c) => c.ref).join(', ');

  // ---- 确定性 / 命令 ----
  const runLocal = (text: string): boolean => {
    const [cmd, ...rest] = text.split(/\s+/); const arg = rest.join(' ');
    if (cmd === '/审查') {
      ai.push({ role: 'assistant', text: a.review.length ? `我检查了原理图，发现 ${a.review.length} 个可以改进的地方：` : '原理图没有发现常见问题（去耦、上拉、限流）。', steps: [`读取网表 · ${a.netlist.nets.length} 个网络`, `运行 ERC · ${a.erc.errors} 错误 ${a.erc.warnings} 警告`, `经验规则审查 · ${a.review.length} 条建议`], suggestions: a.review });
      return true;
    }
    if (cmd === '/解释选中') {
      const c = sheet.components.find((x) => app.selection.includes(x.id));
      if (!c) { ai.push({ role: 'assistant', text: '先在原理图里选中一个元件。' }); return true; }
      const nets = a.netlist.nets.filter((n) => n.pins.some((p) => p.componentId === c.id));
      ai.push({ role: 'assistant', text: `${c.ref}（${c.value}）连接到 ${nets.length} 个网络：${nets.map((n) => `${n.name}（${n.pins.length} 引脚）`).join('、') || '尚未连线'}。`, steps: ['读取选中对象', '查询网表'] });
      return true;
    }
    if (cmd === '/找元件') { const r = searchParts(arg, BUILTIN_PARTS).slice(0, 3); ai.push({ role: 'assistant', text: r.length ? `找到 ${r.length} 个候选：${r.map((p) => `${p.mpn}（${p.maker}，${p.price}）`).join('；')}。在「元件库」里搜「${arg}」即可放置。` : `内置库里没有「${arg}」。`, steps: [`搜索元件库 "${arg}"`] }); return true; }
    if (cmd === '/修复DRC' || cmd === '/修复ERC') {
      const rep = cmd === '/修复DRC' ? a.drc : a.erc;
      if (!rep.items.length) { ai.push({ role: 'assistant', text: '当前没有需要修复的问题。' }); return true; }
      const first = rep.items[0];
      ai.push({ role: 'assistant', text: `共 ${rep.errors} 个错误、${rep.warnings} 个警告。第一条：${first.message}（${first.refs.join(' · ')}）。${first.why}`, steps: [`运行 ${cmd === '/修复DRC' ? 'DRC' : 'ERC'}`] });
      locateItem(first, cmd === '/修复DRC' ? 'pcb' : 'sch');
      return true;
    }
    return false;
  };

  const send = async (raw: string) => {
    const text = raw.trim(); if (!text || ai.busy) return;
    ai.push({ role: 'user', text }); setInput('');
    if (text.startsWith('/') && runLocal(text)) return;
    if (!configured) { ai.push({ role: 'assistant', text: '还没有配置模型。/ 命令（审查、解释选中、找元件、修复 DRC）不需要模型；配置 API Key 后我可以读取你的图纸回答问题并直接修改电路。' }); setShowCfg(true); return; }
    ai.set({ busy: true });
    const liveSteps: string[] = [];
    try {
      const ctxText = `当前：${app.screen === 'pcb' ? 'PCB' : `原理图「${sheet.name}」`}${selRef ? `，选中 ${selRef}` : ''}。`;
      const history: Anthropic.Beta.BetaMessageParam[] = [...ai.history, { role: 'user', content: `${ctxText}\n${text}` }];
      const r = await chatWithTools(cfg, history, { editor, log: (s) => liveSteps.push(s) });
      ai.set({ history: r.history });
      ai.push({ role: 'assistant', text: r.reply.text || '（没有文字回复）', steps: r.reply.steps, error: r.reply.refused });
    } catch (e) { ai.push({ role: 'assistant', text: `调用失败：${(e as Error).message}`, error: true, steps: liveSteps }); }
    finally { ai.set({ busy: false }); }
  };

  const apply = (s: ReviewSuggestion) => { if (applySuggestion(editor, s)) { app.toast(`已应用：${s.title}（可 Undo）`, 'success'); if (app.screen !== 'sch') app.go('sch'); } else app.toast('这条建议暂无自动操作'); };

  return (
    <div className="col" style={{ height: '100%', gap: 0, fontSize: 12 }}>
      <div className="col" style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', gap: 6 }}>
        <div className="row" style={{ gap: 6 }}>
          <span style={{ color: 'var(--ai)' }}>✨</span><span style={{ fontWeight: 500, fontSize: 13 }}>助手</span>
          <div className="seg sm" style={{ marginLeft: 8, height: 24 }}>
            <span className={`seg-opt${ai.mode === 'chat' ? ' on' : ''}`} style={{ padding: '0 8px' }} onClick={() => ai.set({ mode: 'chat' })}>对话</span>
            <span className={`seg-opt${ai.mode === 'ref' ? ' on' : ''}`} style={{ padding: '0 8px' }} onClick={() => ai.set({ mode: 'ref' })}>参考设计</span>
          </div>
          <span className="ml-auto field muted" style={{ height: 24, cursor: 'pointer' }} onClick={() => setShowCfg(!showCfg)}>{configured ? cfg.model : '未配置模型'} ▾</span>
        </div>
        <div className="muted" style={{ fontSize: 11.5 }}>正在看：<span style={{ color: 'var(--text)' }}>{app.screen === 'pcb' ? 'PCB' : `原理图 · ${sheet.name}`}</span> · 选中 <span className="mono" style={{ color: 'var(--text)' }}>{selRef || '无'}</span></div>
        {showCfg && (
          <div className="col" style={{ gap: 6, marginTop: 4 }}>
            <input className="input mono" placeholder="API Key（只存在本机浏览器，直连 Anthropic）" type="password" value={cfg.apiKey} onChange={(e) => setCfg({ apiKey: e.target.value })} />
            <div className="row" style={{ gap: 6 }}>
              <select className="input mono" value={MODELS.includes(cfg.model) ? cfg.model : 'custom'} onChange={(e) => { if (e.target.value !== 'custom') setCfg({ model: e.target.value }); }}>{MODELS.map((m) => <option key={m} value={m}>{m}</option>)}<option value="custom">自定义…</option></select>
              <select className="input" style={{ width: 90 }} value={cfg.effort} onChange={(e) => setCfg({ effort: e.target.value as 'low' })}><option value="low">省 token</option><option value="medium">均衡</option><option value="high">深入</option></select>
            </div>
            <input className="input mono" placeholder="模型 ID（可手填）" value={cfg.model} onChange={(e) => setCfg({ model: e.target.value })} />
            <input className="input mono" placeholder="API Base URL（可选，兼容代理）" value={cfg.baseUrl} onChange={(e) => setCfg({ baseUrl: e.target.value })} />
            <div className="row"><button className="btn sm primary" onClick={() => { save(); setShowCfg(false); app.toast('已保存 AI 配置', 'success'); }}>保存</button><span className="dim xs">费用由你的 API 账号承担；对话启用了服务端安全回退（Opus 5 / Fable）</span></div>
          </div>
        )}
      </div>
      {ai.mode === 'ref' ? <RefDesigns /> : (
        <>
          <div className="grow col" style={{ overflow: 'auto', padding: 12, gap: 12 }}>
            {ai.msgs.length === 0 && (
              <div className="col" style={{ gap: 10 }}>
                <div className="muted">我能读取当前图纸与 PCB，并通过内核命令修改（可撤销）。试试：</div>
                <div className="ai-suggest" style={{ cursor: 'pointer' }} onClick={() => send('/审查')}>帮我检查电源部分有没有问题</div>
                <div className="ai-suggest" style={{ cursor: 'pointer' }} onClick={() => send(configured ? '给 U1 的每个 IO 引脚加一个网络标签，名字用引脚名' : '/找元件 3.3V LDO')}>{configured ? '给 U1 的 IO 引脚都加上网络标签' : '找一个 3.3V 的 LDO'}</div>
                <div className="ai-suggest" style={{ cursor: 'pointer' }} onClick={() => ai.set({ mode: 'ref' })}>从 ESP32-S3 的官方参考设计生成原理图 →</div>
                {a.review.length > 0 && <div className="row muted xs"><span style={{ color: 'var(--warning)' }}>⚠</span>审查发现 {a.review.length} 条建议，输入 /审查 查看</div>}
              </div>
            )}
            {ai.msgs.map((m, i) => m.role === 'user' ? <div key={i} className="ai-msg-user">{m.text}</div> : (
              <div key={i} className="col" style={{ gap: 8 }}>
                {m.steps?.map((s, j) => <div key={j} className="row muted xs" style={{ gap: 6 }}><span style={{ color: 'var(--success)' }}>✓</span>{s}</div>)}
                <div style={{ whiteSpace: 'pre-wrap', color: m.error ? 'var(--error)' : undefined }}>{m.text}</div>
                {m.suggestions?.map((s, j) => (
                  <div key={s.id} className="ai-suggest">
                    <div><span className="muted">{j + 1}.</span> <b style={{ fontWeight: 500 }}>{s.title}</b> — {s.detail}</div>
                    <div className="row" style={{ gap: 6 }}>
                      {s.action && <button className="btn sm ai" onClick={() => apply(s)}>{s.action.kind === 'add-decoupling' ? '放置到原理图' : '添加上拉'}</button>}
                      <button className="btn sm quiet" onClick={() => { const c = sheet.components.find((x) => s.refs[0]?.startsWith(x.ref + '.')); if (c) { app.patch({ selection: [c.id], flyTo: { x: c.x, y: c.y, space: 'sch', seq: Date.now() } }); if (app.screen !== 'sch') app.go('sch'); } }}>定位</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {ai.busy && <div className="row muted xs"><span className="spinner" />模型思考中…</div>}
          </div>
          {ai.msgs.length > 0 && <div className="row" style={{ flex: 'none', borderTop: '1px solid var(--border)', padding: '6px 12px' }}><span className="dim xs">{ai.history.length} 轮上下文</span><button className="btn sm ml-auto" onClick={ai.clear}>清空对话</button></div>}
          <div className="col" style={{ flex: 'none', borderTop: '1px solid var(--border)', padding: '10px 12px', gap: 8 }}>
            <div className="field" style={{ height: 32, padding: '0 10px' }}>
              <input className="grow" style={{ background: 'transparent', border: 0, color: 'var(--text)' }} placeholder={configured ? '问点什么，或让我修改电路…' : '问点什么，或 / 选择动作…'} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void send(input); }} disabled={ai.busy} />
              <span className="mono dim">⏎</span>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {['/审查', '/解释选中', '/找元件', '/修复DRC'].map((c) => <span key={c} className="chip ai" onClick={() => c === '/找元件' ? setInput('/找元件 ') : void send(c)}>{c}</span>)}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** 参考设计工作流：搜索 → 选择 PDF → 识别 → 预览 → 生成为新图纸。 */
function RefDesigns() {
  const app = useApp();
  const editor = useEditor();
  const { cfg } = useAiConfig();
  const configured = isAiConfigured(cfg);
  const [q, setQ] = useState('ESP32-S3');
  const [results, setResults] = useState<RefDesign[]>(searchCatalog('ESP32'));
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<{ spec: ExtractedSchematic; from: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doSearch = async () => {
    const local = searchCatalog(q);
    setResults(local);
    if (!configured) { if (!local.length) app.toast('目录里没有匹配项；配置模型后可联网搜索'); return; }
    setSearching(true);
    try { const web = await searchReferenceDesigns(cfg, q); setResults([...local, ...web.filter((w) => !local.some((l) => l.url === w.url))]); if (!web.length && !local.length) app.toast('没有搜到 PDF 链接，试试更具体的型号'); }
    catch (e) { app.toast(`搜索失败：${(e as Error).message}`, 'error'); }
    finally { setSearching(false); }
  };
  const recognize = async (src: RecognizeSource, label: string) => {
    if (!configured) { app.toast('识别需要先配置模型（右上角 ▾）', 'error'); return; }
    setBusy(label);
    try { const spec = await recognizeSchematic(cfg, src); setExtracted({ spec, from: label }); app.toast(`识别完成：${spec.components.length} 个元件`, 'success'); }
    catch (e) { app.toast(`识别失败：${(e as Error).message}`, 'error'); }
    finally { setBusy(null); }
  };
  const generate = () => {
    if (!extracted) return;
    const r = generateSchematic(extracted.spec, { sheetName: (extracted.spec.title || extracted.from).slice(0, 24) });
    editor.dispatch(sch.addGeneratedSheet(r.sheet, r.symbols));
    app.patch({ sheetId: r.sheet.id, selection: [] });
    if (app.screen !== 'sch') app.go('sch');
    app.toast(`已生成图纸「${r.sheet.name}」：${r.stats.components} 元件 · ${r.stats.nets} 网络（可 Undo）`, 'success');
    setExtracted(null);
  };

  return (
    <div className="grow col" style={{ overflow: 'auto', padding: 12, gap: 12 }}>
      <div className="col" style={{ gap: 6 }}>
        <div className="kicker">1 · 找到参考设计</div>
        <div className="row field" style={{ height: 32, padding: '0 8px' }}>
          <input className="grow mono" style={{ background: 'transparent', border: 0, color: 'var(--text)' }} placeholder="主控型号 / 模块，如 ESP32-S3、RP2040、STM32F103" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void doSearch(); }} />
          <button className="btn sm primary" onClick={() => void doSearch()} disabled={searching}>{searching ? '搜索中…' : configured ? '搜索（含联网）' : '搜目录'}</button>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{['ESP32-S3', 'ESP32-C3', 'RP2040', 'Arduino', 'STM32'].map((k) => <span key={k} className="chip" onClick={() => { setQ(k); setResults(searchCatalog(k)); }}>{k}</span>)}</div>
      </div>
      <div className="col" style={{ gap: 6 }}>
        {results.map((r) => (
          <div key={r.url} className="issue" style={{ gap: 4 }}>
            <div className="row" style={{ gap: 6 }}><span style={{ fontWeight: 500 }}>{r.title}</span><span className="dim xs">{r.vendor}</span>{r.source === 'search' && <span className="chip ai" style={{ padding: '0 5px' }}>联网</span>}</div>
            <a className="mono xs nowrap" href={r.url} target="_blank" rel="noreferrer">{r.url}</a>
            {r.note && <div className="dim xs">{r.note}</div>}
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm ai" disabled={!!busy} onClick={() => void recognize({ kind: 'url', url: r.url }, r.title)}>{busy === r.title ? '识别中…' : '识别并生成原理图'}</button>
              <a className="btn sm quiet" href={r.url} download target="_blank" rel="noreferrer">下载 PDF</a>
            </div>
          </div>
        ))}
        {!results.length && <div className="dim">没有结果</div>}
      </div>
      <div className="col" style={{ gap: 6 }}>
        <div className="kicker">或 · 上传自己的原理图 PDF / 截图</div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn" onClick={() => fileRef.current?.click()} disabled={!!busy}>{busy === '上传文件' ? '识别中…' : '选择文件…'}</button>
          <span className="dim xs">PDF / PNG / JPG · 不超过 32MB · 也可以直接拖到这里</span>
        </div>
        <input ref={fileRef} type="file" accept=".pdf,image/png,image/jpeg,image/webp" hidden onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (!f) return; try { await recognize(await fileToSource(f), '上传文件'); } catch (err) { app.toast((err as Error).message, 'error'); } }} />
      </div>
      {busy && <div className="row muted xs"><span className="spinner" />模型正在阅读「{busy}」并抽取元件与连接，PDF 页数多时可能需要一两分钟…</div>}
      {extracted && (
        <div className="col" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="kicker">2 · 识别结果 · {extracted.spec.title || extracted.from}</div>
          <div className="muted">{extracted.spec.components.length} 个元件 · {new Set(extracted.spec.components.flatMap((c) => c.pins.map((p) => p.net).filter(Boolean))).size} 个网络</div>
          <div style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
            <table className="data"><thead><tr><th>位号</th><th>值</th><th>引脚</th></tr></thead><tbody>
              {extracted.spec.components.map((c) => <tr key={c.ref}><td className="mono">{c.ref}</td><td className="mono">{c.value}</td><td className="dim xs">{c.pins.filter((p) => p.net).length}/{c.pins.length} 已连</td></tr>)}
            </tbody></table>
          </div>
          {extracted.spec.notes?.length ? <div className="dim xs">备注：{extracted.spec.notes.join('；')}</div> : null}
          <div className="row" style={{ gap: 6 }}>
            <button className="btn primary" onClick={generate}>生成为新图纸</button>
            <button className="btn" onClick={() => setExtracted(null)}>放弃</button>
            <span className="dim xs ml-auto">生成后可撤销</span>
          </div>
        </div>
      )}
    </div>
  );
}
