import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MoreMenu } from '../src/components/MoreMenu';
import { usePartPricing, DEFAULT_PRICING_URL } from '../src/store/partPricing';
import { usePrefs } from '../src/i18n';

const open = () => fireEvent.click(screen.getByTitle('设置'));

beforeEach(() => { localStorage.clear(); usePrefs.getState().setLocale('zh-CN'); usePartPricing.setState({ enabled: false, url: DEFAULT_PRICING_URL, cache: {}, busy: [] }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('左侧「⋯」设置弹层', () => {
  it('默认收起，点开后能开关在线查价', () => {
    render(<MoreMenu />);
    expect(screen.queryByText(/元件报价/)).toBeNull();
    open();
    fireEvent.click(screen.getByText('在线查价已关闭'));
    expect(usePartPricing.getState().enabled).toBe(true);
    expect(screen.getByText('在线查价已开启')).toBeTruthy();
  });

  it('数据源可改、可恢复默认，并写入 localStorage', () => {
    render(<MoreMenu />);
    open();
    const input = screen.getByPlaceholderText(DEFAULT_PRICING_URL) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  https://parts.example.com  ' } });
    fireEvent.blur(input);
    expect(usePartPricing.getState().url).toBe('https://parts.example.com');
    expect(JSON.parse(localStorage.getItem('tracelet:pricing:cfg')!).url).toBe('https://parts.example.com');
    fireEvent.click(screen.getByText('恢复默认'));
    expect(usePartPricing.getState().url).toBe(DEFAULT_PRICING_URL);
    // 清空后回落到默认值，不会写成空串
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(usePartPricing.getState().url).toBe(DEFAULT_PRICING_URL);
  });

  it('测试连接打到当前数据源，并按返回内容判断成败', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ components: [{ lcsc: 1 }] }) });
    vi.stubGlobal('fetch', fetchMock);
    render(<MoreMenu />);
    open();
    const input = screen.getByPlaceholderText(DEFAULT_PRICING_URL) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://parts.example.com/' } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByText('测试连接'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe('https://parts.example.com/components/list.json?search=10k%200603&limit=1&full=true');
  });

  it('缓存条数可见并可清空', () => {
    usePartPricing.setState({ cache: { a: { offer: null, at: Date.now() }, b: { offer: null, at: Date.now() } } });
    render(<MoreMenu />);
    open();
    fireEvent.click(screen.getByText(/缓存 2 条/));
    expect(Object.keys(usePartPricing.getState().cache)).toHaveLength(0);
  });

  it('英文界面下文案完整翻译，不留中文', async () => {
    usePrefs.getState().setLocale('en');
    render(<MoreMenu />);
    await waitFor(() => expect(screen.getByTitle('Settings')).toBeTruthy());
    fireEvent.click(screen.getByTitle('Settings'));
    await waitFor(() => expect(screen.getByText('Online pricing off')).toBeTruthy());
    fireEvent.click(screen.getByText('Endpoint contract ▾'));
    await waitFor(() => expect(document.querySelector('.menu')!.textContent).not.toMatch(/[一-鿿]/));
  });
});
