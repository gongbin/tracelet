import { z } from 'zod';
import { VecSchema } from './schematic.js';

export const CopperLayerSchema = z.enum(['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu']);
export type CopperLayer = z.infer<typeof CopperLayerSchema>;
export const LayerSchema = z.enum(['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu', 'F.Silk', 'B.Silk', 'F.Mask', 'B.Mask', 'Edge.Cuts']);
export type Layer = z.infer<typeof LayerSchema>;

export const LAYER_COLORS: Record<Layer, string> = {
  'F.Cu': '#C83434', 'In1.Cu': '#E08A2E', 'In2.Cu': '#3FA34D', 'B.Cu': '#4D7FC4',
  'F.Silk': '#F2F2F2', 'B.Silk': '#E8D0A9', 'F.Mask': '#B06CD9', 'B.Mask': '#4FC3D9', 'Edge.Cuts': '#D0D2D6'
};

export function copperLayers(count: 2 | 4): CopperLayer[] {
  return count === 4 ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'] : ['F.Cu', 'B.Cu'];
}

/** 封装定义中的焊盘（相对封装原点，单位 mm）。 */
export const PadDefSchema = z.object({
  number: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  shape: z.enum(['rect', 'roundrect', 'circle', 'oval']).default('rect'),
  /** 通孔焊盘钻孔直径；0 表示贴片。 */
  drill: z.number().default(0),
  /** 非金属化孔（定位孔） */
  npth: z.boolean().default(false)
});
export type PadDef = z.infer<typeof PadDefSchema>;

export const FootprintDefSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** 本体 / courtyard 尺寸（mm，居中于原点） */
  body: z.object({ w: z.number(), h: z.number() }),
  pads: z.array(PadDefSchema),
  /** 元件高度（mm），用于 3D 占位 */
  height: z.number().default(1),
  description: z.string().default('')
});
export type FootprintDef = z.infer<typeof FootprintDefSchema>;

export const BoardFootprintSchema = z.object({
  id: z.string(),
  ref: z.string(),
  /** 关联的原理图元件 id */
  componentId: z.string().optional(),
  footprintId: z.string(),
  value: z.string().default(''),
  x: z.number(),
  y: z.number(),
  rotation: z.number().default(0),
  side: z.enum(['F', 'B']).default('F'),
  /** 焊盘号 -> 网络名 */
  padNets: z.record(z.string()).default({})
});
export type BoardFootprint = z.infer<typeof BoardFootprintSchema>;

export const TraceSchema = z.object({
  id: z.string(),
  layer: CopperLayerSchema,
  points: z.array(VecSchema).min(2),
  width: z.number(),
  net: z.string().default('')
});
export type Trace = z.infer<typeof TraceSchema>;

export const ViaSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  size: z.number(),
  drill: z.number(),
  net: z.string().default('')
});
export type Via = z.infer<typeof ViaSchema>;

export const ZoneSchema = z.object({
  id: z.string(),
  layer: CopperLayerSchema,
  net: z.string().default(''),
  polygon: z.array(VecSchema).min(3),
  /** 同网络焊盘连接方式：热焊盘（辐条）或实心 */
  thermal: z.enum(['relief', 'solid']).default('relief'),
  thermalGap: z.number().default(0.3),
  spokeWidth: z.number().default(0.4),
  /** 与异网络铜的间距（0 = 用规则集 / 网络类） */
  clearance: z.number().default(0)
});
export type Zone = z.infer<typeof ZoneSchema>;

export const BoardTextSchema = z.object({
  id: z.string(),
  layer: z.enum(['F.Silk', 'B.Silk']),
  text: z.string(),
  x: z.number(),
  y: z.number(),
  size: z.number().default(1)
});
export type BoardText = z.infer<typeof BoardTextSchema>;

export const NetClassSchema = z.object({
  name: z.string(),
  traceWidth: z.number(),
  viaSize: z.number(),
  viaDrill: z.number(),
  clearance: z.number(),
  nets: z.array(z.string()).default([])
});
export type NetClass = z.infer<typeof NetClassSchema>;

export const BoardSchema = z.object({
  copperCount: z.union([z.literal(2), z.literal(4)]).default(2),
  thickness: z.number().default(1.6),
  outline: z.array(VecSchema),
  footprints: z.array(BoardFootprintSchema),
  traces: z.array(TraceSchema),
  vias: z.array(ViaSchema),
  zones: z.array(ZoneSchema),
  texts: z.array(BoardTextSchema),
  netClasses: z.array(NetClassSchema),
  hiddenLayers: z.array(LayerSchema).default(['F.Mask', 'B.Mask'])
});
export type Board = z.infer<typeof BoardSchema>;

export function emptyBoard(): Board {
  return {
    copperCount: 2,
    thickness: 1.6,
    outline: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 30 }, { x: 0, y: 30 }],
    footprints: [], traces: [], vias: [], zones: [], texts: [],
    netClasses: [
      { name: 'Default', traceWidth: 0.25, viaSize: 0.6, viaDrill: 0.3, clearance: 0.2, nets: [] },
      { name: 'Power', traceWidth: 0.5, viaSize: 0.8, viaDrill: 0.4, clearance: 0.2, nets: ['+3V3', '+5V', 'VCC', 'GND'] }
    ],
    hiddenLayers: ['F.Mask', 'B.Mask']
  };
}
