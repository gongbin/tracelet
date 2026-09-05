import { useEffect } from 'react';
import { useApp } from './store/app.js';
import { Home } from './screens/Home.js';
import { Wizard } from './screens/Wizard.js';
import { Workspace } from './screens/Workspace.js';
import { CommandPalette } from './components/CommandPalette.js';
import { Toasts } from './components/Toasts.js';

export function App() {
  const editor = useApp((s) => s.editor);
  const wizardOpen = useApp((s) => s.wizardOpen);
  const refresh = useApp((s) => s.refreshProjects);
  const set = useApp((s) => s.set);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); set('paletteOpen', !useApp.getState().paletteOpen); }
      else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); set('wizardOpen', true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [set]);

  return (
    <div className="app" onClick={() => { const s = useApp.getState(); if (s.projMenuOpen || s.pwrMenuOpen) s.patch({ projMenuOpen: false, pwrMenuOpen: false }); }}>
      {editor ? <Workspace /> : <Home />}
      {wizardOpen && <Wizard />}
      <CommandPalette />
      <Toasts />
    </div>
  );
}
