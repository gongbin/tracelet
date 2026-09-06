"""Convert the explicit standard-footprint catalog using KiCad 10 CLI; no user board is included."""
import json, os, struct, subprocess, tempfile
from pathlib import Path
root=Path(__file__).resolve().parent.parent
models=Path(os.environ.get('KICAD_MODELS','/Applications/KiCad/KiCad.app/Contents/SharedSupport/3dmodels'))
cli=os.environ.get('KICAD_CLI','/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli')
out=root/'apps/web/public/models3d/kicad';out.mkdir(parents=True,exist_ok=True)
catalog=json.loads((root/'scripts/kicad-model-catalog.json').read_text());manifest={}
with tempfile.TemporaryDirectory() as tmp:
 for name,entries in catalog.items():
  if not all((models/e['path']).exists() for e in entries): print('Unavailable:',name);continue
  clauses=[]
  for e in entries:
   clauses.append(f'(model "{models/e["path"]}" (offset (xyz {" ".join(map(str,e["offset"]))})) (scale (xyz {" ".join(map(str,e["scale"]))})) (rotate (xyz {" ".join(map(str,e["rotation"]))})))')
  board=f'''(kicad_pcb (version 20241229) (generator "pcbnew") (general (thickness 1.6))
(layers (0 "F.Cu" signal) (31 "B.Cu" signal) (44 "Edge.Cuts" user)) (setup (pad_to_mask_clearance 0))
(gr_rect (start -20 -20) (end 20 20) (stroke (width 0.05) (type default)) (fill none) (layer "Edge.Cuts"))
(footprint "{name}" (layer "F.Cu") (at 0 0) (property "Reference" "MODEL" (at 0 0) (layer "F.SilkS")) {" ".join(clauses)}))'''
  source=Path(tmp)/'model.kicad_pcb';source.write_text(board);dest=out/(name+'.glb')
  subprocess.run([cli,'pcb','export','glb','--no-board-body','--user-origin','0x0mm','-f','-o',str(dest),str(source)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  data=dest.read_bytes();n=struct.unpack_from('<I',data,12)[0];j=json.loads(data[20:20+n]);binary=data[20+n:]
  for node in j['nodes']:
   if node.get('name')=='MODEL':node['translation']=[0,0,0] # remove dummy PCB surface offset; retain model-local transforms
  j['asset']['extras']={'source':'KiCad standard 3D library','license':'CC-BY-SA-4.0 with KiCad libraries exception','conversion':'STEP tessellated using KiCad; dummy board offset removed'}
  encoded=json.dumps(j,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
  dest.write_bytes(struct.pack('<III',0x46546c67,2,20+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+binary)
  notices=[]
  for e in entries:
   text=(models/e['path']).read_text(errors='replace');notices.append('Source: https://gitlab.com/kicad/libraries/kicad-packages3D/-/blob/master/'+e['path']+'\n'+text[:text.index('FILE_DESCRIPTION') if 'FILE_DESCRIPTION'in text else 3000])
  (out/(name+'.notice.txt')).write_text('\n'.join(notices))
  manifest[name]={'file':name+'.glb','source':entries[0]['path']}
  # 同名标准封装的焊盘区中心 / 尺寸：给"同系列近似"匹配对齐用
  mods=list((models.parent/'footprints').glob(f'*.pretty/{name}.kicad_mod'))
  if mods:
   import re
   pads=re.findall(r'\(pad "[^"]*" (\w+) (\w+)\s*\(at ([-\d.]+) ([-\d.]+)(?: [-\d.]+)?\)\s*\(size ([-\d.]+) ([-\d.]+)\)',mods[0].read_text())
   if pads:
    xs1=[float(p[2])-float(p[4])/2 for p in pads];xs2=[float(p[2])+float(p[4])/2 for p in pads];ys1=[float(p[3])-float(p[5])/2 for p in pads];ys2=[float(p[3])+float(p[5])/2 for p in pads]
    manifest[name]['padCenter']=[round((min(xs1)+max(xs2))/2,3),round((min(ys1)+max(ys2))/2,3)];manifest[name]['padBox']=[round(max(xs2)-min(xs1),2),round(max(ys2)-min(ys1),2)]
(out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Converted',len(manifest),'models')
