import { z } from 'zod';
import { VecSchema } from './schematic.js';

export const CopperLayerSchema = z.enum(['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'B.Cu']);
export type CopperLayer = z.infer<typeof CopperLayerSchema>;
export const LayerSchema = z.enum(['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'B.Cu', 'F.Silk', 'B.Silk', 'F.Mask', 'B.Mask', 'Edge.Cuts']);
export type Layer = z.infer<typeof LayerSchema>;

export const LAYER_COLORS: Record<Layer, string> = {
  'F.Cu': '#C83434', 'In1.Cu': '#E08A2E', 'In2.Cu': '#3FA34D', 'In3.Cu': '#B36AD6', 'In4.Cu': '#35B5B0', 'B.Cu': '#4D7FC4',
  'F.Silk': '#F2F2F2', 'B.Silk': '#E8D0A9', 'F.Mask': '#B06CD9', 'B.Mask': '#4FC3D9', 'Edge.Cuts': '#D0D2D6'
};

export function copperLayers(count: 2 | 4 | 6): CopperLayer[] {
  return count === 6 ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'In3.Cu', 'In4.Cu', 'B.Cu'] : count === 4 ? ['F.Cu', 'In1.Cu', 'In2.Cu', 'B.Cu'] : ['F.Cu', 'B.Cu'];
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
  /** 本体外框（mm）；x/y 为外框中心相对封装原点的偏移（KiCad 连接器原点常在 1 脚，不在本体中心） */
  body: z.object({ w: z.number(), h: z.number(), x: z.number().optional(), y: z.number().optional() }),
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
  /** Fixed placement imported from CAD or set by the user. */
  locked: z.boolean().optional(),
  /** User-authored placement intent; optional for older projects. */
  placement: z.object({
    role: z.enum(['auto', 'ic', 'decoupling', 'passive', 'connector', 'mechanical']).optional(),
    fixed: z.boolean().optional(),
    group: z.string().optional(),
    target: z.object({ footprintId: z.string(), pad: z.string(), maxDistance: z.number().positive().default(3) }).optional(),
    edge: z.object({
      index: z.number().int().nonnegative(),
      /** Mating direction in footprint-local degrees, before bottom-side mirroring. */
      direction: z.number().finite().default(0),
      distance: z.number().nonnegative().default(2)
    }).optional()
  }).optional(),
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
  startLayer: CopperLayerSchema.optional(),
  endLayer: CopperLayerSchema.optional(),
  backdrill: z.object({ side: z.enum(['F', 'B']), stopLayer: CopperLayerSchema, diameter: z.number().positive().finite(), stub: z.number().nonnegative().finite() }).optional(),
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
  nets: z.array(z.string()).default([]),
  allowedLayers: z.array(CopperLayerSchema).min(1).optional(),
  /** Total planar copper length, including branches; not propagation delay. */
  maxLength: z.number().positive().optional(),
  referenceLayer: CopperLayerSchema.optional(),
  referenceNet: z.string().optional(),
  /** Engineering recommendations, not fabrication clearance or SI certification. */
  engineering: z.object({
    preferredClearance: z.number().finite().positive().optional(),
    maxParallelLength: z.number().finite().positive().optional(),
    referenceMargin: z.number().finite().nonnegative().optional(),
    returnViaDistance: z.number().finite().positive().optional(),
  }).optional(),
  /** Per-net, lumped DC conductor model. Thermal resistance must be supplied, never inferred. */
  power: z.object({
    currentA: z.number().finite().nonnegative(),
    copperThicknessMm: z.number().finite().positive(),
    ambientC: z.number().finite().min(-50).max(200),
    thermalResistanceKPerW: z.number().finite().positive().optional(),
    maxRiseC: z.number().finite().positive().optional(),
    maxDropV: z.number().finite().positive().optional(),
  }).optional(),
  neckdown: z.object({ allowed: z.boolean(), minWidth: z.number().positive(), maxLength: z.number().nonnegative() }).optional()

});
export type NetClass = z.infer<typeof NetClassSchema>;

export const Model3dSchema = z.object({
  name: z.string(),
  source: z.string().refine(s => s.startsWith('catalog:') || /^data:model\/gltf-binary;base64,[A-Za-z0-9+/=]+$/.test(s), 'Expected catalog model or embedded GLB'),
  scale: z.number().positive().finite().default(1000),
  offset: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0])
});
export type Model3d = z.infer<typeof Model3dSchema>;

/** 板叠层 / 工艺参数（用于制造说明、3D 外观与 README）。 */
export const StackupSchema = z.object({
  material: z.string().default('FR-4'),
  /** Confirmed copper-layer depths from top surface, mm, in copperLayers order. */
  copperDepths: z.array(z.number().nonnegative().finite()).optional(),
  impedanceProfiles: z.array(z.object({ kind: z.enum(['microstrip', 'stripline']), width: z.number().positive(), height: z.number().positive(), thickness: z.number().positive(), er: z.number().min(1), target: z.number().positive() })).optional(),
  /** 外层铜厚（oz） */
  copperWeight: z.number().default(1),
  /** 内层铜厚（oz），4 层时有效 */
  innerCopperWeight: z.number().default(0.5),
  finish: z.enum(['HASL', 'LeadFreeHASL', 'ENIG', 'OSP']).default('HASL'),
  maskColor: z.enum(['绿', '黑', '白', '蓝', '红', '黄', '紫']).default('绿'),
  silkColor: z.enum(['白', '黑', '黄']).default('白'),
  /** 阻抗控制需求（仅记录，导出到 README） */
  impedance: z.boolean().default(false),
  /** 过孔盖油 */
  viaTenting: z.boolean().default(true)
});
export type Stackup = z.infer<typeof StackupSchema>;
export const DEFAULT_STACKUP: Stackup = { material: 'FR-4', copperWeight: 1, innerCopperWeight: 0.5, finish: 'HASL', maskColor: '绿', silkColor: '白', impedance: false, viaTenting: true };

export const BoardSchema = z.object({
  stackup: StackupSchema.optional(),
  /** Optional per-footprint-library model overrides, included in project backups. */
  models3d: z.record(Model3dSchema).optional(),
  copperCount: z.union([z.literal(2), z.literal(4), z.literal(6)]).default(2),
  thickness: z.number().default(1.6),
  outline: z.array(VecSchema),
  /** 矩形板框的圆角半径（mm）；outline 里已经是展开后的圆角折线，此值用于改长宽时保持圆角 */
  outlineRadius: z.number().optional(),
  footprints: z.array(BoardFootprintSchema),
  traces: z.array(TraceSchema),
  vias: z.array(ViaSchema),
  zones: z.array(ZoneSchema),
  texts: z.array(BoardTextSchema),
  netClasses: z.array(NetClassSchema),
  differentialPairs: z.array(z.object({
    positive: z.string().min(1), negative: z.string().min(1),
    maxSkew: z.number().nonnegative(), gap: z.number().positive(), tolerance: z.number().nonnegative()
  })).optional(),
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
