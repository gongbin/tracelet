import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {createProject} from '@tracelet/kernel';
import {useApp} from '../src/store/app';
import {usePrefs} from '../src/i18n';
import {LibraryPanel} from '../src/panels/LibraryPanel';
afterEach(()=>{cleanup();useApp.getState().closeProject();});
it('offers solid and open test points as direct schematic placement actions',()=>{
 usePrefs.getState().setLocale('zh-CN');
 useApp.getState().openProjectObject(createProject({name:'Test point UI'}));
 render(<LibraryPanel/>);
 for(const [label,id] of [['测试点（实心）','sym:TP'],['测试点（空心）','sym:TP_Open']]){
  fireEvent.click(screen.getByRole('button',{name:new RegExp(label.replace(/[（）]/g,'\\$&'))}));
  expect(useApp.getState().placing?.symbolId).toBe(id);
 }
});
