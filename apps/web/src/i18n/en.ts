import type { MessageKey } from './zh-CN.js';
/** English. Missing keys fall back to zh-CN. */
export const en: Partial<Record<MessageKey, string>> = {
  'nav.projects': 'Projects', 'nav.library': 'Library', 'nav.community': 'Community', 'nav.docs': 'Docs',
  'ws.sch': 'Schematic', 'ws.pcb': 'PCB', 'ws.3d': '3D', 'ws.lib': 'Library', 'ws.bom': 'BOM', 'ws.fab': 'Fabrication',
  'ws.sync': 'Update PCB', 'ws.search': 'Commands · Parts · Nets', 'ws.saved': 'Saved', 'ws.saving': 'Saving…',
  'tab.props': 'Properties', 'tab.layers': 'Layers', 'tab.lib': 'Parts', 'tab.check': 'Checks', 'tab.ai': 'AI', 'tab.3d': 'Display', 'tab.guide': 'Guide',
  'home.search': 'Search projects, parts, commands', 'home.new': 'New project', 'home.import': 'Import project', 'home.template': 'Start from template', 'home.recent': 'Recent projects', 'home.community': 'Templates & examples',
  'home.onboard.title': 'First time? Build an LED blinker in 5 minutes', 'home.onboard.body': 'Guided on the canvas: place parts → wire → generate PCB → export. Dismiss anytime.', 'home.start': 'Start',
  'home.storage.local': 'Local storage', 'home.storage.remote': 'Remote (team)',
  'theme.dark': 'Dark', 'theme.light': 'Light', 'theme.system': 'System',
  'settings.language': 'Language', 'settings.theme': 'Theme', 'settings.wheel': 'Canvas gestures', 'wheel.pan': 'Trackpad: two-finger pan · pinch zoom', 'wheel.zoom': 'Mouse: wheel zoom · middle-drag pan',
  'proj.export': 'Export project (.eda.json)', 'proj.backup': 'Back up all projects (zip)', 'proj.import': 'Import project / backup…',
  'fab.title': 'Fabrication', 'fab.precheck': 'Pre-flight checks', 'fab.export': 'Export', 'fab.download': 'Download fab files (zip)', 'fab.preview': 'Preview Gerber', 'fab.order': 'Ordering guide →',
  'lib.all': 'All categories', 'lib.title': 'Parts library', 'lib.place': 'Place in schematic',
  'nav.library.tip': 'Open the most recent project and go to the parts library', 'nav.library.empty': 'Create or import a project first, then open the library', 'home.footer.about': 'Tracelet is an open-source online PCB design tool: schematic → PCB → 3D → fab files. Your data stays in your browser by default.', 'home.footer.license': 'GPL-3.0-or-later (same as KiCad) · stars, issues and PRs welcome', 'home.footer.repo': 'GitHub repository', 'home.footer.issues': 'Report an issue', 'home.footer.discuss': 'Discussions', 'home.footer.readme': 'Docs (README)', 'home.footer.mcp': 'MCP / CLI integration', 'home.footer.selfhost': 'Self-host the server', 'pager.prev': 'Prev', 'pager.next': 'Next', 'pager.page': 'Page {page} / {count} · {total} items',
  'all': 'All',
  'palette.placeholder': 'Type a command; @ parts, # nets', 'palette.empty': 'No matches'
};
