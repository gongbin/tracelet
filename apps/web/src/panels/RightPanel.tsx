import { useEffect, useRef, useState } from 'react';
import { useApp, type RightTab } from '../store/app.js';
import { PropertiesPanel } from './PropertiesPanel.js';
import { LayersPanel } from './LayersPanel.js';
import { LibraryPanel } from './LibraryPanel.js';
import { CheckPanel } from './CheckPanel.js';
import { AiPanel } from './AiPanel.js';
import { View3dPanel } from './View3dPanel.js';
import { useT } from '../i18n/index.js';

export function defaultTab(screen: string): RightTab { return screen === 'pcb' ? 'layers' : screen === '3d' ? '3d' : 'props'; }

export function RightPanel() {
  const screen = useApp((s) => s.screen);
  const rightTab = useApp((s) => s.rightTab);
  const set = useApp((s) => s.set);
  const t = useT();
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = () => { setMobileOpen(false); toggle.current?.focus(); };
  useEffect(() => {
    if (!mobileOpen) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setMobileOpen(false); toggle.current?.focus(); } };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [mobileOpen]);
  const tab = rightTab ?? defaultTab(screen);
  const tabs: [RightTab, string][] = screen === '3d' ? [['3d', t('tab.3d')]] : screen === 'pcb' ? [['layers', t('tab.layers')], ['props', t('tab.props')], ['lib', t('tab.lib')], ['check', t('tab.check')], ['ai', t('tab.ai')]] : [['props', t('tab.props')], ['lib', t('tab.lib')], ['check', t('tab.check')], ['ai', t('tab.ai')]];
  return (
    <>
    <button ref={toggle} className="btn mobile-panel-toggle" aria-label={t('panel.open')} aria-expanded={mobileOpen} aria-controls="workspace-right-panel" onClick={() => setMobileOpen(!mobileOpen)} data-no-translate>☷ {t('tab.props')}</button>
    {mobileOpen && <button className="mobile-panel-backdrop" aria-label={t('panel.close')} onClick={close} />}
    <div id="workspace-right-panel" className={`rightpanel${mobileOpen ? ' mobile-open' : ''}`}>
      <div className="mobile-panel-heading"><span data-no-translate>{t('tab.props')}</span><button className="iconbtn" aria-label={t('panel.close')} onClick={close}>✕</button></div>
      <div className="rightpanel-tabs">
        {tabs.map(([id, label]) => <button key={id} className={`${tab === id ? 'on' : ''} ${id === 'ai' ? 'ai' : ''}`} onClick={() => set('rightTab', id)}>{label}</button>)}
      </div>
      <div className="rightpanel-body">
        {tab === 'props' && <PropertiesPanel />}
        {tab === 'layers' && <LayersPanel />}
        {tab === 'lib' && <LibraryPanel />}
        {tab === 'check' && <CheckPanel />}
        {tab === 'ai' && <AiPanel />}
        {tab === '3d' && <View3dPanel />}
      </div>
    </div>
    </>
  );
}
