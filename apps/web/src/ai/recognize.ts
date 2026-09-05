/**
 * 原理图识别：PDF / 图片（base64）或 URL → 结构化抽取（元件、引脚、网络）→ 由内核生成图纸。
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod/v4';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { createClient, describeError } from './client.js';
import type { AiConfig } from './config.js';
import type { ExtractedSchematic } from '@tracelet/kernel';

export const ExtractedSchema = z.object({
  title: z.string().describe('图纸标题或电路名称'),
  components: z.array(z.object({
    ref: z.string().describe('位号，如 U1、R3'),
    value: z.string().describe('值 / 型号，如 10k、ESP32-S3-WROOM-1'),
    kind: z.string().describe('类别：resistor / capacitor / led / module / ic / connector / crystal / …'),
    footprint: z.string().describe('封装提示，如 0402、SOT-223、未知则空串'),
    pins: z.array(z.object({
      number: z.string().describe('引脚编号'),
      name: z.string().describe('引脚名，没有则重复编号'),
      net: z.string().describe('该引脚连接的网络名；电源写 3V3/5V/VBUS 等，地写 GND，未连接写空串')
    }))
  })),
  notes: z.array(z.string()).describe('识别中的不确定项或页面说明，最多 5 条')
});

export type RecognizeSource = { kind: 'pdf'; data: string } | { kind: 'image'; mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; data: string } | { kind: 'url'; url: string };

const PROMPT = `请把这份原理图（可能是多页 PDF 或截图）抽取为结构化数据。要求：
1. 列出所有元件：位号、值/型号、类别、封装提示。
2. 对每个元件列出所有引脚（编号、引脚名）以及该引脚连接的网络名。网络名以图上的网络标签 / 电源符号为准；没有标签时，用相连元件里位号最小的那个引脚命名，如 Net-R1-2。
3. 电源与地统一：GND 家族写 GND；3.3V 写 3V3；5V 写 5V。
4. 只抽取电气连接，不要虚构没画出来的连接；不确定的地方写进 notes。
5. 位号必须唯一。`;

export interface RecognizeProgress { chars: number; thinking: boolean }

/**
 * 识别原理图。必须走流式：SDK 对 max_tokens 较大的非流式请求会直接拒绝
 * （"Streaming is required for operations that may take longer than 10 minutes"）。
 */
export async function recognizeSchematic(cfg: AiConfig, src: RecognizeSource, opts: { hint?: string; onProgress?: (p: RecognizeProgress) => void; signal?: AbortSignal } = {}): Promise<ExtractedSchematic> {
  const client = createClient(cfg);
  const doc: Anthropic.ContentBlockParam = src.kind === 'pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: src.data } }
    : src.kind === 'url'
      ? { type: 'document', source: { type: 'url', url: src.url } }
      : { type: 'image', source: { type: 'base64', media_type: src.mediaType, data: src.data } };
  try {
    const stream = client.messages.stream({
      model: cfg.model,
      max_tokens: 32000,
      thinking: { type: 'adaptive' },
      output_config: { format: zodOutputFormat(ExtractedSchema), effort: 'high' },
      messages: [{ role: 'user', content: [doc, { type: 'text', text: PROMPT + (opts.hint ? `\n补充说明：${opts.hint}` : '') }] }]
    }, { signal: opts.signal });
    let chars = 0, thinking = false;
    stream.on('streamEvent', (ev) => {
      if (ev.type === 'content_block_start') thinking = ev.content_block.type === 'thinking';
      else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') chars += ev.delta.text.length;
      else return;
      opts.onProgress?.({ chars, thinking });
    });
    const response = await stream.finalMessage();
    if (response.stop_reason === 'refusal') throw new Error('模型拒绝处理该文件');
    if (response.stop_reason === 'max_tokens') throw new Error('图纸太大，输出被截断：请拆页识别或裁剪到需要的部分');
    const out = response.parsed_output;
    if (!out) throw new Error('模型没有返回可解析的结构化结果，请重试或换一页');
    return out;
  } catch (e) { throw new Error(describeError(e)); }
}

/** 读取本地文件为 base64。 */
export async function fileToSource(file: File): Promise<RecognizeSource> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const data = btoa(bin);
  const t = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
  if (t === 'application/pdf') return { kind: 'pdf', data };
  if (t === 'image/png' || t === 'image/jpeg' || t === 'image/webp') return { kind: 'image', mediaType: t, data };
  throw new Error('只支持 PDF、PNG、JPEG、WebP');
}
