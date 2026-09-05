/** 零件目录：一条记录同时绑定符号、封装、供应商信息。 */
export interface Part {
  id: string;
  mpn: string;
  maker: string;
  kind: string;
  /** 分类 id，对应 assets/component-icons/manifest.json */
  category: string;
  description: string;
  symbolId: string;
  footprintId: string;
  value: string;
  params: string;
  pinCount: number;
  lcsc?: string;
  price?: string;
  stock?: '有货' | '缺货';
  datasheet?: string;
  has3d: boolean;
  keywords: string[];
}

export const BUILTIN_PARTS: Part[] = [
  { id: 'part:esp32-wroom-32e', category: 'communication-module', mpn: 'ESP32-WROOM-32E', maker: 'Espressif', kind: '模块', description: 'Wi-Fi + BLE 模块，4MB Flash', symbolId: 'sym:ESP32-WROOM-32E', footprintId: 'fp:ESP32-WROOM-32E', value: 'ESP32-WROOM-32E', params: 'Flash 4MB · WiFi/BLE · 3.3V · 38 引脚', pinCount: 38, lcsc: 'C701341', price: '¥12.50', stock: '有货', datasheet: 'esp32-wroom-32e_datasheet.pdf', has3d: true, keywords: ['esp32', 'wifi', 'ble', 'espressif', '模块'] },
  { id: 'part:esp32-c3-mini-1', category: 'communication-module', mpn: 'ESP32-C3-MINI-1', maker: 'Espressif', kind: '模块', description: 'RISC-V Wi-Fi + BLE 5 模块', symbolId: 'sym:ESP32-C3-MINI-1', footprintId: 'fp:ESP32-C3-MINI-1', value: 'ESP32-C3-MINI-1', params: 'Flash 4MB · WiFi/BLE5 · 3.3V · 53 引脚', pinCount: 53, lcsc: 'C2838500', price: '¥9.80', stock: '有货', datasheet: 'esp32-c3-mini-1_datasheet.pdf', has3d: true, keywords: ['esp32', 'c3', 'wifi', 'ble', 'espressif', '模块'] },
  { id: 'part:esp32-s3-wroom-1', category: 'communication-module', mpn: 'ESP32-S3-WROOM-1-N8', maker: 'Espressif', kind: '模块', description: 'Wi-Fi + BLE 5，8MB Flash，AI 加速', symbolId: 'sym:ESP32-WROOM-32E', footprintId: 'fp:ESP32-WROOM-32E', value: 'ESP32-S3-WROOM-1-N8', params: 'Flash 8MB · WiFi/BLE5 · 3.3V · 41 引脚', pinCount: 41, lcsc: 'C2913202', price: '¥18.20', stock: '有货', datasheet: 'esp32-s3-wroom-1_datasheet.pdf', has3d: true, keywords: ['esp32', 's3', 'wifi', 'espressif', '模块'] },
  { id: 'part:ams1117-3.3', category: 'power-management', mpn: 'AMS1117-3.3', maker: 'AMS', kind: 'LDO', description: '3.3V 1A 线性稳压器', symbolId: 'sym:AMS1117-3.3', footprintId: 'fp:SOT-223', value: 'AMS1117-3.3', params: '3.3V · 1A · SOT-223', pinCount: 4, lcsc: 'C6186', price: '¥0.45', stock: '有货', has3d: true, keywords: ['ldo', '稳压', '3.3v', 'ams1117'] },
  { id: 'part:usb-c-16p', category: 'connector', mpn: 'TYPE-C-16PIN', maker: 'HRO', kind: '连接器', description: 'USB Type-C 16P 母座', symbolId: 'sym:USB-C-16P', footprintId: 'fp:USB-C-16P', value: 'USB-C 16P', params: '16 引脚 · 贴片 · 带定位柱', pinCount: 16, lcsc: 'C165948', price: '¥0.68', stock: '有货', has3d: true, keywords: ['usb', 'type-c', 'usb-c', '连接器', '母座'] },
  { id: 'part:r-10k-0402', category: 'resistor', mpn: '0402WGF1002TCE', maker: 'UNI-ROYAL', kind: '电阻', description: '10kΩ ±1% 0402', symbolId: 'sym:R', footprintId: 'fp:R_0402', value: '10kΩ', params: '10kΩ · 1% · 1/16W', pinCount: 2, lcsc: 'C25744', price: '¥0.01', stock: '有货', has3d: true, keywords: ['电阻', 'resistor', '10k', '0402'] },
  { id: 'part:r-330-0402', category: 'resistor', mpn: '0402WGF3300TCE', maker: 'UNI-ROYAL', kind: '电阻', description: '330Ω ±1% 0402', symbolId: 'sym:R', footprintId: 'fp:R_0402', value: '330Ω', params: '330Ω · 1% · 1/16W', pinCount: 2, lcsc: 'C25104', price: '¥0.01', stock: '有货', has3d: true, keywords: ['电阻', 'resistor', '330', '0402', 'led 限流'] },
  { id: 'part:c-100n-0402', category: 'capacitor', mpn: 'CL05B104KO5NNNC', maker: 'Samsung', kind: '电容', description: '100nF 16V X7R 0402', symbolId: 'sym:C', footprintId: 'fp:C_0402', value: '100nF', params: '100nF · 16V · X7R', pinCount: 2, lcsc: 'C1525', price: '¥0.01', stock: '有货', has3d: true, keywords: ['电容', 'capacitor', '100nf', '0.1uf', '0402', '去耦'] },
  { id: 'part:c-10u-0603', category: 'capacitor', mpn: 'CL10A106KP8NNNC', maker: 'Samsung', kind: '电容', description: '10uF 10V X5R 0603', symbolId: 'sym:C', footprintId: 'fp:C_0603', value: '10uF', params: '10uF · 10V · X5R', pinCount: 2, lcsc: 'C19702', price: '¥0.03', stock: '有货', has3d: true, keywords: ['电容', 'capacitor', '10uf', '0603'] },
  { id: 'part:led-red-0603', category: 'optoelectronics', mpn: 'KT-0603R', maker: 'Hubei KENTO', kind: 'LED', description: '红色 0603 LED', symbolId: 'sym:LED', footprintId: 'fp:LED_0603', value: '红 0603', params: '红 · 620nm · 20mA', pinCount: 2, lcsc: 'C2286', price: '¥0.02', stock: '有货', has3d: true, keywords: ['led', '发光二极管', '红', '0603'] },
  { id: 'part:mounting-hole-m3', category: 'mechanical', mpn: 'MountingHole_M3', maker: '—', kind: '机械', description: 'M3 定位孔 3.2mm（非金属化）', symbolId: 'sym:MountingHole', footprintId: 'fp:MountingHole_3.2mm', value: 'M3', params: '3.2mm · NPTH', pinCount: 0, has3d: false, keywords: ['定位孔', 'mounting', 'hole', 'm3', '螺丝'] },
  { id: 'part:mounting-hole-m2', category: 'mechanical', mpn: 'MountingHole_M2', maker: '—', kind: '机械', description: 'M2 定位孔 2.2mm（非金属化）', symbolId: 'sym:MountingHole', footprintId: 'fp:MountingHole_2.2mm', value: 'M2', params: '2.2mm · NPTH', pinCount: 0, has3d: false, keywords: ['定位孔', 'mounting', 'hole', 'm2'] }
];

/** 元件分类（与 assets/component-icons/manifest.json 对齐，仅列出内置库用到的 + 常用分组）。 */
export const PART_CATEGORIES: { id: string; name: string; group: string }[] = [
  { id: 'resistor', name: '电阻', group: '无源器件' }, { id: 'capacitor', name: '电容', group: '无源器件' }, { id: 'inductor', name: '电感', group: '无源器件' },
  { id: 'microcontroller', name: '微控制器', group: '集成电路' }, { id: 'logic', name: '逻辑器件', group: '集成电路' }, { id: 'memory', name: '存储器', group: '集成电路' }, { id: 'interface-ic', name: '接口芯片', group: '集成电路' }, { id: 'amplifier', name: '放大器', group: '集成电路' }, { id: 'data-converter', name: '数据转换', group: '集成电路' }, { id: 'clock-timing', name: '时钟', group: '集成电路' },
  { id: 'diode', name: '二极管', group: '半导体' }, { id: 'transistor', name: '晶体管', group: '半导体' },
  { id: 'power-management', name: '电源管理', group: '电源与保护' }, { id: 'circuit-protection', name: '电路保护', group: '电源与保护' }, { id: 'fuse', name: '保险丝', group: '电源与保护' }, { id: 'battery', name: '电池', group: '电源与保护' },
  { id: 'connector', name: '连接器', group: '机电与连接' }, { id: 'terminal', name: '端子', group: '机电与连接' }, { id: 'switch', name: '开关', group: '机电与连接' }, { id: 'relay', name: '继电器', group: '机电与连接' }, { id: 'mechanical', name: '机械件', group: '机电与连接' },
  { id: 'optoelectronics', name: '光电器件', group: '光电与显示' }, { id: 'display', name: '显示', group: '光电与显示' },
  { id: 'communication-module', name: '通信模块', group: '模块与开发' }, { id: 'functional-module', name: '功能模块', group: '模块与开发' }, { id: 'development-board', name: '开发板', group: '模块与开发' },
  { id: 'rf-wireless', name: '射频无线', group: '通信' }, { id: 'antenna', name: '天线', group: '通信' },
  { id: 'crystal', name: '晶振', group: '无源器件' }, { id: 'sensor', name: '传感器', group: '模块与开发' }
];

/** 简单的关键字搜索：匹配 MPN、厂商、描述、参数、关键词。 */
export function searchParts(query: string, parts: Part[] = BUILTIN_PARTS, category?: string): Part[] {
  if (category) parts = parts.filter((p) => p.category === category);
  const q = query.trim().toLowerCase();
  if (!q) return parts;
  const terms = q.split(/\s+/);
  return parts
    .map((p) => {
      const hay = [p.mpn, p.maker, p.description, p.params, p.kind, ...p.keywords].join(' ').toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (!hay.includes(t)) return null;
        score += p.mpn.toLowerCase().startsWith(t) ? 3 : p.mpn.toLowerCase().includes(t) ? 2 : 1;
      }
      return { p, score };
    })
    .filter((x): x is { p: Part; score: number } => !!x)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.p);
}

export function findPart(id: string): Part | undefined { return BUILTIN_PARTS.find((p) => p.id === id); }
