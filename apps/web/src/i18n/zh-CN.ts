/** 简体中文（源语言）。键名即语义 id；未翻译的语言回退到这里。 */
export const zhCN = {
  'app.name': 'Tracelet',
  'nav.projects': '项目', 'nav.library': '库', 'nav.community': '社区', 'nav.docs': '文档',
  'ws.sch': '原理图', 'ws.pcb': 'PCB', 'ws.3d': '3D', 'ws.lib': '库', 'ws.bom': 'BOM', 'ws.fab': '制造',
  'ws.sync': '同步到 PCB', 'ws.search': '命令 · 元件 · 网络', 'ws.saved': '已保存', 'ws.saving': '保存中…',
  'tab.props': '属性', 'tab.layers': '图层', 'tab.lib': '元件库', 'tab.check': '检查', 'tab.ai': 'AI', 'tab.3d': '显示',
  'home.search': '搜索项目、元件、命令', 'home.new': '新建项目', 'home.import': '导入项目', 'home.template': '从模板开始', 'home.recent': '最近项目', 'home.community': '社区精选',
  'home.onboard.title': '第一次用？5 分钟画一块 LED 闪灯板', 'home.onboard.body': '画布里逐步引导：放元件 → 连线 → 生成 PCB → 导出。随时可关闭。', 'home.start': '开始',
  'home.storage.local': '本地存储', 'home.storage.remote': '远程协同',
  'theme.dark': '深色', 'theme.light': '浅色', 'theme.system': '跟随系统',
  'lang.zh-CN': '简体中文', 'lang.en': 'English',
  'settings.language': '语言', 'settings.theme': '主题',
  'fab.title': '制造', 'fab.precheck': '打板前检查', 'fab.export': '导出', 'fab.download': '下载制造文件 (zip)', 'fab.preview': '预览 Gerber', 'fab.order': '直接下单 →',
  'lib.all': '全部分类', 'lib.title': '元件库', 'lib.place': '放置到原理图',
  'palette.placeholder': '输入命令；@ 搜元件，# 搜网络', 'palette.empty': '没有匹配项'
} as const;
export type MessageKey = keyof typeof zhCN;
