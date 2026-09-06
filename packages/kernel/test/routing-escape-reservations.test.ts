import {it,expect} from 'vitest';
import {emptyBoard,BoardFootprintSchema,RULE_SETS,registerFootprints} from '../src/index.js';
import {RoutingSpace} from '../src/board/routingSpace.js';
registerFootprints([{id:'test:escape-small',name:'small',body:{w:1,h:1},height:1,description:'',pads:[{number:'1',x:0,y:0,w:.4,h:.4,shape:'rect',drill:0,npth:false}]}]);
it('does not reserve phantom escape copper for completed nets, but retains their real pad obstacles',()=>{
 const board=emptyBoard();board.footprints=[BoardFootprintSchema.parse({id:'p',ref:'P1',footprintId:'test:escape-small',x:5,y:5,padNets:{'1':'DONE'}})];
 const reserved=new RoutingSpace(board,RULE_SETS[0]);reserved.reserveEscapes(new Set(['DONE','PENDING']));
 expect(reserved.free({x:6.2,y:5},.125,'F.Cu','PENDING',.127)).toBe(false);
 const completed=new RoutingSpace(board,RULE_SETS[0]);completed.reserveEscapes(new Set(['PENDING']));
 expect(completed.free({x:6.2,y:5},.125,'F.Cu','PENDING',.127)).toBe(true);
 expect(completed.free({x:5,y:5},.125,'F.Cu','PENDING',.127)).toBe(false);
});
