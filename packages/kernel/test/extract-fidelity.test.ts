import {expect,it} from 'vitest';
import {generateSchematic,buildNetlist,getSymbol,type ExtractedSchematic} from '../src/index.js';
const source: ExtractedSchematic = {title:'Boost extraction regression',preserveNetNames:true,notes:['Verify unseen package','Pin numbers read from image'],components:[
 {ref:'U3',value:'MAX17220',kind:'ic',position:{x:47,y:48},pins:[{number:'5',name:'IN',net:'VSTOR',side:'L'},{number:'6',name:'EN',net:'ENABLE',side:'L'},{number:'2',name:'LX',net:'LX',side:'R'},{number:'1',name:'OUT',net:'+3V0',side:'R'},{number:'4',name:'SEL',net:'SELECT',side:'R'},{number:'3',name:'GND',net:'GND',side:'B'}]},
 {ref:'L2',value:'2.2uH',kind:'inductor',position:{x:46,y:21},pins:[{number:'1',net:'VSTOR',side:'L'},{number:'2',net:'LX',side:'R'}]},
 {ref:'R15',value:'39M',kind:'resistor',position:{x:23,y:35},pins:[{number:'1',net:'VSTOR',side:'T'},{number:'2',net:'ENABLE',side:'B'}]},
 {ref:'R16',value:'133K',kind:'resistor',position:{x:62,y:71},pins:[{number:'1',net:'SELECT',side:'T'},{number:'2',net:'GND',side:'B'}]},
 ...[{ref:'C8',value:'10uF',x:7,y:37,net:'VSTOR'},{ref:'C9',value:'100nF',x:72,y:55,net:'+3V0'},{ref:'C11',value:'10uF',x:82,y:55,net:'+3V0'}].map(c=>({ref:c.ref,value:c.value,kind:'capacitor',position:{x:c.x,y:c.y},pins:[{number:'1',net:c.net,side:'T' as const},{number:'2',net:'GND',side:'B' as const}]})),
 ...[{ref:'TP7',x:65,y:42},{ref:'TP18',x:95,y:40}].map(c=>({ref:c.ref,value:'+3V0',kind:'testpoint',position:{x:c.x,y:c.y},pins:[{number:'1',net:'+3V0',side:'B' as const}]}))
]};
it('preserves source values, placement, pin sides, testpoints and all six networks',()=>{
 const r=generateSchematic(source),nl=buildNetlist(r.sheet);
 const expected: Record<string,string[]>={VSTOR:['C8.1','L2.1','R15.1','U3.5'],ENABLE:['R15.2','U3.6'],LX:['L2.2','U3.2'],'+3V0':['C9.1','C11.1','TP7.1','TP18.1','U3.1'],SELECT:['R16.1','U3.4'],GND:['C8.2','C9.2','C11.2','R16.2','U3.3']};
 for(const [name,pins] of Object.entries(expected))expect(nl.nets.find(n=>n.name===name)?.pins.map(p=>`${p.ref}.${p.pinNumber}`).sort()).toEqual(pins.sort());
 const part=(ref:string)=>r.sheet.components.find(c=>c.ref===ref)!;
 expect(part('R15').value).toBe('39M');expect(part('R16').value).toBe('133K');
 expect(part('C8').x).toBeLessThan(part('U3').x);expect(part('L2').y).toBeLessThan(part('U3').y);
 expect(getSymbol(part('L2').symbolId).graphic).toBe('shapes');expect(part('L2').rotation).toBe(270);
 expect(getSymbol(part('U3').symbolId).pins.find(p=>p.number==='3')?.side).toBe('B');
 expect(getSymbol(part('TP7').symbolId).width).toBe(200);
 expect(r.sheet.graphics).toHaveLength(2);
 const notes=r.sheet.graphics.filter((g): g is Extract<typeof g,{kind:'text'}> => g.kind==='text');
 expect(notes).toHaveLength(2);expect(notes[0].y).not.toBe(notes[1].y);
 expect(r.sheet.wires.length).toBeGreaterThan(r.stats.labeledPins);
});
it('does not merge separate analog/digital ground labels',()=>{
 const r=generateSchematic({preserveNetNames:true,components:[{ref:'R1',kind:'resistor',pins:[{number:'1',net:'AGND'},{number:'2',net:'DGND'}]}]});
 expect(buildNetlist(r.sheet).nets.map(n=>n.name).sort()).toEqual(['AGND','DGND']);
});
it('rejects duplicates and spatial shorts before returning a generated sheet',()=>{
 expect(()=>generateSchematic({components:[source.components[0],source.components[0]]})).toThrow('duplicate reference');
 expect(()=>generateSchematic({components:[{ref:'R1',pins:[{number:'1'},{number:'1'}]}]})).toThrow('duplicate pins');
 expect(()=>generateSchematic({preserveNetNames:true,components:['A','B'].map((net,i)=>({ref:`R${i+1}`,kind:'resistor',position:{x:20,y:20},pins:[{number:'1',net},{number:'2',net:'GND'}]}))})).toThrow('net mismatch');
});
