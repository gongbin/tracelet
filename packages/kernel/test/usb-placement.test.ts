import { expect,it } from 'vitest';
import { createProject, registerFootprints, BoardFootprintSchema, optimizePlacement, applyPlacement, ruleSetOf } from '../src/index.js';
import { withUsbEdgeConstraints } from '../src/board/usbPlacement.js';
import { edgePlacementFits } from '../src/board/placementConstraints.js';
registerFootprints([{id:'test:USB_C_Receptacle_HRO_TYPE-C-31-M-12',name:'USB_C_Receptacle_HRO_TYPE-C-31-M-12',body:{w:10.64,h:9.42},height:3,description:'',pads:[-3,-1,1,3].map((x,i)=>({number:`A${i+1}`,x,y:-4.045,w:.3,h:.8,shape:'rect',drill:0,npth:false}))}]);
it.each(['initial','incremental'] as const)('keeps USB-C edge and mating direction through %s optimization',mode=>{
 const p=createProject({name:'USB regression'});p.board.outline=[{x:0,y:0},{x:50,y:0},{x:50,y:40},{x:0,y:40}];
 p.board.footprints=[BoardFootprintSchema.parse({id:'usb',ref:'J9',footprintId:'test:USB_C_Receptacle_HRO_TYPE-C-31-M-12',x:25,y:20,rotation:90})];
 const original=JSON.stringify(p.board), constrained=withUsbEdgeConstraints(p.board);
 const result=optimizePlacement(p.board,ruleSetOf(p),{mode,moveConnectors:true,iterations:1000,seed:1,verifyRouting:false});
 expect(result.rejected).toBeUndefined();
 const after=applyPlacement(constrained,result.moves);
 expect(edgePlacementFits(after.footprints[0],after)).toBe(true);
 expect(JSON.stringify(p.board)).toBe(original);
});
it('preserves explicitly selected mechanical edge settings',()=>{
 const p=createProject({name:'Explicit'});p.board.footprints=[BoardFootprintSchema.parse({id:'usb',ref:'J9',footprintId:'test:USB_C_Receptacle_HRO_TYPE-C-31-M-12',x:25,y:20,placement:{edge:{index:1,direction:90,distance:2}}})];
 expect(withUsbEdgeConstraints(p.board).footprints[0].placement).toEqual(p.board.footprints[0].placement);
});
