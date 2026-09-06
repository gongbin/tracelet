/** Closed-form engineering estimates: TI high-speed layout equations; dimensions in mm.
 * Stripline height is the separation of the two planes, with centered signal copper.
 * Does not model soldermask, roughness, dispersion, differential coupling or plane gaps.
 */
export interface ImpedanceInput { kind:'microstrip'|'stripline'; width:number; height:number; thickness:number; er:number }
export function estimateImpedance(p:ImpedanceInput):number {
 const {width:w,height:h,thickness:t,er}=p;
 if(![w,h,t,er].every(Number.isFinite)||w<=0||h<=0||t<=0||er<1||er>15||t>=h)throw Error('Invalid impedance geometry or dielectric constant');
 const ratio=p.kind==='microstrip'?5.98*h/(.8*w+t):1.9*h/(.8*w+t);
 const z=p.kind==='microstrip'?87/Math.sqrt(er+1.41)*Math.log(ratio):60/Math.sqrt(er)*Math.log(ratio);
 if(!Number.isFinite(z)||z<=0)throw Error('Geometry outside approximation range');
 return z;
}
