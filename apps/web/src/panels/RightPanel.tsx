import { useApp, type RightTab } from '../store/app.js';
import { PropertiesPanel } from './PropertiesPanel.js';
import { LayersPanel } from './LayersPanel.js';
import { LibraryPanel } from './LibraryPanel.js';
import { CheckPanel } from './CheckPanel.js';
import { AiPanel } from './AiPanel.js';
import { View3dPanel } from './View3dPanel.js';
import { GuidePanel } from './GuidePanel.js';
import { useT } from '../i18n/index.js';

export function defaultTab(screen: string): RightTab { return screen === 'pcb' ? 'layers' : screen === '3d' ? '3d' : 'props'; }

export function RightPanel() {
  const screen = useApp((s) => s.screen);
  const rightTab = useApp((s) => s.rightTab);
  const set = useApp((s) => s.set);
  const t = useT();
  const tab = rightTab ?? defaultTab(screen);
  const tabs: [RightTab, string][] = screen === '3d' ? [['3d', t('tab.3d')]] : screen === 'pcb' ? [['layers', t('tab.layers')], ['props', t('tab.props')], ['lib', t('tab.lib')], ['check', t('tab.check')], ['guide', t('tab.guide')], ['ai', t('tab.ai')]] : [['props', t('tab.props')], ['lib', t('tab.lib')], ['check', t('tab.check')], ['guide', t('tab.guide')], ['ai', t('tab.ai')]];
  return (
    <div className="rightpanel">
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
        {tab === 'guide' && <GuidePanel />}
      </div>
    </div>
  );
}
