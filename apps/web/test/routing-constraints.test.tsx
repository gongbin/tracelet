import {beforeEach,afterEach,it,expect} from 'vitest';
import {render,act,cleanup,screen,fireEvent} from '@testing-library/react';
import {createDemoProject} from '@tracelet/kernel';
import {RoutingConstraints} from '../src/panels/RoutingConstraints';
import {useApp} from '../src/store/app';
import {usePrefs} from '../src/i18n';
beforeEach(()=>act(()=>{usePrefs.getState().setLocale('en');useApp.getState().openProjectObject(createDemoProject());}));
afterEach(()=>{cleanup();act(()=>useApp.getState().closeProject());});
it('persists editable electrical constraints through undo and keeps the last allowed layer',()=>{
 render(<RoutingConstraints/>);
 fireEvent.click(screen.getByText('Default · 0.25 mm'));
 const editor=useApp.getState().editor!;
 fireEvent.change(screen.getAllByLabelText('Maximum total copper length (mm)')[0],{target:{value:'42'}});
 expect(editor.project.board.netClasses[0].maxLength).toBe(42);
 act(()=>editor.undo());expect(editor.project.board.netClasses[0].maxLength).toBeUndefined();
 fireEvent.click(screen.getAllByLabelText('B.Cu')[0]);
 expect(editor.project.board.netClasses[0].allowedLayers).toEqual(['F.Cu']);
 fireEvent.click(screen.getAllByLabelText('F.Cu')[0]);expect(editor.project.board.netClasses[0].allowedLayers).toEqual(['F.Cu']);
 fireEvent.change(screen.getAllByLabelText('Neck-down policy')[0],{target:{value:'off'}});
 expect(editor.project.board.netClasses[0].neckdown?.allowed).toBe(false);
});

it('preserves engineering recommendations when editing other constraints and supports undo',()=>{
 render(<RoutingConstraints/>);const editor=useApp.getState().editor!;
 fireEvent.change(screen.getAllByLabelText('Preferred copper spacing (mm)')[0],{target:{value:'0.8'}});
 expect(editor.project.board.netClasses[0].engineering?.preferredClearance).toBe(.8);
 fireEvent.change(screen.getAllByLabelText('Maximum total copper length (mm)')[0],{target:{value:'42'}});
 expect(editor.project.board.netClasses[0].engineering?.preferredClearance).toBe(.8);
 fireEvent.change(screen.getAllByLabelText('Preferred copper spacing (mm)')[0],{target:{value:''}});
 expect(editor.project.board.netClasses[0].engineering?.preferredClearance).toBeUndefined();
 act(()=>editor.undo());expect(editor.project.board.netClasses[0].engineering?.preferredClearance).toBe(.8);
});
it('edits power assumptions without discarding engineering settings and undoes changes',()=>{
 render(<RoutingConstraints/>);const editor=useApp.getState().editor!;
 fireEvent.click(screen.getAllByLabelText('DC power / thermal estimate')[0]);
 expect(editor.project.board.netClasses[0].power?.thermalResistanceKPerW).toBeUndefined();
 fireEvent.change(screen.getAllByLabelText('Current per net (A)')[0],{target:{value:'2.5'}});
 fireEvent.change(screen.getAllByLabelText('Whole-path thermal resistance (K/W)')[0],{target:{value:'15'}});
 expect(editor.project.board.netClasses[0].power?.currentA).toBe(2.5);
 expect(editor.project.board.netClasses[0].power?.thermalResistanceKPerW).toBe(15);
 act(()=>editor.undo());expect(editor.project.board.netClasses[0].power?.thermalResistanceKPerW).toBeUndefined();
});
