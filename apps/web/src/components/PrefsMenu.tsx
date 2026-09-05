import { useEffect, useRef, useState } from 'react';
import { usePrefs, useT, LOCALES, type Theme, type WheelMode } from '../i18n/index.js';
import { useApp } from '../store/app.js';
import { loadStoreConfig, saveStoreConfig } from '../store/projectStore.js';

/** 头像菜单：语言 / 主题 / 存储模式。 */
export function PrefsMenu({ large }: { large?: boolean }) {
  const [open, setOpen] = useState(false);
  const prefs = usePrefs();
  const t = useT();
  const app = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const [cfg, setCfg] = useState(loadStoreConfig);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const size = large ? 28 : 24;
  const themes: Theme[] = ['dark', 'light', 'system'];
  return (
    <div ref={ref} style={{ position: 'relative', flex: 'none' }} onClick={(e) => e.stopPropagation()}>
      <div className="row" style={{ gap: 0, cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <span className="avatar" style={{ width: size, height: size, background: '#7A8A5E', fontSize: large ? 11 : 10 }}>林</span>
        {!large && <span className="avatar" style={{ background: 'var(--ai)', color: 'var(--bg-topbar)', marginLeft: -8 }}>杰</span>}
      </div>
      {open && (
        <div className="menu" style={{ top: size + 8, right: 0, width: 260 }}>
          <div className="menu-head">{t('settings.language')}</div>
          <div className="row" style={{ padding: '0 6px 6px', gap: 6 }}>
            {LOCALES.map((l) => <span key={l} className={`chip${prefs.locale === l ? ' on' : ''}`} onClick={() => prefs.setLocale(l)}>{t(`lang.${l}` as 'lang.en')}</span>)}
          </div>
          <div className="menu-head">{t('settings.theme')}</div>
          <div className="row" style={{ padding: '0 6px 6px', gap: 6 }}>
            {themes.map((th) => <span key={th} className={`chip${prefs.theme === th ? ' on' : ''}`} onClick={() => prefs.setTheme(th)}>{t(`theme.${th}` as 'theme.dark')}</span>)}
          </div>
          <div className="menu-head">{t('settings.wheel')}</div>
          <div className="col" style={{ padding: '0 6px 6px', gap: 4 }}>
            {(['pan', 'zoom'] as WheelMode[]).map((m) => <span key={m} className={`chip${prefs.wheelMode === m ? ' on' : ''}`} style={{ textAlign: 'left' }} onClick={() => prefs.setWheelMode(m)}>{t(`wheel.${m}` as 'wheel.pan')}</span>)}
          </div>
          <div className="menu-sep" />
          <div className="menu-head">存储</div>
          <div className="row" style={{ padding: '0 6px 6px', gap: 6 }}>
            <span className={`chip${cfg.mode === 'local' ? ' on' : ''}`} onClick={() => setCfg({ ...cfg, mode: 'local' })}>{t('home.storage.local')}</span>
            <span className={`chip${cfg.mode === 'remote' ? ' on' : ''}`} onClick={() => setCfg({ ...cfg, mode: 'remote' })}>{t('home.storage.remote')}</span>
          </div>
          {cfg.mode === 'remote' && (
            <div className="col" style={{ padding: '0 6px 6px', gap: 6 }}>
              <input className="input mono" placeholder="https://your-server/api" value={cfg.url ?? ''} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} />
              <input className="input mono" type="password" placeholder="访问令牌（可选）" value={cfg.token ?? ''} onChange={(e) => setCfg({ ...cfg, token: e.target.value })} />
              <div className="dim xs">服务端（apps/server）在后续里程碑提供；配置会保存，届时生效。</div>
            </div>
          )}
          <div className="row" style={{ padding: '4px 6px 2px' }}>
            <button className="btn sm primary" onClick={() => { saveStoreConfig(cfg); setOpen(false); app.toast('已保存偏好；存储模式在重新加载后生效', 'success'); }}>保存</button>
            <span className="ml-auto dim xs mono">v0.1.0</span>
          </div>
        </div>
      )}
    </div>
  );
}
