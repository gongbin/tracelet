import {render,screen,cleanup} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {createProject} from '@tracelet/kernel';
import {EngineeringReport} from '../src/components/EngineeringReport';
import {useApp} from '../src/store/app';
import {usePrefs} from '../src/i18n';
afterEach(()=>{cleanup();useApp.getState().closeProject();});
it('renders missing evidence and empty-board blockers without a perfect score',()=>{
 usePrefs.getState().setLocale('en');useApp.getState().openProjectObject(createProject({name:'Report fixture'}));
 render(<EngineeringReport/>);
 expect(screen.getByText('Engineering assessment')).toBeTruthy();
 expect(screen.getAllByText('Unassessed')).toHaveLength(6);
 expect(screen.getByText(/Blocking checks: empty/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'Export report JSON'})).toBeTruthy();
});

import {createDemoProject} from '@tracelet/kernel';
import {fireEvent} from '@testing-library/react';
import {getAnalysis} from '../src/store/analysis';
it('navigates from an ERC finding to its schematic sheet',()=>{
 usePrefs.getState().setLocale('en');const p=createDemoProject();useApp.getState().openProjectObject(p);useApp.getState().go('fab');
 const expected=getAnalysis(p).erc.items[0];expect(expected).toBeTruthy();
 render(<EngineeringReport/>);
 fireEvent.click(screen.getByText(/View ERC findings/));
 fireEvent.click(screen.getAllByRole('button',{name:'View in schematic'})[0]);
 expect(useApp.getState().screen).toBe('sch');expect(useApp.getState().checkHighlight).toBe(expected.id);
 if(expected.sheetId)expect(useApp.getState().sheetId).toBe(expected.sheetId);
});
