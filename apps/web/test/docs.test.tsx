import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Docs } from '../src/screens/Docs';
import { usePrefs } from '../src/i18n';

afterEach(cleanup);
describe('public documentation', () => {
  it('searches body content and preserves navigation targets', () => {
    usePrefs.getState().setLocale('en');
    render(<Docs />);
    fireEvent.change(screen.getByLabelText('Search documentation'), { target: { value: 'CORS_ORIGINS' } });
    const nav = screen.getByRole('navigation', { name: 'Documentation contents' });
    expect(within(nav).getAllByRole('link')).toHaveLength(1);
    expect(within(nav).getByRole('link', { name: 'Self-hosting' }).getAttribute('href')).toBe('#deploy');
    expect(document.getElementById('deploy')).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Search documentation'), { target: { value: 'nonexistent-doc-topic' } });
    expect(screen.getByRole('status').textContent).toContain('No matching chapters');
  });
  it('switches content language and explains clickable editor regions', () => {
    usePrefs.getState().setLocale('en');
    render(<Docs />);
    fireEvent.click(screen.getByRole('button', { name: 'Properties and sync' }));
    expect(screen.getByRole('button', { name: 'Properties and sync' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Inspect the selected object and update/)).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Content language'), { target: { value: 'zh-CN' } });
    expect(screen.getByRole('heading', { name: '把想法，做成电路。' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '属性与同步' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/查看选中对象的参数；原理图完成/)).not.toBeNull();
  });
});
