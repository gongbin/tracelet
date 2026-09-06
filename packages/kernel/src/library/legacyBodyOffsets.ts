import type { FootprintDef } from '../model/board.js';

// Verified against garage:ESP32-C6-WROOM-1 in the user's original rev-c KiCad PCB.
// F.CrtYd: x [-9.8, 9.8], y [-16.05, 10.55]. Older imports lost its centre.
// Exact pad geometry and dimensions guard against similarly named custom footprints.
const esp32C6Pads = "[[\"1\",-8.75,-8.26,1.5,0.9,0,false],[\"2\",-8.75,-6.99,1.5,0.9,0,false],[\"3\",-8.75,-5.72,1.5,0.9,0,false],[\"4\",-8.75,-4.45,1.5,0.9,0,false],[\"5\",-8.75,-3.18,1.5,0.9,0,false],[\"6\",-8.75,-1.91,1.5,0.9,0,false],[\"7\",-8.75,-0.64,1.5,0.9,0,false],[\"8\",-8.75,0.63,1.5,0.9,0,false],[\"9\",-8.75,1.9,1.5,0.9,0,false],[\"10\",-8.75,3.17,1.5,0.9,0,false],[\"11\",-8.75,4.44,1.5,0.9,0,false],[\"12\",-8.75,5.71,1.5,0.9,0,false],[\"13\",-8.75,6.98,1.5,0.9,0,false],[\"14\",-8.75,8.25,1.5,0.9,0,false],[\"15\",8.75,8.25,1.5,0.9,0,false],[\"16\",8.75,6.98,1.5,0.9,0,false],[\"17\",8.75,5.71,1.5,0.9,0,false],[\"18\",8.75,4.44,1.5,0.9,0,false],[\"19\",8.75,3.17,1.5,0.9,0,false],[\"20\",8.75,1.9,1.5,0.9,0,false],[\"21\",8.75,0.63,1.5,0.9,0,false],[\"22\",8.75,-0.64,1.5,0.9,0,false],[\"23\",8.75,-1.91,1.5,0.9,0,false],[\"24\",8.75,-3.18,1.5,0.9,0,false],[\"25\",8.75,-4.45,1.5,0.9,0,false],[\"26\",8.75,-5.72,1.5,0.9,0,false],[\"27\",8.75,-6.99,1.5,0.9,0,false],[\"28\",8.75,-8.26,1.5,0.9,0,false],[\"29\",-2.755,-3.79,0.8,0.8,0,false],[\"29\",-2.755,-2.54,0.8,0.8,0,false],[\"29\",-2.755,-1.29,0.8,0.8,0,false],[\"29\",-1.505,-3.79,0.8,0.8,0,false],[\"29\",-1.505,-2.54,0.8,0.8,0,false],[\"29\",-1.505,-1.29,0.8,0.8,0,false],[\"29\",-0.255,-3.79,0.8,0.8,0,false],[\"29\",-0.255,-2.54,0.8,0.8,0,false],[\"29\",-0.255,-1.29,0.8,0.8,0,false]]";
export function restoreLegacyBodyOffset(def: FootprintDef): void {
  if (def.body.x !== undefined || def.body.y !== undefined) return;
  if (def.id !== 'fp:kicad:ESP32-C6-WROOM-1' || def.name !== 'ESP32-C6-WROOM-1') return;
  if (Math.abs(def.body.w-19.6)>1e-6 || Math.abs(def.body.h-26.6)>1e-6) return;
  const signature = JSON.stringify(def.pads.map(p=>[p.number,p.x,p.y,p.w,p.h,p.drill,p.npth]));
  if (signature !== esp32C6Pads) return;
  def.body = {...def.body,x:0,y:-2.75};
}
