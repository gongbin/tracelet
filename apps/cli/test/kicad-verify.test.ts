import {it,expect,vi,afterEach} from 'vitest';
import {writeFileSync} from 'node:fs';
vi.mock('node:child_process',()=>({spawnSync:vi.fn()}));
import {spawnSync} from 'node:child_process';
import {verifyKicad} from '../src/kicadVerify.js';
afterEach(()=>vi.resetAllMocks());
function cli(unconnected:number,status:number){
 vi.mocked(spawnSync).mockImplementation((_binary,args)=>{
  const a=args as string[];
  if(a.includes('--version'))return {status:0,stdout:'10.0.6',stderr:''} as any;
  if(a.includes('--help'))return {status:0,stdout:'--refill-zones --exit-code-violations --schematic-parity',stderr:''} as any;
  expect(a).not.toContain('--save-board');
  writeFileSync(a[a.indexOf('--output')+1],JSON.stringify({violations:[],unconnected_items:Array(unconnected).fill({}),schematic_parity:[]}));
  return {status,stdout:'',stderr:''} as any;
 });
}
it('refuses a clean process exit when the report contains unconnected copper',()=>{
 cli(1,0);expect(verifyKicad('/tmp/example.kicad_pcb','kicad-cli',true).passed).toBe(false);
});
it('accepts only a clean report and successful process, without saving the board',()=>{
 cli(0,0);expect(verifyKicad('/tmp/example.kicad_pcb','kicad-cli',true).passed).toBe(true);
});
it('reports missing KiCad as an execution error, not a clean board',()=>{
 vi.mocked(spawnSync).mockReturnValue({status:null,error:new Error('ENOENT')} as any);
 expect(()=>verifyKicad('/tmp/example.kicad_pcb')).toThrow('unavailable');
});
