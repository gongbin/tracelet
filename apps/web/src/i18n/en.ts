import type { MessageKey } from './zh-CN.js';
/** English. Missing keys fall back to zh-CN. */
export const en: Partial<Record<MessageKey, string>> = {
  'nav.projects': 'Projects', 'nav.library': 'Library', 'nav.community': 'Community', 'nav.docs': 'Docs',
  'ws.sch': 'Schematic', 'ws.pcb': 'PCB', 'ws.3d': '3D', 'ws.lib': 'Library', 'ws.bom': 'BOM', 'ws.fab': 'Fabrication',
  'ws.sync': 'Update PCB', 'ws.search': 'Commands · Parts · Nets', 'ws.saved': 'Saved', 'ws.saving': 'Saving…',
  'tab.props': 'Properties', 'tab.layers': 'Layers', 'tab.lib': 'Parts', 'tab.check': 'Checks', 'tab.ai': 'AI', 'tab.3d': 'Display',
  'home.search': 'Search projects, parts, commands', 'home.new': 'New project', 'home.import': 'Import project', 'home.template': 'Start from template', 'home.recent': 'Recent projects', 'home.community': 'Community picks',
  'home.onboard.title': 'First time? Build an LED blinker in 5 minutes', 'home.onboard.body': 'Guided on the canvas: place parts → wire → generate PCB → export. Dismiss anytime.', 'home.start': 'Start',
  'home.storage.local': 'Local storage', 'home.storage.remote': 'Remote (team)',
  'theme.dark': 'Dark', 'theme.light': 'Light', 'theme.system': 'System',
  'settings.language': 'Language', 'settings.theme': 'Theme',
  'fab.title': 'Fabrication', 'fab.precheck': 'Pre-flight checks', 'fab.export': 'Export', 'fab.download': 'Download fab files (zip)', 'fab.preview': 'Preview Gerber', 'fab.order': 'Order →',
  'lib.all': 'All categories', 'lib.title': 'Parts library', 'lib.place': 'Place in schematic',
  'palette.placeholder': 'Type a command; @ parts, # nets', 'palette.empty': 'No matches'
};
