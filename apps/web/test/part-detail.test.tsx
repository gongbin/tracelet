import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { allParts } from '@tracelet/kernel';
import { PartDetail } from '../src/components/PartDetail';
import { usePartPricing, pickRow, rowToOffer } from '../src/store/partPricing';
import { usePrefs } from '../src/i18n';

const part = allParts().find((p) => p.value === '10kΩ' && p.footprintId.includes('0603'))!;
const target = { name: part.mpn, mpn: part.mpn, maker: part.maker, kind: part.kind, category: part.category, description: part.description, value: part.value, params: part.params, symbolId: part.symbolId, footprintId: part.footprintId, lcsc: part.lcsc, part };

beforeEach(() => { localStorage.clear(); usePrefs.getState().setLocale('zh-CN'); usePartPricing.setState({ enabled: false, cache: {}, busy: [] }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('报价数据处理', () => {
  it('候选里挑型号完全一致的一条，其次前缀，最后按库存', () => {
    const rows = [{ mfr: 'STM32G030F6P6TR', stock: 10 }, { mfr: 'STM32G030F6P6', stock: 5 }];
    expect(pickRow(rows, 'STM32G030F6P6')!.mfr).toBe('STM32G030F6P6');
    expect(pickRow([{ mfr: 'FRC0603F1002TS', stock: 1 }, { mfr: 'FRC0603F1002TS-X', stock: 9 }], 'FRC0603F1002')!.stock).toBe(9);
    expect(pickRow([], 'X')).toBeUndefined();
  });
  it('转成统一报价结构：阶梯价、库存、LCSC 链接与库标记', () => {
    const offer = rowToOffer({ lcsc: 529330, mfr: 'X', stock: 42, price: '1-9:0.8,10-:0.6', is_basic: true }, 1000);
    expect(offer).toMatchObject({ vendor: 'lcsc', sku: 'C529330', currency: 'USD', stock: 42, note: 'JLC 基础库', fetchedAt: 1000 });
    expect(offer.tiers).toHaveLength(2);
    expect(offer.url).toBe('https://www.lcsc.com/product-detail/C529330.html');
  });
});

describe('元件详情页', () => {
  it('展示参数、引脚与分销商链接，外观全部本地渲染（无外部图片）', () => {
    const { container } = render(<PartDetail target={target} close={() => {}} />);
    expect(screen.getAllByText(part.mpn).length).toBeGreaterThan(0);
    expect(screen.getByText('外观 · 本地渲染')).toBeTruthy();
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(/引脚 · 2/)).toBeTruthy();
    const links = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(links.some((h) => h.includes('lcsc.com'))).toBe(true);
    expect(links.some((h) => h.includes('digikey.com'))).toBe(true);
    expect(links.every((h) => h.startsWith('https://'))).toBe(true);
  });

  it('在线查价默认关闭，不发任何请求；开启后显示阶梯价与库存', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ components: [{ lcsc: 25804, mfr: part.mpn, stock: 12345, price: '1-99:0.0038,100-:0.0029', is_basic: true }] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<PartDetail target={target} close={() => {}} />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('开启在线查价'));
    await waitFor(() => expect(screen.getByText('C25804')).toBeTruthy());
    expect(fetchMock.mock.calls[0][0]).toContain('/components/list.json?');
    expect(screen.getByText(/库存 12,345/)).toBeTruthy();
    expect(screen.getByText('$0.0038')).toBeTruthy();
    expect(screen.getByText('JLC 基础库')).toBeTruthy();
  });

  it('原型号不在 JLC 装配库时，按「值 + 封装」给出同类可选', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({ ok: true, json: async () => ({ components: url.includes('search=10k') ? [{ lcsc: 2906982, mfr: 'FRC0603F1002TS', package: '0603', description: '10kΩ ±1% 0603', stock: 1000, price: '1-999:0.0038,1000-:0.0033' }] : [] }) }));
    vi.stubGlobal('fetch', fetchMock);
    usePartPricing.setState({ enabled: true });
    render(<PartDetail target={target} close={() => {}} />);
    await waitFor(() => expect(screen.getByText('FRC0603F1002TS')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain(`search=${encodeURIComponent(part.mpn)}`);
    expect(fetchMock.mock.calls[1][0]).toContain('search=10k+0603');
    expect(screen.getByText(/JLC 装配库里没有这个型号/)).toBeTruthy();
    expect(screen.getByText('$0.0038')).toBeTruthy();
  });

  it('查询失败时只提示失败，不影响其余内容', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    usePartPricing.setState({ enabled: true });
    render(<PartDetail target={target} close={() => {}} />);
    await waitFor(() => expect(screen.getByText(/查询失败：HTTP 503/)).toBeTruthy());
    expect(screen.getAllByText('参数').length).toBeGreaterThan(0);
  });

  it('英文界面下详情页文案完整翻译，不留中文', async () => {
    usePrefs.getState().setLocale('en');
    render(<PartDetail target={target} close={() => {}} />);
    await waitFor(() => expect(screen.getByText('Appearance · rendered locally')).toBeTruthy());
    expect(screen.getByText('Enable online pricing')).toBeTruthy();
    expect(screen.getByText('Check price at distributors (new window)')).toBeTruthy();
    expect(document.querySelector('.dialog')!.textContent).not.toMatch(/[一-鿿]/);
  });

  it('缓存在有效期内不重复请求', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ components: [{ lcsc: 1, mfr: part.mpn, stock: 1, price: '1-:0.5' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    usePartPricing.setState({ enabled: true });
    render(<PartDetail target={target} close={() => {}} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    cleanup();
    render(<PartDetail target={target} close={() => {}} />);
    await waitFor(() => expect(screen.getByText('C1')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
