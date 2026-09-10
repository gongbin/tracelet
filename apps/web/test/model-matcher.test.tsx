import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import * as THREE from 'three';
import { createDemoProject, parseProject, serializeProject } from '@tracelet/kernel';
import { ModelMatcher } from '../src/editors/three/ModelMatcher';
import { modelFor, catalogModel, approximateCatalogKey } from '../src/editors/three/models';
import { modelSearchLinks, modelSearchTerm } from '../src/editors/three/modelSearch';
import { useApp } from '../src/store/app';
import { usePrefs, LOCALES } from '../src/i18n';
import { DICTS } from '../src/i18n/catalog';
import { zhCN } from '../src/i18n/zh-CN';
const { importFile, load }=vi.hoisted(()=>({importFile:vi.fn(),load:vi.fn()}));
vi.mock('../src/editors/three/importModel',()=>({importModelFile:importFile}));
vi.mock('../src/editors/three/ModelPreview',async original=>({...await original<typeof import('../src/editors/three/ModelPreview')>(),ModelPreview:()=> <div>WebGL preview</div>}));
vi.mock('../src/editors/three/models',async original=>({...await original<typeof import('../src/editors/three/models')>(),loadModel:load}));
beforeEach(()=>{usePrefs.getState().setLocale('en');load.mockImplementation(async()=>{const g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(.01,.005,.006),new THREE.MeshStandardMaterial()));return g;});useApp.getState().openProjectObject(createDemoProject());});
afterEach(()=>{cleanup();useApp.getState().closeProject();vi.clearAllMocks();});

it('offers similar connector names as candidates without automatically assigning them',()=>{
 const project=createDemoProject(),f={...project.board.footprints[0],footprintId:'test:USB_C_Receptacle_UnknownVendor'};
 expect(approximateCatalogKey('USB_C_Receptacle_UnknownVendor')).toBeDefined();expect(modelFor(f,project.board)).toBeUndefined();
 expect(catalogModel(f,'USB_C_Receptacle_GCT_USB4085').provenance?.kind).toBe('approximate');
});
it('uses explicit MPN and safely encodes external search URLs',()=>{
 const p=createDemoProject(),c=p.schematic.sheets[0].components[0],f=p.board.footprints.find(f=>f.componentId===c.id)!;
 c.props.MPN='USB/ABC & 123';expect(modelSearchTerm(f,p)).toBe(c.props.MPN);
 for(const link of modelSearchLinks(c.props.MPN)){const url=new URL(link.url);expect(url.protocol).toBe('https:');expect([...url.searchParams.values()].join(' ')).toContain(c.props.MPN);}
});
it('stages calibration and cancels without modifying the project',async()=>{
 const editor=useApp.getState().editor!,before=serializeProject(editor.project),close=vi.fn(),ui=render(<ModelMatcher close={close}/>);
 await waitFor(()=>expect(ui.getByRole('button',{name:'Center on body XY'}).hasAttribute('disabled')).toBe(false));
 fireEvent.change(ui.getByRole('spinbutton',{name:'Offset mm X'}),{target:{value:'1.5'}});
 expect(serializeProject(editor.project)).toBe(before);fireEvent.click(ui.getByRole('button',{name:'Cancel'}));expect(close).toHaveBeenCalled();expect(serializeProject(editor.project)).toBe(before);
});
it('allows intermediate numeric input without silently changing an offset to zero',async()=>{
 const ui=render(<ModelMatcher close={()=>{}}/>);
 const x=ui.getByRole('spinbutton',{name:'Offset mm X'}) as HTMLInputElement;
 fireEvent.change(x,{target:{value:'2'}});fireEvent.change(x,{target:{value:''}});expect(x.value).toBe('');
 fireEvent.blur(x);expect(x.value).toBe('2');
 fireEvent.change(x,{target:{value:'-1.25'}});expect(x.value).toBe('-1.25');
});
it('requires approximate candidate review and commits calibration in one undoable operation',async()=>{
 const editor=useApp.getState().editor!,before=serializeProject(editor.project),f=editor.project.board.footprints[0],close=vi.fn(),ui=render(<ModelMatcher close={close}/>);
 fireEvent.change(ui.getAllByRole('combobox')[1],{target:{value:'USB_C_Receptacle_GCT_USB4085'}});
 await waitFor(()=>expect(ui.getByRole('button',{name:'Center on body XY'}).hasAttribute('disabled')).toBe(false));
 fireEvent.change(ui.getByRole('spinbutton',{name:'Offset mm X'}),{target:{value:'2'}});
 expect(ui.getByRole('button',{name:'Apply and save'}).hasAttribute('disabled')).toBe(true);
 fireEvent.click(ui.getByRole('checkbox',{name:/I checked/}));fireEvent.click(ui.getByRole('button',{name:'Apply and save'}));
 expect(close).toHaveBeenCalled();const assigned=parseProject(serializeProject(editor.project)).board.models3d?.[f.footprintId];
 expect(assigned?.offset[0]).toBe(2);expect(assigned?.provenance?.kind).toBe('approximate');expect(assigned?.provenance?.reviewedAt).toBeTruthy();
 editor.undo();expect(serializeProject(editor.project)).toBe(before);
});
it('does not apply an imported model to a different footprint after switching',async()=>{
 let complete!:(v:unknown)=>void;
 importFile.mockImplementation((_file,_signal,progress)=>{progress('convert');return new Promise(resolve=>{complete=resolve;});});
 const ed=useApp.getState().editor!,before=serializeProject(ed.project),ui=render(<ModelMatcher close={()=>{}}/>);
 const file=new File(['ISO-10303-21;'],'model.step');fireEvent.change(ui.getByLabelText('Import STEP / GLB'),{target:{files:[file]}});
 expect(ui.getByRole('button',{name:'Import STEP / GLB'}).hasAttribute('disabled')).toBe(true);
 const signal=importFile.mock.calls[0][1];fireEvent.change(ui.getByRole('combobox',{name:'Footprint'}),{target:{value:ed.project.board.footprints[1].footprintId}});
 expect(signal.aborted).toBe(true);complete({name:'late',source:'catalog:R_0402',scale:1000,offset:[0,0,0],rotation:[0,0,0]});
 await waitFor(()=>expect(ui.queryByText('late')).toBeNull());expect(serializeProject(ed.project)).toBe(before);
});
it('keeps model source, fingerprint and calibration on project round trip',()=>{
 const p=createDemoProject(),f=p.board.footprints[0];
 const model={...catalogModel(f,'R_0402'),provenance:{kind:'import' as const,format:'step' as const,source:'https://manufacturer.example/model',license:'vendor',sha256:'a'.repeat(64),reviewedAt:'2026-09-10T00:00:00.000Z'}};
 p.board.models3d={[f.footprintId]:model};expect(parseProject(serializeProject(p)).board.models3d?.[f.footprintId]).toEqual(model);
});
it('provides explicit translations for model matching in every supported language',()=>{
 const keys=Object.keys(zhCN).filter(k=>k.startsWith('models.')) as (keyof typeof zhCN)[];
 for(const l of LOCALES)for(const k of keys)expect(DICTS[l][k],`${l}:${k}`).toBeTruthy();
});
