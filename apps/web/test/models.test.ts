import { describe, it, expect } from 'vitest';
import { approximateCatalogKey, modelFor, MODEL_CATALOG } from '../src/editors/three/models.js';
import { registerProjectLibrary, type Board, type BoardFootprint } from '@tracelet/kernel';

describe('3D 模型匹配', () => {
  it('USB-C 座没有精确模型时用同系列近似（HRO → GCT_USB4085）', () => {
    expect(MODEL_CATALOG['USB_C_Receptacle_HRO_TYPE-C-31-M-12']).toBeUndefined();
    expect(approximateCatalogKey('USB_C_Receptacle_HRO_TYPE-C-31-M-12')).toBe('USB_C_Receptacle_GCT_USB4085');
    const f = { id: 'f', ref: 'J9', footprintId: 'fp:kicad:USB_C_Receptacle_HRO_TYPE-C-31-M-12', x: 0, y: 0, rotation: 0, side: 'F', padNets: {} } as BoardFootprint;
    const m = modelFor(f, { models3d: {} } as unknown as Board);
    expect(m?.source).toBe('catalog:USB_C_Receptacle_GCT_USB4085');
    expect(m?.name).toContain('近似');
  });
  it('近似模型按焊盘区中心对齐（HRO 焊盘中心 (0,-1.46) vs GCT4085 (2.975,2.43)）', () => {
    registerProjectLibrary({ symbols: [], footprints: [{ id: 'fp:kicad:USB_C_Receptacle_HRO_TYPE-C-31-M-12', name: 'HRO', body: { w: 9, h: 7 }, height: 3, description: '', pads: [{ number: '1', x: -4.32, y: -4.27, w: 1, h: 1, shape: 'rect', drill: 0, npth: false }, { number: '2', x: 4.32, y: 1.35, w: 1, h: 1, shape: 'rect', drill: 0, npth: false }] }] });
    const f = { id: 'f', ref: 'J9', footprintId: 'fp:kicad:USB_C_Receptacle_HRO_TYPE-C-31-M-12', x: 0, y: 0, rotation: 0, side: 'F', padNets: {} } as BoardFootprint;
    const m = modelFor(f, { models3d: {} } as unknown as Board)!;
    expect(m.offset[0]).toBeCloseTo(0 - 2.975, 2);
    expect(m.offset[1]).toBeCloseTo(-(-1.46 - 2.43), 2);
  });
  it('阻容 / IC 不做近似，手动指定优先', () => {
    expect(approximateCatalogKey('R_0805_2012Metric_Odd')).toBeUndefined();
    expect(approximateCatalogKey('SOIC-8_3.9x4.9mm_P1.27mm_X')).toBeUndefined();
    const f = { id: 'f', ref: 'J9', footprintId: 'fp:kicad:USB_C_Receptacle_HRO_TYPE-C-31-M-12', x: 0, y: 0, rotation: 0, side: 'F', padNets: {} } as BoardFootprint;
    const m = modelFor(f, { models3d: { 'fp:kicad:USB_C_Receptacle_HRO_TYPE-C-31-M-12': { name: 'mine', source: 'data:model/gltf-binary;base64,AA==', scale: 1000, offset: [0, 0, 0], rotation: [0, 0, 0] } } } as unknown as Board);
    expect(m?.name).toBe('mine');
  });
});
