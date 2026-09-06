import { describe, it, expect } from 'vitest';
import { approximateCatalogKey, modelFor, MODEL_CATALOG } from '../src/editors/three/models.js';
import type { Board, BoardFootprint } from '@tracelet/kernel';

describe('3D 模型匹配', () => {
  it('USB-C 座没有精确模型时用同系列近似（HRO → GCT_USB4085）', () => {
    expect(MODEL_CATALOG['USB_C_Receptacle_HRO_TYPE-C-31-M-12']).toBeUndefined();
    expect(approximateCatalogKey('USB_C_Receptacle_HRO_TYPE-C-31-M-12')).toBe('USB_C_Receptacle_GCT_USB4085');
    const f = { id: 'f', ref: 'J9', footprintId: 'fp:kicad:USB_C_Receptacle_HRO_TYPE-C-31-M-12', x: 0, y: 0, rotation: 0, side: 'F', padNets: {} } as BoardFootprint;
    const m = modelFor(f, { models3d: {} } as unknown as Board);
    expect(m?.source).toBe('catalog:USB_C_Receptacle_GCT_USB4085');
    expect(m?.name).toContain('近似');
  });
  it('阻容 / IC 不做近似，手动指定优先', () => {
    expect(approximateCatalogKey('R_0805_2012Metric_Odd')).toBeUndefined();
    expect(approximateCatalogKey('SOIC-8_3.9x4.9mm_P1.27mm_X')).toBeUndefined();
    const f = { id: 'f', ref: 'J9', footprintId: 'fp:kicad:USB_C_Receptacle_HRO_TYPE-C-31-M-12', x: 0, y: 0, rotation: 0, side: 'F', padNets: {} } as BoardFootprint;
    const m = modelFor(f, { models3d: { 'fp:kicad:USB_C_Receptacle_HRO_TYPE-C-31-M-12': { name: 'mine', source: 'data:model/gltf-binary;base64,AA==', scale: 1000, offset: [0, 0, 0], rotation: [0, 0, 0] } } } as unknown as Board);
    expect(m?.name).toBe('mine');
  });
});
