/** Real stdio MCP + browser live bridge smoke test. Creates a separate test project. */
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const cwd=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const client=new Client({name:'tracelet-live-smoke',version:'1'});
const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','src/index.ts','serve','--mcp','--live','--port','8790'],cwd,stderr:'inherit'});
const report:unknown[]=[];
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function call(name:string,args:Record<string,unknown>={}){
 const r=await client.callTool({name,arguments:args});assert(!r.isError,JSON.stringify(r));
 const content=r.content as {type:string;text:string}[];const text=content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
 let value:any;try{value=JSON.parse(text);}catch{value=text;}
 report.push({tool:name,arguments:args,result:value});console.log(JSON.stringify({tool:name,result:value}));return value;
}
async function waitProject(predicate:(p:any)=>boolean){
 for(let i=0;i<90;i++){
  const r=await client.callTool({name:'list_open_projects',arguments:{}});const data=JSON.parse((r.content as any[])[0].text);
  const p=data.projects.find(predicate);if(p)return p;await sleep(1000);
 }
 throw Error('Timed out waiting for browser project. Enable the local Agent bridge on port 8790.');
}
try{
 await client.connect(transport);const tools=await client.listTools();assert(tools.tools.some(t=>t.name==='optimize_placement'));
 console.log('WAITING_FOR_BROWSER');
 const original=await waitProject(()=>true);console.log(JSON.stringify({original}));
 const name=`MCP 功能验证 ${new Date().toISOString()}`;
 await call('new_project',{name});const project=await waitProject(p=>p.name===name);
 await call('use_project',{id:project.id});
 await call('place_component',{symbol:'sym:R',value:'10k',x:1000,y:2000});
 await call('place_component',{symbol:'sym:C',value:'100n',x:3000,y:2000});
 await call('connect_pins',{a:'R1.2',b:'C1.1'});
 await call('add_net_label',{pin:'R1.1',net:'+3V3'});
 await call('set_component_value',{ref:'R1',value:'4.7k'});
 assert.equal((await call('get_component',{ref:'R1'})).value,'4.7k');
 assert.equal((await call('run_erc')).errors,0);
 await call('sync_to_pcb');await call('set_board_outline',{width:30,height:20});
 await call('move_footprint',{ref:'R1',x:10,y:10});await call('move_footprint',{ref:'C1',x:20,y:10});
 const preview=await call('optimize_placement',{mode:'initial',apply:false});assert.equal(preview.applied,false);assert(!preview.rejected);
 const layout=await call('optimize_placement',{mode:'initial',apply:true});assert(layout.applied);assert.equal(layout.after.outside,0);assert.equal(layout.after.overlaps,0);
 const routed=await call('autoroute');assert(routed.total>0);assert.equal(routed.routed,routed.total);
 const drc=await call('run_drc');assert.equal(drc.unrouted,0);assert.equal(drc.errors,0);
 const before=await call('project_summary');await call('undo');await sleep(1000);
 const undone=await call('project_summary');assert(undone.pcb.traces<before.pcb.traces);
 const again=await call('autoroute');assert.equal(again.routed,again.total);assert.equal((await call('run_drc')).unrouted,0);
 const out=resolve('/tmp/tracelet-mcp-live-smoke');mkdirSync(out,{recursive:true});
 writeFileSync(resolve(out,'report.json'),JSON.stringify({original,testProject:project,checks:report},null,2));
 console.log(JSON.stringify({success:true,testProject:project,original,report:resolve(out,'report.json')}));
 // Leave time for the operator to inspect the browser and restore its bridge preference.
 console.log('READY_FOR_BROWSER_REVIEW');await sleep(60000);
}finally{await client.close();}
