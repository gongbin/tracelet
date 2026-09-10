import {afterEach,it,expect} from 'vitest';
import {render,fireEvent,cleanup,act} from '@testing-library/react';
import {createProject,BoardFootprintSchema,registerFootprints,computeRatsnest,holeFootprint,pcb,LAYER_COLORS} from '@tracelet/kernel';
import { PCB_DISPLAY } from '../src/editors/pcb/display';
import {PcbCanvas} from '../src/editors/pcb/PcbCanvas';
import {useApp} from '../src/store/app';
import {usePrefs} from '../src/i18n';
const def={id:'web:route-pad',name:'Route pad',body:{w:2,h:2},height:1,description:'',pads:[{number:'1',x:0,y:0,w:1,h:1,shape:'circle' as const,drill:0,npth:false}]};
registerFootprints([def]);
afterEach(()=>{cleanup();useApp.getState().closeProject();});
function setup(blocked=false){
 usePrefs.getState().setLocale('en');
 const p=createProject({name:'Manual route test'});p.library.footprints.push(def);
 p.board.footprints=[{x:5.07,y:10.03},{x:25.07,y:20.03},{x:35,y:10}].map((pos,i)=>BoardFootprintSchema.parse({...pos,id:`f${i}`,ref:`TP${i+1}`,footprintId:def.id,padNets:{'1':'SIG'}}));
 if(blocked)p.board.traces=[{id:'wall',net:'GND',layer:'F.Cu',width:.5,points:[{x:15,y:0},{x:15,y:30}]}];
 useApp.getState().openProjectObject(p);useApp.getState().go('pcb');useApp.getState().setPcbTool('route');useApp.getState().patch({activeLayer:'F.Cu',traceWidthOverride:null});
 const view=render(<PcbCanvas/>),svg=view.container.querySelector('svg.stage')!;
 const [tx,ty,k]=svg.querySelector('g[transform]')!.getAttribute('transform')!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
 const pointer=(type:string,x:number,y:number,target:Element=svg,extra:MouseEventInit={})=>{const ev=new MouseEvent(type,{bubbles:true,clientX:x*k+tx,clientY:y*k+ty,...extra});Object.defineProperties(ev,{pointerId:{value:1},pointerType:{value:'mouse'}});fireEvent(target,ev);};
 return {...view,p,svg,pointer,ed:useApp.getState().editor!};
}
it('magnetic pad routing preserves off-grid endpoints, offers guides and commits with one undo',()=>{
 const v=setup();v.pointer('pointermove',5.4,10.3);expect(v.container.querySelector('[data-route-snap]')).not.toBeNull();
 v.pointer('pointerdown',5.4,10.3);expect(useApp.getState().routing?.points[0]).toEqual({x:5.07,y:10.03});
 v.pointer('pointermove',25.3,20.2);expect(v.container.querySelector('[data-route-reference]')).not.toBeNull();
 v.pointer('pointerdown',25.3,20.2);expect(useApp.getState().routing).toBeNull();
 expect(v.ed.project.board.traces).toHaveLength(1);expect(v.ed.project.board.traces[0].points.at(-1)).toEqual({x:25.07,y:20.03});
 expect(computeRatsnest(v.ed.project.board).unrouted).toBe(1);
 act(()=>v.ed.undo());expect(v.ed.project.board.traces).toHaveLength(0);
});
it('backs out an entire clicked bend and cancels without committing draft copper',()=>{
 const v=setup();v.pointer('pointerdown',5.07,10.03);v.pointer('pointermove',12,14);v.pointer('pointerdown',12,14);
 expect(useApp.getState().routing!.points.length).toBeGreaterThan(1);
 fireEvent.keyDown(window,{key:'Backspace'});expect(useApp.getState().routing!.points).toHaveLength(1);
 fireEvent.keyDown(window,{key:'Escape'});expect(useApp.getState().routing).toBeNull();expect(v.ed.project.board.traces).toHaveLength(0);
});
it('renders configured sub-millimetre widths unchanged in previews, committed copper and selection',()=>{
 const v=setup();act(()=>useApp.getState().set('traceWidthOverride',.127));
 v.pointer('pointerdown',5.07,10.03);v.pointer('pointermove',25.07,20.03);
 expect(v.getByText(/Width 0\.127 mm/)).toBeTruthy();
 expect(v.container.querySelector('[data-route-preview]')?.getAttribute('stroke-width')).toBe('0.127');
 // The clearance indicator is hollow, so its outer boundary cannot masquerade as copper width.
 const outline=v.container.querySelector('[data-route-clearance]')!;
 expect(outline.querySelector('mask path[stroke="black"]')).not.toBeNull();
 expect(outline.querySelector('path[mask]')?.getAttribute('stroke')).toBe(PCB_DISPLAY.clearance);
 v.pointer('pointerdown',25.07,20.03);const trace=v.ed.project.board.traces[0];expect(trace.width).toBe(.127);
 act(()=>{useApp.getState().setPcbTool('select');useApp.getState().patch({pcbSelection:[trace.id],highlightNet:'SIG'});});
 const copper=v.container.querySelector('[data-trace-copper]')!;
 expect(copper.getAttribute('stroke-width')).toBe('0.127');expect(copper.getAttribute('vector-effect')).toBeNull();
 expect(copper.getAttribute('stroke')).toBe(PCB_DISPLAY.selected);
 expect([...copper.parentElement!.querySelectorAll('path')].filter(p=>p.getAttribute('stroke')!=='transparent')).toHaveLength(1);
 fireEvent.wheel(v.svg,{deltaY:-100,clientX:100,clientY:100,ctrlKey:true});expect(copper.getAttribute('stroke-width')).toBe('0.127');
});
it('distinguishes copper from errors using both color and marker shape without widening blocked previews',()=>{
 const v=setup(true);v.pointer('pointerdown',5.07,10.03);v.pointer('pointermove',25.07,20.03);
 const preview=v.container.querySelector('[data-route-preview]')!;
 expect(preview.getAttribute('stroke')).toBe(LAYER_COLORS['F.Cu']);expect(preview.getAttribute('stroke-width')).toBe('0.25');
 const error=v.container.querySelector('[data-pcb-check="error"]')!;
 expect(error.querySelector('text')?.textContent).toBe('!');expect(error.querySelector('text')?.getAttribute('fill')).toBe(PCB_DISPLAY.error);
 expect(PCB_DISPLAY.error).not.toBe(LAYER_COLORS['F.Cu']);expect(error.querySelector('path[fill]')?.getAttribute('d')).toBe('M0 -10L10 0L0 10L-10 0Z');
 const pad=v.container.querySelector('[data-pad="TP1.1"] ellipse')!;
 expect(pad.getAttribute('rx')).toBe('0.5');expect(pad.getAttribute('fill')).toBe(PCB_DISPLAY.selected);
});
it('blocks a copper-crossing commit and places a checked via at the cursor rather than the last fixed corner',()=>{
 const v=setup(true);v.pointer('pointerdown',5.07,10.03);v.pointer('pointermove',25.07,20.03);v.pointer('pointerdown',25.07,20.03);
 expect(v.ed.project.board.traces).toHaveLength(1);expect(useApp.getState().routing).not.toBeNull();expect(useApp.getState().toasts.at(-1)?.kind).toBe('error');
 v.pointer('pointermove',10,12);fireEvent.keyDown(window,{key:'v'});
 expect(v.ed.project.board.vias).toHaveLength(1);expect(v.ed.project.board.vias[0]).toMatchObject({x:10,y:12,net:'SIG'});expect(useApp.getState().routing?.layer).toBe('B.Cu');
 expect(v.ed.project.board.traces).toHaveLength(2);act(()=>v.ed.undo());expect(v.ed.project.board.vias).toHaveLength(0);expect(v.ed.project.board.traces).toHaveLength(1);
});
it('starts and ends branches on existing copper, and Enter includes the cursor preview',()=>{
 const v=setup();act(()=>useApp.getState().editor!.dispatch({label:'fixture',apply:p=>({...p,board:{...p.board,traces:[{id:'t',net:'SIG',layer:'F.Cu',width:.25,points:[{x:5,y:5},{x:25,y:5}]}]}})}));
 v.pointer('pointerdown',12,5.2);expect(useApp.getState().routing?.points[0]).toEqual({x:12,y:5});
 v.pointer('pointermove',12,12);fireEvent.keyDown(window,{key:'Enter'});expect(v.ed.project.board.traces.at(-1)!.points.at(-1)).toEqual({x:12,y:12});expect(useApp.getState().routing).toBeNull();
});
it('keeps modified shortcuts from dropping vias, and undoes draft corners before document history',()=>{
 const v=setup();v.pointer('pointerdown',5.07,10.03);v.pointer('pointermove',12,14);v.pointer('pointerdown',12,14);
 fireEvent.keyDown(window,{key:'v',metaKey:true});fireEvent.keyDown(window,{key:'v',ctrlKey:true});expect(v.ed.project.board.vias).toHaveLength(0);
 fireEvent.keyDown(window,{key:'z',metaKey:true});expect(useApp.getState().routing?.points).toHaveLength(1);
 v.pointer('pointermove',10,12);fireEvent.keyDown(window,{key:'v'});expect(v.ed.project.board.vias).toHaveLength(1);
 fireEvent.keyDown(window,{key:'z',ctrlKey:true});expect(useApp.getState().routing).toBeNull();
 // Workspace handles document undo after the canvas releases the modified shortcut.
 act(()=>v.ed.undo());expect(v.ed.project.board.vias).toHaveLength(0);expect(v.ed.project.board.traces).toHaveLength(0);
});
it('requires a via for layer changes during routing and respects Alt even without prior pointer motion',()=>{
 const v=setup();v.pointer('pointerdown',5.4,10.3,v.svg,{altKey:true});expect(useApp.getState().routing).toBeNull();
 v.pointer('pointerdown',5.4,10.3);act(()=>useApp.getState().selectPcbLayer('B.Cu'));
 expect(useApp.getState().activeLayer).toBe('F.Cu');expect(useApp.getState().routing?.layer).toBe('F.Cu');
 fireEvent.keyDown(window,{key:'Escape'});act(()=>useApp.getState().selectPcbLayer('B.Cu'));expect(useApp.getState().activeLayer).toBe('B.Cu');
});
it('reuses a same-net plated hole for a layer transition without adding a coincident drill',()=>{
 const v=setup(),hole=holeFootprint(1,true,.4);registerFootprints([hole]);
 act(()=>v.ed.dispatch(pcb.addBoardFootprint(v.ed.project,{footprintId:hole.id,x:10,y:12,padNets:{'1':'SIG'}}).command));
 v.pointer('pointerdown',5.07,10.03);v.pointer('pointermove',10,12);fireEvent.keyDown(window,{key:'v'});
 expect(useApp.getState().routing?.layer).toBe('B.Cu');expect(v.ed.project.board.vias).toHaveLength(0);
 expect(v.ed.project.board.traces).toHaveLength(1);expect(v.ed.project.board.traces[0].points.at(-1)).toEqual({x:10,y:12});
});
it('moves selected components together, preserves relative spacing and rolls back on Escape',()=>{
 const v=setup();act(()=>{useApp.getState().setPcbTool('select');useApp.getState().set('pcbSelection',['f0','f1']);});
 const part=v.container.querySelector('[data-footprint-id="f0"]')!;
 expect(v.container.querySelector('[data-ratsnest]')?.getAttribute('pointer-events')).toBe('none');
 v.pointer('pointerdown',5.07,10.03,part);v.pointer('pointermove',7.07,12.03,v.svg,{altKey:true});
 const fs=v.ed.project.board.footprints;expect(fs[1].x-fs[0].x).toBeCloseTo(20);expect(fs[1].y-fs[0].y).toBeCloseTo(10);
 fireEvent.keyDown(window,{key:'Escape'});expect(v.ed.project.board.footprints[0].x).toBe(5.07);expect(v.ed.project.board.footprints[1].x).toBe(25.07);
});
it('places assigned plated holes and edge-snapped castellated rows as one undoable action each',()=>{
 const v=setup();act(()=>{useApp.getState().setPcbTool('hole');useApp.getState().set('hole',{mode:'round',drill:3.2,ring:.5,plated:true,net:'SIG'});});
 v.pointer('pointerdown',40,20);expect(v.ed.project.board.footprints.at(-1)?.padNets).toEqual({'1':'SIG'});act(()=>v.ed.undo());expect(v.ed.project.board.footprints).toHaveLength(3);
 fireEvent.click(v.getByRole('button',{name:'Castellated holes',exact:true}));v.pointer('pointermove',30,.2);v.pointer('pointerdown',30,.2);
 expect(v.ed.project.board.footprints.at(-1)?.ref).toBe('CAST1');expect(v.ed.project.board.footprints.at(-1)?.y).toBe(0);expect(v.ed.project.board.footprints.at(-1)?.placement?.role).toBe('mechanical');act(()=>v.ed.undo());expect(v.ed.project.board.footprints).toHaveLength(3);
 fireEvent.click(v.getByRole('button',{name:'Panel / mouse bites →'}));expect(useApp.getState().screen).toBe('fab');expect(useApp.getState().fabPanelOpen).toBe(true);
});
