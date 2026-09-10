import { useEffect, useRef, useState } from 'react';
import { useAiConfig, aiConfigIssue } from '../ai/config.js';
import { analyzeProjectRequirements, projectFromAiPlan, type AiProjectPlan } from '../ai/createProject.js';
import { describeError } from '../ai/client.js';
import { useApp } from '../store/app.js';
import { usePrefs, useT } from '../i18n/index.js';

export function AiProjectDialog({ onClose }: { onClose: () => void }) {
  const t = useT(), locale = usePrefs((s) => s.locale);
  const { cfg, set, save } = useAiConfig();
  const [requirements, setRequirements] = useState('');
  const [plan, setPlan] = useState<AiProjectPlan | null>(null);
  const [busy, setBusy] = useState(false), [chars, setChars] = useState(0), [error, setError] = useState('');
  const issue = aiConfigIssue(cfg);
  const [settings, setSettings] = useState(!!issue);
  const [focusConfig, setFocusConfig] = useState(0);
  const abort = useRef<AbortController | null>(null), root = useRef<HTMLDivElement>(null), creating = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const field = aiConfigIssue(useAiConfig.getState().cfg);
    root.current?.querySelector<HTMLElement>(field ? `[data-ai-config="${field}"]` : 'textarea')?.focus();
    return () => { abort.current?.abort(); previous?.focus(); };
  }, []);
  useEffect(() => {
    if (focusConfig) root.current?.querySelector<HTMLElement>(`[data-ai-config="${aiConfigIssue(cfg) ?? 'apiKey'}"]`)?.focus();
  }, [focusConfig]);
  const configure = () => { setSettings(true); setFocusConfig((n) => n + 1); };
  const cancel = () => { abort.current?.abort(); abort.current = null; setBusy(false); };
  const analyze = async () => {
    if (abort.current) return;
    if (issue) { configure(); return; }
    if (!requirements.trim()) return;
    const ac = new AbortController(); abort.current = ac;
    setBusy(true); setError(''); setPlan(null); setChars(0); save();
    try {
      const result = await analyzeProjectRequirements({ ...cfg }, requirements, { locale, signal: ac.signal, onProgress: (n) => { if (!ac.signal.aborted) setChars(n); } });
      if (!ac.signal.aborted) setPlan(result);
    } catch (e) { if (!ac.signal.aborted) setError(describeError(e)); }
    finally { if (abort.current === ac) { abort.current = null; setBusy(false); } }
  };
  const generate = async () => {
    if (!plan || creating.current) return;
    creating.current = true; setError('');
    try {
      const p = projectFromAiPlan(plan);
      await useApp.getState().store.save(p);
      useApp.getState().openProjectObject(p); onClose();
    } catch (e) { setError(describeError(e)); }
    finally { creating.current = false; }
  };
  return <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) { cancel(); onClose(); } }}>
    <div className="dialog ai-project-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-project-title" ref={root} onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { cancel(); onClose(); }
      if (e.key === 'Tab') {
        const els = [...root.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')];
        const first = els[0], last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="row"><h2 id="ai-project-title">{t('aiProject.title')}</h2><button className="btn ml-auto" aria-label={t('aiProject.close')} onClick={() => { cancel(); onClose(); }}>×</button></div>
      <p className="muted">{t('aiProject.intro')}</p>
      {issue && <div role="alert" className="col ai-project-settings" style={{ gap: 8 }}>
        <span>{t(issue === 'baseUrl' ? 'aiProject.invalidUrl' : 'aiProject.setupNeeded')}</span>
      </div>}
      <label htmlFor="ai-project-requirements">{t('aiProject.requirements')}</label>
      <textarea id="ai-project-requirements" className="input" rows={5} maxLength={12000} disabled={busy} value={requirements} placeholder={t('aiProject.example')} onChange={(e) => { setRequirements(e.target.value); setPlan(null); setError(''); }} />
      <div className="row"><button className="btn" onClick={() => setSettings(!settings)} aria-expanded={settings}>{t('aiProject.settings')}</button><span className="muted small">{cfg.model}</span></div>
      {settings && <fieldset disabled={busy} className="col ai-project-settings">
        <label>{t('aiProject.url')}<input className="input" data-ai-config="baseUrl" aria-invalid={issue === 'baseUrl'} value={cfg.baseUrl} placeholder="https://api.anthropic.com" onChange={(e) => set({ baseUrl: e.target.value })} /></label>
        <label>API Key<input className="input" data-ai-config="apiKey" aria-invalid={issue === 'apiKey'} type="password" autoComplete="off" value={cfg.apiKey} onChange={(e) => set({ apiKey: e.target.value })} /></label>
        <label>{t('aiProject.model')}<input className="input" data-ai-config="model" aria-invalid={issue === 'model'} value={cfg.model} onChange={(e) => set({ model: e.target.value })} /></label>
        <p className="muted small">{t('aiProject.privacy')}</p>
        <button className="btn" onClick={() => { if (issue) { configure(); return; } save(); setSettings(false); }}>{t('aiProject.save')}</button>
      </fieldset>}
      {error && <div role="alert" className="ai-project-error">{error}</div>}
      <div className="row">
        <button className="btn primary" disabled={busy || (!issue && !requirements.trim())} onClick={() => void analyze()}>{t(issue ? 'aiProject.configure' : plan ? 'aiProject.retry' : 'aiProject.analyze')}</button>
        {busy && <><span role="status" className="muted">{t('aiProject.busy', { chars })}</span><button className="btn" onClick={cancel}>{t('aiProject.cancel')}</button></>}
      </div>
      {plan && <section className="col ai-project-plan">
        <h3>{plan.title}</h3><p>{plan.summary}</p>
        <div className="ai-project-table"><table><thead><tr><th>{t('aiProject.ref')}</th><th>{t('aiProject.part')}</th><th>{t('aiProject.purpose')}</th></tr></thead><tbody>{plan.components.map((c) => <tr key={c.ref}><td>{c.ref}</td><td>{c.value}<div className="muted small">{c.footprint || '—'}</div></td><td>{c.description}</td></tr>)}</tbody></table></div>
        {plan.notes.length > 0 && <><strong>{t('aiProject.notes')}</strong><ul>{plan.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></>}
        <p className="muted small">{t('aiProject.review')}</p>
        <button className="btn primary" onClick={() => void generate()}>{t('aiProject.generate', { count: plan.components.length })}</button>
      </section>}
    </div>
  </div>;
}
