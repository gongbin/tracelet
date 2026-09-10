import {expect,it} from 'vitest';
import {createProject,ProjectEditor,sch,getSymbol,searchParts,buildNetlist,syncBoardFromSchematic,serializeProject,parseProject} from '../src/index.js';
it('places both test point styles, connects them and preserves single-pad PCB identities',()=>{
 const editor=new ProjectEditor(createProject({name:'Test points'})),sheetId=editor.project.schematic.sheets[0].id;
 const placed=['sym:TP','sym:TP_Open'].map((symbolId,i)=>{
  const placement=sch.placeComponent(editor.project,{sheetId,symbolId,center:{x:1000+i*2000,y:1000}});editor.dispatch(placement.command);return placement;
 });
 expect(placed.map(p=>p.ref)).toEqual(['TP1','TP2']);
 editor.dispatch(sch.connectPins(sheetId,{componentId:placed[0].id,pin:'1'},{componentId:placed[1].id,pin:'1'}));
 const sheet=editor.project.schematic.sheets[0];
 expect(buildNetlist(sheet).nets.some(n=>n.pins.length===2)).toBe(true);
 const board=syncBoardFromSchematic(editor.project);
 expect(board.footprints.map(f=>f.ref).sort()).toEqual(['TP1','TP2']);
 expect(board.footprints.every(f=>f.footprintId==='fp:TestPoint_Pad_D1.0mm')).toBe(true);
 expect(board.footprints[0].padNets['1']).toBe(board.footprints[1].padNets['1']);
 expect(parseProject(serializeProject(editor.project)).schematic.sheets[0].components).toEqual(sheet.components);
 editor.undo();expect(editor.project.schematic.sheets[0].wires).toHaveLength(0);
 for(const [id,fill] of [['sym:TP','outline'],['sym:TP_Open','none']]){
  const symbol=getSymbol(id);expect(symbol.pins).toHaveLength(1);expect(symbol.power).toBe(false);
  const circle=symbol.shapes?.find((s): s is Extract<typeof s,{kind:'circle'}> => s.kind==='circle');
  expect(circle?.fill).toBe(fill);
 }
 expect(searchParts('testpoint').filter(p=>p.id.startsWith('part:testpoint-'))).toHaveLength(2);
});
