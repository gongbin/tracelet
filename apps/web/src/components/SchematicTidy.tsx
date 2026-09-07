import { command, tidySchematic, assertElectricalIdentity } from '@tracelet/kernel';
import { useApp, useEditor, useSheet } from '../store/app.js';
import { usePrefs } from '../i18n/index.js';
export function SchematicTidy(){
  const editor=useEditor(),app=useApp(),sheet=useSheet(),zh=usePrefs(s=>s.locale).startsWith('zh');
  return <button className="btn sm" onClick={()=>{try{
    const result=tidySchematic(editor.project.schematic,sheet.id);
    editor.dispatch(command('Schematic cleanup',p=>{assertElectricalIdentity(p.schematic,result.schematic);return {...p,schematic:result.schematic};}));
    app.set('fitSeq',app.fitSeq+1);app.toast(zh?`整理完成：${result.groups} 个连接分组，${result.cleanedWires} 条连线，${result.movedTexts} 处文字。电气身份一致，可撤销。`:`Cleaned ${result.groups} groups, ${result.cleanedWires} wires, ${result.movedTexts} texts. Electrical identity unchanged. Undo available.`,'success');
  }catch(e){app.toast(String(e),'error');}}}>{zh?'整理并校验':'Tidy & verify'}</button>;
}
