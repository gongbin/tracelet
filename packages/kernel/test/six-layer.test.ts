import { expect, it } from 'vitest';
import { createProject, copperLayers, ProjectEditor, pcb, parseProject, serializeProject, exportFabFiles } from '../src/index.js';
it('preserves six layers and exports six numbered copper files', () => {
 const ed = new ProjectEditor(createProject({name:'Six layers'}));
 ed.dispatch(pcb.setCopperCount(6));
 const board = parseProject(serializeProject(ed.project)).board;
 expect(copperLayers(board.copperCount)).toEqual(['F.Cu','In1.Cu','In2.Cu','In3.Cu','In4.Cu','B.Cu']);
 const files = exportFabFiles(ed.project);
 for (let i=1;i<=6;i++) expect(files.some(f=>f.content.includes(`Copper,L${i},`))).toBe(true);
 ed.undo(); expect(ed.project.board.copperCount).toBe(2);
});
it('rejects removing occupied inner layers and preserves the project', () => {
 const ed = new ProjectEditor(createProject({name:'Six layers',copperCount:6}));
 ed.dispatch(pcb.addTrace({layer:'In4.Cu',net:'GND',width:0.25,points:[{x:5,y:5},{x:10,y:5}]}).command);
 const before=serializeProject(ed.project);
 expect(()=>ed.dispatch(pcb.setCopperCount(4))).toThrow();
 expect(serializeProject(ed.project)).toBe(before);
});

import { autoroute, BoardFootprintSchema, registerFootprints, ruleSetOf, importKicadPcb } from '../src/index.js';
it.each(['In3.Cu','In4.Cu'] as const)('routes through-hole connections on %s', layer => {
 registerFootprints([{id:'six:pad',name:'PTH',body:{w:2,h:2},height:1,description:'',pads:[{number:'1',x:0,y:0,w:2,h:2,shape:'circle',drill:0.8,npth:false}]}]);
 const p=createProject({name:'Routing six',copperCount:6});
 p.board.footprints=[10,20].map((x,i)=>BoardFootprintSchema.parse({id:`p${i}`,ref:`P${i}`,footprintId:'six:pad',x,y:10,padNets:{'1':'A'}}));
 p.board.netClasses[0].allowedLayers=[layer];
 const r=autoroute(p.board,ruleSetOf(p),{timeBudgetMs:1000});
 expect(r.total).toBe(1); expect(r.routed).toBe(1); expect(r.traces.some(t=>t.layer===layer)).toBe(true);
 expect(r.traces.every(t=>t.layer===layer)).toBe(true);
});
it('imports KiCad six-layer copper without dropping In3/In4', () => {
 const r=importKicadPcb('(kicad_pcb (version 20240108) (layers (0 "F.Cu" signal) (1 "In1.Cu" signal) (2 "In2.Cu" signal) (3 "In3.Cu" signal) (4 "In4.Cu" signal) (31 "B.Cu" signal)) (net 1 "A") (segment (start 5 5) (end 10 5) (width 0.25) (layer "In4.Cu") (net 1)))');
 expect(r.board.copperCount).toBe(6); expect(r.board.traces[0].layer).toBe('In4.Cu');
});
