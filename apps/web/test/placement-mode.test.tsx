import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, act, cleanup, screen, fireEvent } from '@testing-library/react';
import { createDemoProject } from '@tracelet/kernel';
import { PcbCanvas } from '../src/editors/pcb/PcbCanvas';
import { useApp } from '../src/store/app';
import { usePrefs } from '../src/i18n';
class TestWorker {
 static instances: TestWorker[]=[];
 onmessage: ((e:{data:unknown})=>void)|null=null;
 onerror=null; terminate=vi.fn();postMessage=vi.fn();
 constructor(){TestWorker.instances.push(this);}
}
beforeEach(()=>{
 vi.stubGlobal('Worker',TestWorker);TestWorker.instances=[];
 act(()=>{usePrefs.getState().setLocale('en');useApp.getState().openProjectObject(createDemoProject());useApp.getState().go('pcb');useApp.getState().set('placementSeq',0);});
});
afterEach(()=>{cleanup();act(()=>useApp.getState().closeProject());vi.unstubAllGlobals();});
it.each(['Initial placement','Local optimization'])('previews %s with the selected mode and current board',label=>{
 render(<PcbCanvas/>);
 act(()=>useApp.getState().set('placementSeq',1));
 expect(TestWorker.instances).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:label,exact:true}));
 const request=TestWorker.instances[0].postMessage.mock.calls[0][0];
 expect(request.placementOpts.mode).toBe(label==='Initial placement'?'initial':'incremental');
 expect(request.board).toBe(useApp.getState().editor!.project.board);
 expect(useApp.getState().placement.status).toBe('running');
});
it('uses reproducible initial placement iterations and keeps estimated resizing opt-in',()=>{
 render(<PcbCanvas/>);act(()=>useApp.getState().set('placementSeq',1));
 fireEvent.click(screen.getByRole('button',{name:'Initial placement',exact:true}));
 const options=TestWorker.instances[0].postMessage.mock.calls[0][0].placementOpts;
 expect(options).toMatchObject({mode:'initial',iterations:10000,seed:1,estimateOutline:false});
});
it('consumes the placement request so returning to PCB does not reopen the chooser',()=>{
 const first=render(<PcbCanvas/>);
 act(()=>useApp.getState().set('placementSeq',useApp.getState().placementSeq+1));
 expect(screen.getByRole('button',{name:'Initial placement',exact:true})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'Cancel',exact:true}));
 first.unmount();
 render(<PcbCanvas/>);
 expect(screen.queryByRole('button',{name:'Initial placement',exact:true})).toBeNull();
 act(()=>useApp.getState().set('placementSeq',useApp.getState().placementSeq+1));
 expect(screen.getByRole('button',{name:'Initial placement',exact:true})).toBeTruthy();
});
it('handles a placement request made before the PCB canvas mounts once',()=>{
 act(()=>useApp.getState().set('placementSeq',1));
 const first=render(<PcbCanvas/>);
 expect(screen.getByRole('button',{name:'Initial placement',exact:true})).toBeTruthy();
 first.unmount();render(<PcbCanvas/>);
 expect(screen.queryByRole('button',{name:'Initial placement',exact:true})).toBeNull();
});
