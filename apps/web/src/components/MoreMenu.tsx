/**
 * 左侧工具栏底部的「⋯」设置弹层：放不属于当前工具、又不属于身份 / 存储的开关。
 * 目前是元件详情页的报价数据源（头像菜单继续管姓名、存储与 MCP 桥）。
 */
import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.js';
import { I } from '../icons.js';
import { useApp } from '../store/app.js';
import { usePartPricing, DEFAULT_PRICING_URL } from '../store/partPricing.js';

export function MoreMenu() {
  const [open, setOpen] = useState(false);
  const [testing, setTesting] = useState(false);
  const [spec, setSpec] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const app = useApp();
  const pricing = usePartPricing();
  const [url, setUrl] = useState(pricing.url);
  useEffect(() => { setUrl(pricing.url); }, [pricing.url]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const cached = Object.keys(pricing.cache).length;
  const commit = (next: string) => {
    const value = next.trim() || DEFAULT_PRICING_URL;
    if (value === pricing.url) { setUrl(value); return; }
    pricing.setUrl(value); setUrl(value);
    app.toast(`报价数据源已改为 ${value}`, 'success');
  };
  const test = async () => {
    const base = (url.trim() || DEFAULT_PRICING_URL).replace(/\/+$/, '');
    setTesting(true);
    try {
      const res = await fetch(`${base}/components/list.json?search=10k%200603&limit=1&full=true`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { components?: unknown[] };
      if (!Array.isArray(data.components)) throw new Error('返回里没有 components 数组');
      app.toast(`连接成功：接口返回 ${data.components.length} 条结果`, 'success');
    } catch (e) { app.toast(`连接失败：${(e as Error).message}`, 'error'); }
    setTesting(false);
  };
  return (
    <div ref={ref} style={{ marginTop: 'auto' }} onClick={(e) => e.stopPropagation()}>
      <button className={`tool${open ? ' on' : ''}`} title="设置" onClick={() => setOpen(!open)}><Icon d={I.more} size={18} stroke={2.5} /></button>
      {open && (
        <div className="menu" style={{ left: 52, bottom: 6, width: 300 }}>
          <div className="menu-head">元件报价（库 → 元件详情）</div>
          <div className="row" style={{ padding: '0 6px 6px', gap: 6 }}>
            <span className={`chip${pricing.enabled ? ' on' : ''}`} onClick={() => pricing.setEnabled(!pricing.enabled)}>{pricing.enabled ? '在线查价已开启' : '在线查价已关闭'}</span>
            {cached > 0 && <span className="ml-auto dim xs" style={{ cursor: 'pointer' }} title="清空本机缓存的报价" onClick={() => { pricing.clear(); app.toast('已清空报价缓存'); }}>缓存 {cached} 条 · 清空</span>}
          </div>
          <div className="menu-head">数据源（默认 jlcsearch，查 JLC / LCSC 装配库）</div>
          <div className="col" style={{ padding: '0 6px 6px', gap: 6 }}>
            <input className="input mono xs" placeholder={DEFAULT_PRICING_URL} value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} onBlur={(e) => commit(e.target.value)} />
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" disabled={testing} onClick={() => void test()}>{testing ? '测试中…' : '测试连接'}</button>
              <button className="btn sm" disabled={url === DEFAULT_PRICING_URL} onClick={() => commit(DEFAULT_PRICING_URL)}>恢复默认</button>
            </div>
            <div className="dim xs">开启后每次查询只发送型号，结果在本机缓存 24 小时；关闭则完全不联网。</div>
            <div className="dim xs" style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => setSpec(!spec)}>接口约定 {spec ? '▴' : '▾'}</div>
            {spec && <div className="col dim xs" style={{ gap: 4, lineHeight: 1.6 }}>
              <code>GET &lt;url&gt;/components/list.json?search=&lt;mpn&gt;&amp;limit=8&amp;full=true</code>
              <code>{'→ { components: [{ lcsc, mfr, package, description, stock, price }] }'}</code>
              <div><code>price</code> 形如 <code>1-9:0.80,10-:0.66</code></div>
              <div>自建代理照这个格式返回即可（Digi-Key / Mouser 这类需要密钥、不允许跨域的接口，只能这样接进来）。</div>
            </div>}
          </div>
          <div className="menu-sep" />
          <div className="dim xs" style={{ padding: '2px 8px 4px', lineHeight: 1.6 }}>姓名、画布手势、存储模式与本地 Agent 在右上角头像菜单里。</div>
        </div>
      )}
    </div>
  );
}
