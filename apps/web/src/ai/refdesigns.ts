/**
 * 参考设计：常用厂商开发板 / 模块的官方原理图 PDF 目录 + 联网搜索（模型 web_search 工具）。
 */
import type Anthropic from '@anthropic-ai/sdk';
import { createClient, describeError } from './client.js';
import type { AiConfig } from './config.js';

export interface RefDesign { title: string; vendor: string; url: string; note?: string; source: 'catalog' | 'search' }

/** 精选目录（官方 PDF 直链，2026-09 逐条核对过；厂商改链接时请用联网搜索或手动下载后上传）。 */
export const REF_CATALOG: RefDesign[] = [
  { title: 'ESP32-S3-DevKitC-1 v1.1 原理图', vendor: 'Espressif', url: 'https://dl.espressif.com/dl/schematics/SCH_ESP32-S3-DevKitC-1_V1.1_20221130.pdf', source: 'catalog' },
  { title: 'ESP32-C3-DevKitC-02 原理图', vendor: 'Espressif', url: 'https://dl.espressif.com/dl/schematics/SCH_ESP32-C3-DEVKITC-02_V1_1_20210126A.pdf', source: 'catalog' },
  { title: 'ESP32-DevKitC v4 原理图', vendor: 'Espressif', url: 'https://dl.espressif.com/dl/schematics/esp32_devkitc_v4-sch.pdf', source: 'catalog' },
  { title: 'ESP32-C3-DevKitM-1 原理图', vendor: 'Espressif', url: 'https://dl.espressif.com/dl/schematics/SCH_ESP32-C3-DEVKITM-1_V1_20200915A.pdf', source: 'catalog' },
  { title: 'ESP32-C6-DevKitC-1 原理图', vendor: 'Espressif', url: 'https://dl.espressif.com/dl/schematics/esp32-c6-devkitc-1-schematics_v1.2.pdf', source: 'catalog' },
  { title: 'Raspberry Pi Pico 原理图（数据手册附录）', vendor: 'Raspberry Pi', url: 'https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf', note: '附录 B 为原理图', source: 'catalog' },
  { title: 'RP2040 最小系统设计（Hardware design with RP2040）', vendor: 'Raspberry Pi', url: 'https://datasheets.raspberrypi.com/rp2040/hardware-design-with-rp2040.pdf', source: 'catalog' },
  { title: 'Arduino UNO R3 原理图', vendor: 'Arduino', url: 'https://www.arduino.cc/en/uploads/Main/Arduino_Uno_Rev3-schematic.pdf', source: 'catalog' },
  { title: 'STM32 Nucleo-64 (MB1136) 原理图', vendor: 'ST', url: 'https://www.st.com/resource/en/schematic_pack/mb1136-default-c04_schematic.pdf', source: 'catalog' },
  { title: 'CH340C USB 转串口参考电路（数据手册）', vendor: 'WCH', url: 'https://www.wch-ic.com/downloads/CH340DS1_PDF.html', note: '需在页面中下载 PDF', source: 'catalog' }
];

export function searchCatalog(q: string): RefDesign[] {
  const t = q.trim().toLowerCase();
  if (!t) return REF_CATALOG;
  return REF_CATALOG.filter((r) => `${r.title} ${r.vendor} ${r.url}`.toLowerCase().includes(t));
}

/** 联网搜索厂商参考设计 / 开发板原理图 PDF。 */
export async function searchReferenceDesigns(cfg: AiConfig, query: string): Promise<RefDesign[]> {
  const client = createClient(cfg);
  try {
    // 流式：联网搜索 + 长输出时非流式请求可能被 SDK 以“可能超过 10 分钟”拒绝
    const response = await client.messages.stream({
      model: cfg.model,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
      messages: [{ role: 'user', content: `请搜索「${query}」的官方参考设计 / 开发板 / 模块原理图 PDF（优先芯片或模块厂商官网、其次知名开源硬件项目）。找到后只输出一个 JSON 数组，不要其他文字，每项：{"title":"","vendor":"","url":"直接指向 PDF 的链接","note":"可选说明"}。最多 8 条，url 必须是 http(s) 链接。` }]
    }).finalMessage();
    const text = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n');
    const m = /\[[\s\S]*\]/.exec(text);
    if (!m) return [];
    const arr = JSON.parse(m[0]) as { title?: string; vendor?: string; url?: string; note?: string }[];
    return arr.filter((x) => x.url && /^https?:\/\//.test(x.url)).map((x) => ({ title: x.title ?? x.url!, vendor: x.vendor ?? '', url: x.url!, note: x.note, source: 'search' as const }));
  } catch (e) { throw new Error(describeError(e)); }
}
