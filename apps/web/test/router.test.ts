import { describe, it, expect } from 'vitest';
import { parseRoute, buildPath } from '../src/store/router';

describe('URL 路由', () => {
  it('解析与生成互逆', () => {
    expect(parseRoute('/')).toEqual({ projectId: null, screen: 'sch', sheetId: null });
    expect(parseRoute('/p/prj_abc/pcb')).toEqual({ projectId: 'prj_abc', screen: 'pcb', sheetId: null });
    expect(parseRoute('/p/prj_abc/sch/sheet_x')).toEqual({ projectId: 'prj_abc', screen: 'sch', sheetId: 'sheet_x' });
    expect(parseRoute('/p/prj_abc/bogus')).toEqual({ projectId: 'prj_abc', screen: 'sch', sheetId: null });
    expect(buildPath({ projectId: 'prj_abc', screen: 'fab', sheetId: null })).toBe('/p/prj_abc/fab');
    expect(buildPath({ projectId: 'prj_abc', screen: 'sch', sheetId: 'sheet_x' })).toBe('/p/prj_abc/sch/sheet_x');
    expect(buildPath({ projectId: null, screen: 'pcb', sheetId: null })).toBe('/');
  });
});
