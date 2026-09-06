/**
 * 英文界面的兜底翻译层：界面大量文案是中文写死的（含内核产生的 DRC / ERC 消息、Undo 历史标签、提示语），
 * 逐条改成 key 工作量太大且容易遗漏。这里在 locale=en 时用 MutationObserver 把渲染出来的中文文本按词典替换成英文：
 * - 只处理文本节点与 title / placeholder / aria-label 属性；不碰 input / textarea 的值，不碰 SVG 画布（那是用户数据）。
 * - 先整句精确匹配，再按"最长片段优先"替换，模板里的数字 / 位号原样保留。
 * - 词典缺的词保留中文，不会破坏结构。
 */
import { DICT_EN } from './dict-en.js';

const CJK = /[一-鿿]/;
let entries: [string, string][] | null = null;
function table(): [string, string][] {
  // 片段替换只用 ≥2 字的键；单字（层 / 页 / 上 / 下…）只在整句精确匹配时生效，避免把未翻译的长句拆坏
  if (!entries) entries = Object.entries(DICT_EN).filter(([k]) => k.trim().length >= 2).sort((a, b) => b[0].length - a[0].length);
  return entries;
}
const cache = new Map<string, string>();
export function translateText(s: string): string {
  if (!CJK.test(s)) return s;
  const hit = cache.get(s); if (hit !== undefined) return hit;
  const trimmed = s.trim();
  let out: string;
  if (DICT_EN[trimmed] !== undefined) out = s.replace(trimmed, DICT_EN[trimmed]);
  else {
    out = s;
    for (const [zh, en] of table()) if (out.includes(zh)) out = out.split(zh).join(en);
    // 数字后的量词（3 个元件 → 3 components）
    out = out.replace(/(\d)\s*段(?![一-鿿])/g, '$1 seg').replace(/(\d)\s*[个条段块处次根种张]\s*(?=[A-Za-z(])/g, '$1 ');
    // 中英文之间补空格，去掉中文标点残留
    out = out.replace(/([A-Za-z0-9)])([一-鿿])/g, '$1 $2').replace(/([一-鿿])([A-Za-z0-9(])/g, '$1 $2').replace(/：/g, ': ').replace(/，/g, ', ').replace(/。/g, '. ').replace(/（/g, ' (').replace(/）/g, ') ').replace(/、/g, ', ').replace(/ {2,}/g, ' ').replace(/\s+([,.:)])/g, '$1');
  }
  if (cache.size > 5000) cache.clear();
  cache.set(s, out);
  return out;
}

const ATTRS = ['title', 'placeholder', 'aria-label'];
const originals = new WeakMap<Node, string>();
function inSvg(n: Node | null): boolean { for (let p = n; p; p = p.parentNode) { if ((p as Element).nodeName === 'svg' || (p as Element).nodeName === 'SVG') return true; } return false; }
function skip(el: Element | null): boolean { for (let p = el; p; p = p.parentElement) { if (p.hasAttribute?.('data-no-translate')) return true; const tag = p.tagName; if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'CODE' || tag === 'PRE') return true; } return false; }
function fixText(node: Text) {
  const v = node.nodeValue ?? ''; if (!CJK.test(v)) return;
  if (inSvg(node) || skip(node.parentElement)) return;
  originals.set(node, v);
  const t = translateText(v); if (t !== v) node.nodeValue = t;
}
function fixAttrs(el: Element) {
  if (skip(el.parentElement) || inSvg(el)) return;
  for (const a of ATTRS) { const v = el.getAttribute(a); if (v && CJK.test(v)) { const t = translateText(v); if (t !== v) el.setAttribute(a, t); } }
}
function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) { fixText(root as Text); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
  if (root.nodeType === Node.ELEMENT_NODE) fixAttrs(root as Element);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n: Node | null;
  while ((n = it.nextNode())) { if (n.nodeType === Node.TEXT_NODE) fixText(n as Text); else fixAttrs(n as Element); }
}

let observer: MutationObserver | null = null;
let active = false;
export function setAutoTranslate(on: boolean) {
  if (on === active) return; active = on;
  if (on) {
    walk(document.body);
    observer = new MutationObserver((muts) => {
      observer!.disconnect();
      try {
        for (const m of muts) {
          if (m.type === 'characterData') { const t = m.target as Text; if (originals.get(t) !== t.nodeValue) fixText(t); }
          else if (m.type === 'attributes') fixAttrs(m.target as Element);
          else for (const n of Array.from(m.addedNodes)) walk(n);
        }
      } finally { observer!.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS }); }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  } else {
    observer?.disconnect(); observer = null;
    // 回到中文：React 下一次渲染会自然恢复；这里不做反向替换，避免误伤
  }
}
