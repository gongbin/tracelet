import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';

/** Validate an existing KiCad board, never save/refill the source on disk. */
export function verifyKicad(file:string, executable?:string, parity=false){
 const binary=executable??process.env.KICAD_CLI??(process.platform==='darwin'?'/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli':'kicad-cli');
 const version=spawnSync(binary,['--version'],{encoding:'utf8',timeout:10000});
 if(version.error||version.status!==0)throw new Error('KiCad CLI unavailable; supply --kicad <executable>.');
 const help=spawnSync(binary,['pcb','drc','--help'],{encoding:'utf8',timeout:10000});
 const flags=['--refill-zones','--exit-code-violations',...(parity?['--schematic-parity']:[])];
 if(flags.some(f=>!help.stdout?.includes(f)))throw new Error('Installed KiCad does not support the requested validation flags.');
 const dir=mkdtempSync(join(tmpdir(),'tracelet-kicad-'));
 try{
  const output=join(dir,'drc.json');
  const run=spawnSync(binary,['pcb','drc','--format','json','--severity-all',...flags,'--output',output,resolve(file)],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
  if(run.error||run.signal||!existsSync(output)||![0,5].includes(run.status??-1))throw new Error('KiCad validation failed to produce a valid report.');
  const report=JSON.parse(readFileSync(output,'utf8'));
  if(!Array.isArray(report.violations)||!Array.isArray(report.unconnected_items))throw new Error('Unexpected KiCad report schema.');
  const violations=report.violations.length,unconnected=report.unconnected_items.length,parityItems=report.schematic_parity??[];
  if(parity&&!Array.isArray(report.schematic_parity))throw new Error('KiCad did not return the requested parity report.');
  return {version:version.stdout.trim(),source:resolve(file),scope:'Provided KiCad file only; not the current Tracelet editor',zonesRefilled:true,parityChecked:parity,passed:run.status===0&&violations===0&&unconnected===0&&parityItems.length===0,violations,unconnected,parityDiscrepancies:parityItems.length,report};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
