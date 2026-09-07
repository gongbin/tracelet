/**
 * 元件详情：参数 / 外观 / 引脚 / 参考价。
 * 外观全部本地矢量渲染（符号、封装、立体示意），不依赖任何外部图片；
 * 价格是可选的在线查询（默认关闭，见 store/partPricing.ts），关掉或查不到时整块不显示。
 */
import { Fragment, useEffect, useMemo, type ReactNode } from 'react';
import { getSymbol, findFootprint, DISTRIBUTORS, unitPriceAt, priceRange, type Part, type FootprintDef, type PartOffer } from '@tracelet/kernel';
import { SymbolThumb, FootprintThumb } from './Thumbs.js';
import { iconUrl } from './CategoryFilter.js';
import { usePartPricing, DEFAULT_PRICING_URL } from '../store/partPricing.js';

/** 详情页的数据源：既能来自内置零件，也能来自项目库符号 / 封装 / 我的库存。 */
export interface PartDetailTarget {
  name: string;
  maker?: string;
  kind?: string;
  category?: string;
  description?: string;
  value?: string;
  params?: string;
  symbolId?: string;
  footprintId?: string;
  lcsc?: string;
  part?: Part;
  /** 型号：用于在线查价与分销商搜索，缺省用 name */
  mpn?: string;
}

const PIN_TYPE: Record<string, string> = { input: '输入', output: '输出', bidirectional: '双向', passive: '无源', power_in: '电源输入', power_out: '电源输出', open_collector: '开漏', no_connect: '不连接' };
const money = (v: number) => (v < 1 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`; };

/** 立体外观示意：由封装本体尺寸与高度等轴测投影，焊盘画在板面上。纯示意，不是 3D 模型。 */
function BodyIso({ fp, size = 120 }: { fp: FootprintDef; size?: number }) {
  const body = fp.physicalBody ?? fp.body;
  const h = Math.max(fp.height || 0.5, 0.2);
  const bx = body.x ?? 0, by = body.y ?? 0;
  const iso = (x: number, y: number, z: number) => ({ x: (x - y) * 0.866, y: (x + y) * 0.5 - z });
  const corner = (sx: number, sy: number, z: number) => iso(bx + (sx * body.w) / 2, by + (sy * body.h) / 2, z);
  const face = (pts: { x: number; y: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(3)} ${p.y.toFixed(3)}`).join('') + 'Z';
  const top = [corner(-1, -1, h), corner(1, -1, h), corner(1, 1, h), corner(-1, 1, h)];
  const left = [corner(-1, 1, h), corner(1, 1, h), corner(1, 1, 0), corner(-1, 1, 0)];
  const right = [corner(1, -1, h), corner(1, 1, h), corner(1, 1, 0), corner(1, -1, 0)];
  const pads = fp.pads.filter((p) => !p.npth).map((p) => [iso(p.x - p.w / 2, p.y - p.h / 2, 0), iso(p.x + p.w / 2, p.y - p.h / 2, 0), iso(p.x + p.w / 2, p.y + p.h / 2, 0), iso(p.x - p.w / 2, p.y + p.h / 2, 0)]);
  const all = [...top, ...left, ...right, ...pads.flat()];
  const xs = all.map((p) => p.x), ys = all.map((p) => p.y);
  const pad = Math.max(...xs.map(Math.abs), ...ys.map(Math.abs)) * 0.12 + 0.2;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) - minX + pad, hh = Math.max(...ys) - minY + pad;
  const ext = Math.max(w, hh);
  const sw = ext / 160;
  return (
    <svg width={size} height={size} viewBox={`${minX - (ext - w) / 2} ${minY - (ext - hh) / 2} ${ext} ${ext}`}>
      {pads.map((p, i) => <path key={'pad' + i} d={face(p)} fill="#C8843488" stroke="#C87A34" strokeWidth={sw} />)}
      <path d={face(left)} fill="var(--text-3)" opacity={0.55} />
      <path d={face(right)} fill="var(--text-3)" opacity={0.35} />
      <path d={face(top)} fill="var(--text-2)" opacity={0.75} stroke="var(--text-2)" strokeWidth={sw} strokeLinejoin="round" />
    </svg>
  );
}

/** 参考价：阶梯价表 + 库存 + 数据来源。 */
function OfferBlock({ mpn, alt }: { mpn: string; alt?: string }) {
  const pricing = usePartPricing();
  const entry = pricing.cache[mpn.toLowerCase().replace(/[^a-z0-9]/g, '')];
  const busy = pricing.busy.includes(mpn.toLowerCase().replace(/[^a-z0-9]/g, ''));
  useEffect(() => { if (pricing.enabled && mpn) void pricing.lookup(mpn, { alt }); }, [pricing.enabled, mpn, alt]);
  if (!pricing.enabled) {
    return (
      <div className="col" style={{ gap: 6 }}>
        <div className="kicker">参考价</div>
        <div className="dim xs" style={{ lineHeight: 1.6 }}>在线查价默认关闭。开启后会把型号发送到 {new URL(pricing.url || DEFAULT_PRICING_URL).host} 查询 JLC / LCSC 装配库的库存与阶梯价，结果缓存在本机 24 小时。</div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm primary" onClick={() => { pricing.setEnabled(true); void pricing.lookup(mpn, { alt }); }}>开启在线查价</button>
          <span className="dim xs">其余分销商只提供搜索链接，不联网查询</span>
        </div>
      </div>
    );
  }
  const offer: PartOffer | null = entry?.offer ?? null;
  const range = offer ? priceRange(offer.tiers) : undefined;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8 }}>
        <div className="kicker">参考价 · JLC / LCSC</div>
        <span className="ml-auto xs" style={{ cursor: 'pointer', color: 'var(--accent)' }} onClick={() => void pricing.lookup(mpn, { alt, force: true })}>{busy ? '查询中…' : '刷新'}</span>
        <span className="dim xs" style={{ cursor: 'pointer' }} title="关闭在线查价" onClick={() => pricing.setEnabled(false)}>关闭</span>
      </div>
      {busy && !entry && <div className="dim xs">查询中…</div>}
      {entry?.error && <div className="xs" style={{ color: 'var(--error)' }}>查询失败：{entry.error}</div>}
      {entry && !entry.error && !offer && <div className="dim xs">JLC 装配库里没有这个型号{entry.alternatives?.length ? '，下面是参数相近的同类可选：' : '（贴片时需要自购）。'}</div>}
      {!offer && entry?.alternatives?.map((a) => (
        <div key={a.mpn} className="col" style={{ gap: 2, padding: '6px 8px', borderRadius: 4, background: 'var(--bg-raised)' }}>
          <div className="row xs" style={{ gap: 6 }}>
            <span className="mono nowrap grow">{a.mpn}</span>
            {a.package && <span className="dim mono">{a.package}</span>}
            <span style={{ color: 'var(--success)' }}>库存 {(a.offer.stock ?? 0).toLocaleString()}</span>
            <span className="mono">{money(unitPriceAt(a.offer.tiers, 100) ?? 0)}</span>
          </div>
          <div className="row dim xs" style={{ gap: 6 }}>
            <span className="nowrap grow" style={{ minWidth: 0 }}>{a.description}</span>
            {a.offer.sku && <a href={a.offer.url} target="_blank" rel="noreferrer">{a.offer.sku} ↗</a>}
          </div>
        </div>
      ))}
      {!offer && !!entry?.alternatives?.length && <div className="dim xs">同类可选按 100 片单价排列显示，替换前请核对精度 / 耐压 / 温漂等参数。</div>}
      {offer && (
        <>
          <div className="row xs" style={{ gap: 8, flexWrap: 'wrap' }}>
            {offer.sku && <span className="mono">{offer.sku}</span>}
            {offer.note && <span className="chip" style={{ cursor: 'default' }}>{offer.note}</span>}
            <span style={{ color: (offer.stock ?? 0) > 0 ? 'var(--success)' : 'var(--warning)' }}>库存 {(offer.stock ?? 0).toLocaleString()}</span>
            {range && <span className="mono">{range.min === range.max ? money(range.min) : `${money(range.min)} – ${money(range.max)}`}</span>}
          </div>
          {offer.tiers.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 4 }}>
              {offer.tiers.map((t, i) => (
                <div key={i} className="col xs" style={{ gap: 1, padding: '4px 6px', borderRadius: 4, background: 'var(--bg-raised)' }}>
                  <span className="dim mono">{t.max == null ? `${t.min}+` : `${t.min}–${t.max}`}</span>
                  <span className="mono">{money(t.price)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="dim xs" style={{ lineHeight: 1.6 }}>
            {offer.tiers.length ? `100 片单价约 ${money(unitPriceAt(offer.tiers, 100) ?? 0)} · ` : ''}美元含税前价格 · 数据更新于 {ago(offer.fetchedAt)}
            {offer.url && <> · <a href={offer.url} target="_blank" rel="noreferrer">在 LCSC 打开 ↗</a></>}
          </div>
          <div className="dim xs">价格与库存仅供参考，最终以分销商下单页为准（币种、税费、运费、起订量各站不同，不能直接横向相减）。</div>
        </>
      )}
    </div>
  );
}

export function PartDetail({ target, close, onPlaceSymbol, onPlaceFootprint, onFavorite, favorite, onInventory }: {
  target: PartDetailTarget;
  close: () => void;
  onPlaceSymbol?: () => void;
  onPlaceFootprint?: () => void;
  onFavorite?: () => void;
  favorite?: boolean;
  onInventory?: () => void;
}) {
  const t = target;
  const mpn = (t.mpn ?? t.part?.mpn ?? t.name).trim();
  const sym = useMemo(() => (t.symbolId ? getSymbol(t.symbolId) : null), [t.symbolId]);
  const fp = useMemo(() => (t.footprintId ? findFootprint(t.footprintId) : null), [t.footprintId]);
  const pins = (sym && sym.source !== 'missing' ? sym.pins : []).filter((p) => !p.hidden);
  const category = t.category ?? t.part?.category;
  const lcsc = t.lcsc ?? t.part?.lcsc;
  const datasheet = t.part?.datasheet;
  // 查不到原型号时用「值 + 封装尺寸」找同类（Ω / μ 等非 ASCII 字符会让搜索失配，先去掉）
  const altQuery = useMemo(() => {
    const value = (t.value ?? '').replace(/[^\w.\/+-]/g, '');
    const size = fp ? (/[_-](\d{4})(?:[_-]|$)/.exec(fp.name)?.[1] ?? /^(?:R|C|L|LED|D|F)[_-](\d{4})/.exec(fp.name)?.[1] ?? '') : '';
    return [value, size].filter(Boolean).join(' ') || undefined;
  }, [t.value, fp]);
  const rows: [string, ReactNode][] = [
    ['型号', <span className="mono">{mpn}</span>],
    ...(t.maker ? [['厂商', t.maker] as [string, ReactNode]] : []),
    ...(t.kind ? [['类别', t.kind] as [string, ReactNode]] : []),
    ...(t.value ? [['值', <span className="mono">{t.value}</span>] as [string, ReactNode]] : []),
    ...(t.params ? [['参数', t.params] as [string, ReactNode]] : []),
    ...(t.description && t.description !== t.params ? [['描述', t.description] as [string, ReactNode]] : []),
    ['符号', sym && sym.source !== 'missing' ? <span className="mono">{sym.name} · {pins.length} 引脚</span> : <span className="dim">未指定</span>],
    ['封装', fp ? <span className="mono">{fp.name} · {fp.pads.length} 焊盘 · {fp.body.w}×{fp.body.h} mm · 高 {fp.height} mm</span> : <span className="dim">{t.footprintId ? `${t.footprintId}（同步时按名称映射）` : '未指定'}</span>],
    ...(fp?.provenance ? [['封装来源', <span className="xs">{fp.provenance.source}{fp.provenance.verified ? ' · 已核对' : ' · 未核对，量产前请对数据手册'}</span>] as [string, ReactNode]] : []),
    ...(lcsc ? [['LCSC', <span className="mono">{lcsc}</span>] as [string, ReactNode]] : []),
    ...(t.part ? [['3D 模型', t.part.has3d ? '有' : <span className="dim">无（按封装高度占位）</span>] as [string, ReactNode]] : []),
    ['数据手册', datasheet && /^https?:\/\//.test(datasheet)
      ? <a href={datasheet} target="_blank" rel="noreferrer">{datasheet.replace(/^https?:\/\//, '').slice(0, 46)} ↗</a>
      : <a href={`https://www.lcsc.com/search?q=${encodeURIComponent(mpn)}`} target="_blank" rel="noreferrer">在 LCSC 查找 {mpn} 的数据手册 ↗</a>]
  ];
  return (
    <div className="overlay" onClick={close}>
      <div className="dialog" style={{ width: 720, maxHeight: 'calc(100vh - 64px)' }} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          {category && <span className="cat-icon" style={{ width: 40, height: 40, ['--icon' as string]: `url(${iconUrl(category, 'solid-45')})`, color: 'var(--text-2)' }} />}
          <div style={{ minWidth: 0 }}>
            <div className="mono nowrap" style={{ fontWeight: 600, fontSize: 15 }}>{mpn}</div>
            <div className="small muted nowrap" style={{ marginTop: 2 }}>{[t.maker, t.kind, t.description].filter(Boolean).join(' · ')}</div>
          </div>
          {onFavorite && <span className="ml-auto" style={{ cursor: 'pointer', fontSize: 15, color: favorite ? 'var(--warning)' : 'var(--text-3)' }} title="收藏" onClick={onFavorite}>{favorite ? '★' : '☆'}</span>}
          <span className={onFavorite ? '' : 'ml-auto'} style={{ cursor: 'pointer', fontSize: 16, color: 'var(--text-2)' }} onClick={close}>✕</span>
        </div>
        <div className="dialog-body col" style={{ gap: 16, overflow: 'auto' }}>
          <div className="col" style={{ gap: 6 }}>
            <div className="kicker">外观 · 本地渲染</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div className="col" style={{ gap: 4, alignItems: 'center' }}>
                <div style={{ height: 130, width: '100%', borderRadius: 4, background: 'var(--bg-canvas-sch)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{sym && sym.source !== 'missing' ? <SymbolThumb sym={sym} size={110} /> : <span className="dim xs">无符号</span>}</div>
                <span className="dim xs">原理图符号</span>
              </div>
              <div className="col" style={{ gap: 4, alignItems: 'center' }}>
                <div style={{ height: 130, width: '100%', borderRadius: 4, background: 'var(--bg-canvas)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{fp ? <FootprintThumb fp={fp} size={110} /> : <span className="dim xs">无封装</span>}</div>
                <span className="dim xs">PCB 封装</span>
              </div>
              <div className="col" style={{ gap: 4, alignItems: 'center' }}>
                <div style={{ height: 130, width: '100%', borderRadius: 4, background: 'var(--bg-canvas)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{fp ? <BodyIso fp={fp} size={120} /> : <span className="dim xs">无本体尺寸</span>}</div>
                <span className="dim xs">立体示意（按本体尺寸）</span>
              </div>
            </div>
          </div>

          <div className="col" style={{ gap: 6 }}>
            <div className="kicker">参数</div>
            <div className="kv" style={{ gridTemplateColumns: '80px minmax(0, 1fr)', gap: '6px 10px', alignItems: 'start' }}>
              {rows.map(([k, v], i) => <Fragment key={i}><span className="k">{k}</span><span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span></Fragment>)}
            </div>
          </div>

          {pins.length > 0 && (
            <div className="col" style={{ gap: 6 }}>
              <div className="kicker">引脚 · {pins.length}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 4, maxHeight: 190, overflow: 'auto' }}>
                {pins.map((p) => (
                  <div key={p.number + p.name} className="row xs" style={{ gap: 6, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-raised)' }}>
                    <span className="mono dim" style={{ minWidth: 20 }}>{p.number}</span>
                    <span className="mono nowrap grow" style={{ minWidth: 0 }}>{p.name === p.number ? '' : p.name}</span>
                    <span className="dim nowrap">{PIN_TYPE[p.type] ?? p.type}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <OfferBlock mpn={mpn} alt={altQuery} />

          <div className="col" style={{ gap: 6 }}>
            <div className="kicker">在分销商查价（新窗口）</div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {DISTRIBUTORS.map((d) => <a key={d.id} className="chip" style={{ textDecoration: 'none' }} href={d.search(d.id === 'jlcpcb' && lcsc ? lcsc : mpn)} target="_blank" rel="noreferrer" title={`${d.region} · ${d.currency}`}>{d.name} ↗</a>)}
            </div>
          </div>
        </div>
        <div className="dialog-foot">
          {onPlaceSymbol && <button className="btn primary" onClick={() => { onPlaceSymbol(); close(); }}>放到原理图</button>}
          {onPlaceFootprint && fp && <button className="btn" onClick={() => { onPlaceFootprint(); close(); }}>放到板上</button>}
          {onInventory && <button className="btn" onClick={onInventory}>+ 库存</button>}
          <button className="btn ml-auto" onClick={close}>关闭</button>
        </div>
      </div>
    </div>
  );
}
