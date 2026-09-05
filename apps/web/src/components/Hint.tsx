import { useApp } from '../store/app.js';

export function Hint({ space }: { space: 'sch' | 'pcb' }) {
  const app = useApp();
  let title = '', body = '';
  if (space === 'sch') {
    if (app.pasting) { title = '粘贴'; body = '点击放置 · Esc 取消'; }
    else if (app.placing) { title = `放置 ${app.placing.partLabel ?? ''}`.trim(); body = '点击画布放置 · R 旋转 · 连续放置 · Esc 结束'; }
    else if (app.wireDraft) { title = '画线中'; body = '点击加点 · 点引脚/导线或双击结束 · Esc 取消'; }
    else if (app.busDraft) { title = '总线'; body = '点击加点 · 双击结束'; }
    else if (app.schTool === 'bus') { title = '总线'; body = '点击开始画总线'; }
    else if (app.schTool === 'junction') { title = '结点'; body = '点击导线交叉处放置'; }
    else if (app.schTool === 'draw') { title = '图形'; body = app.drawMode === 'text' ? '点击放置文字' : app.drawMode === 'rect' ? '点两个对角画矩形' : '点击加点 · 双击结束'; }
    else if (app.schTool === 'measure') { title = '测量'; body = '点两点 · 再点重新开始 · Esc 结束'; }
    else if (app.pendingPin) { title = '连线中'; body = '点击目标引脚结束 · Esc 取消'; }
    else if (app.schTool === 'wire') { title = '连线'; body = '点引脚或空白处开始'; }
    else if (app.schTool === 'pwr') { title = '电源 / 地'; body = '选一个符号，再点画布'; }
    else if (app.schTool === 'label') { title = '网络标签'; body = '点击导线端点或引脚放标签 · Esc 退出'; }
    else { title = '选择'; body = '拖空白框选 · 点导线选中/再拖调整 · ⌘C/⌘V 复制粘贴 · R 旋转 · Del 删除'; }
  } else {
    const m: Record<string, [string, string]> = {
      select: ['选择', '拖空白框选 · 点焊盘高亮网络 · R 旋转 · F 翻面 · Del 删除 · 双指平移'],
      route: [app.routing ? '走线中' : '走线', app.routing ? '点击加点 · 双击结束 · V 过孔换层 · Esc 取消' : '点击焊盘开始 · 45° 拐角'],
      via: ['过孔', '点击放置 · 尺寸跟随网络类'], zone: ['铺铜', '点击画多边形 · 双击闭合（GND）'], place: ['放置', '请在原理图放置后同步'],
      edge: ['板框', '拖顶点调整 · 点击画新板框 · 双击闭合'], text: ['丝印文字', '点击放置'], measure: ['测量', '点两点 · 再点重新开始 · Esc 结束'],
      flip: ['翻面', '点击元件翻到另一面'], align: ['对齐 / 分布', '框选 2 个以上元件，用下方按钮对齐'], autoroute: ['自动布线', '计算中…'], refill: ['重填铺铜', '铺铜实时计算']
    };
    [title, body] = m[app.pcbTool] ?? ['选择', ''];
  }
  return <div className="hint"><b>{title}</b><span>{body}</span></div>;
}
