import type Anthropic from '@anthropic-ai/sdk';
import { createClient, describeError } from './client.js';
import type { AiConfig } from './config.js';
import { TOOL_DEFS, runTool, type ToolContext } from './tools.js';

export const SYSTEM_PROMPT = `你是 Tracelet（开源在线 PCB 设计工具）内置的电路设计助手，面向个人开发者与创客。
原则：
- 你能通过工具读取当前项目（网表、元件、ERC/DRC）并做修改；所有修改都会进入撤销历史，用户可以 Undo。
- 判断"是否违规"一律调用 run_erc / run_drc / review_schematic，不要凭印象猜。
- 回答用简体中文，简洁、具体，给出位号和引脚名。修改前先说明要做什么，修改后说明做了什么。
- 不确定的器件参数（数据手册值）要说明是经验值。
- 用户可以在对话里直接附上原理图 PDF / 图片。收到附件时：先把电路抽取出来（位号、值、类别、封装提示、每个引脚的网络名），调用 generate_sheet_from_spec 生成图纸，然后用 run_erc / review_schematic 复核，把不确定的地方告诉用户。用户要求"按附件修改现有图纸"时，用 get_netlist 对照差异，再用 place_component / connect_pins / add_net_label / set_component_value / delete_components 逐项修改。
- 你有完整的读写工具，不要回答"无法修改图纸"；做不到的具体原因要说清楚（比如缺少某个符号），并给出替代做法。`;

export interface AgentStep { text: string }
export interface AgentReply { text: string; steps: string[]; refused?: boolean }

/** 手动代理循环：请求 → 执行工具 → 回填结果，直到 end_turn。 */
export async function chatWithTools(cfg: AiConfig, history: Anthropic.Beta.BetaMessageParam[], ctx: ToolContext, onText?: (t: string) => void): Promise<{ reply: AgentReply; history: Anthropic.Beta.BetaMessageParam[] }> {
  const client = createClient(cfg);
  const messages = [...history];
  const steps: string[] = [];
  const log = (s: string) => { steps.push(s); ctx.log(s); };
  const isOpus5 = /^claude-(opus-5|fable)/.test(cfg.model);
  let finalText = '';
  for (let iter = 0; iter < 12; iter++) {
    let response: Anthropic.Beta.BetaMessage;
    try {
      // 流式请求：避免 SDK 对长请求的非流式限制，也能边生成边显示
      response = await client.beta.messages.stream({
        model: cfg.model,
        max_tokens: 16000,
        system: SYSTEM_PROMPT,
        tools: TOOL_DEFS as unknown as Anthropic.Beta.BetaToolUnion[],
        messages,
        thinking: { type: 'adaptive' },
        output_config: { effort: cfg.effort },
        // 服务端 fallback：模型因安全策略拒绝时自动改用备用模型（仅 Opus 5 / Fable 系列支持）
        ...(isOpus5 ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
      }).on('text', (delta, snapshot) => { if (delta) onText?.(snapshot); }).finalMessage();
    } catch (e) { throw new Error(describeError(e)); }
    if (response.stop_reason === 'refusal') { return { reply: { text: '模型拒绝了这个请求（安全策略）。', steps, refused: true }, history: messages }; }
    const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n');
    if (text) { finalText = text; onText?.(text); }
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'pause_turn') continue;
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || uses.length === 0) break;
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      let out: string;
      try { out = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, { ...ctx, log }); }
      catch (e) { out = `工具执行失败：${(e as Error).message}`; results.push({ type: 'tool_result', tool_use_id: u.id, content: out, is_error: true }); continue; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: out });
    }
    messages.push({ role: 'user', content: results });
  }
  return { reply: { text: finalText, steps }, history: messages };
}
