import { afterEach, expect, it } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { createProject, pcb } from '@tracelet/kernel';
import { useApp } from '../src/store/app';
import { usePrefs } from '../src/i18n';
import { AdvancedStackup } from '../src/components/AdvancedStackup';
import { ViaTechnology } from '../src/panels/ViaTechnology';
afterEach(()=>{cleanup();useApp.getState().closeProject();});
it('validates confirmed depths and saves an impedance profile',()=>{
 usePrefs.getState().setLocale('en');useApp.getState().openProjectObject(createProject({name:'advanced',copperCount:6}));
 render(<AdvancedStackup/>);
 fireEvent.change(screen.getByLabelText('Copper depths mm'),{target:{value:'0, .2'}});fireEvent.click(screen.getByText('Save confirmed depths'));expect(screen.getByRole('alert').textContent).toContain('Invalid');
 fireEvent.change(screen.getByLabelText('Copper depths mm'),{target:{value:'0,.2,.5,1,1.3,1.6'}});fireEvent.click(screen.getByText('Save confirmed depths'));
 expect(useApp.getState().editor!.project.board.stackup?.copperDepths).toHaveLength(6);
 fireEvent.click(screen.getByText('Save impedance profile for fabrication'));expect(useApp.getState().editor!.project.board.stackup?.impedanceProfiles?.[0].target).toBe(50);
});
it('applies a blind via as one undoable edit',()=>{
 usePrefs.getState().setLocale('en');useApp.getState().openProjectObject(createProject({name:'via',copperCount:6}));const ed=useApp.getState().editor!;
 ed.dispatch(pcb.addVia({x:10,y:10,size:.6,drill:.3,net:'A'}));const via=ed.project.board.vias[0];
 render(<ViaTechnology via={via}/>);fireEvent.change(screen.getByLabelText('End layer'),{target:{value:'In1.Cu'}});fireEvent.click(screen.getByText('Apply technology'));
 expect(ed.project.board.vias[0].endLayer).toBe('In1.Cu');ed.undo();expect(ed.project.board.vias[0].endLayer).toBeUndefined();
});
