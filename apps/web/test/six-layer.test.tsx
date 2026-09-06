import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { createProject, pcb } from '@tracelet/kernel';
import { LayerCountSelect } from '../src/components/LayerCountSelect';
import { useApp } from '../src/store/app';
import { usePrefs } from '../src/i18n';
afterEach(()=>{cleanup();useApp.getState().closeProject();});
it('switches to six layers and disables destructive reduction',()=>{
 usePrefs.getState().setLocale('en'); useApp.getState().openProjectObject(createProject({name:'Six'}));
 render(<LayerCountSelect/>);
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'6'}});
 const ed=useApp.getState().editor!; expect(ed.project.board.copperCount).toBe(6);
 ed.dispatch(pcb.addTrace({layer:'In4.Cu',net:'A',width:.25,points:[{x:5,y:5},{x:10,y:5}]}).command);
 cleanup(); render(<LayerCountSelect/>);
 expect((screen.getByRole('option',{name:'4 layers'}) as HTMLOptionElement).disabled).toBe(true);
});
