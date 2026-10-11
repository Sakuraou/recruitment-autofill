export interface CssRect {left:number;top:number;width:number;height:number}
export interface ViewportGeometry {width:number;height:number;dpr:number;scrollX:number;scrollY:number;visualScale:number;offsetLeft:number;offsetTop:number}
export interface CropGeometryInput {viewport:ViewportGeometry;image:{width:number;height:number};target:CssRect;masks:readonly CssRect[]}
export type CropGeometryResult=Readonly<{state:'planned';crop:Readonly<CssRect>;masks:readonly Readonly<CssRect>[]} | {state:'rejected';reason:string}>;
const MAX_CAPTURE_PIXELS=16_777_216,MAX_CROP_PIXELS=1_048_576;
const reject=(reason:string):CropGeometryResult=>Object.freeze({state:'rejected',reason});
function exactRecord(value:unknown,keys:readonly string[]):value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const proto=Object.getPrototypeOf(value);if(proto!==Object.prototype&&proto!==null)return false;
 const own=Reflect.ownKeys(value);return own.length===keys.length&&own.every(key=>typeof key==='string'&&keys.includes(key))
  &&keys.every(key=>Object.getOwnPropertyDescriptor(value,key)?.value!==undefined);
}
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&Math.abs(value)<=10_000_000;
function rect(value:unknown):value is CssRect {
 return exactRecord(value,['left','top','width','height'])&&Object.values(value).every(finite)
  &&(value.width as number)>=0&&(value.height as number)>=0;
}
/** Pure numerical planning only. This is not a screenshot or action authority. */
export function planCropGeometry(input:unknown):CropGeometryResult {
 try{
  if(!exactRecord(input,['viewport','image','target','masks'])
   ||!exactRecord(input.viewport,['width','height','dpr','scrollX','scrollY','visualScale','offsetLeft','offsetTop'])
   ||!exactRecord(input.image,['width','height'])||!rect(input.target)||!Array.isArray(input.masks)
   ||Object.values(input.viewport).some(value=>!finite(value)))return reject('invalid-input');
  const viewport=input.viewport as unknown as ViewportGeometry,image=input.image as {width:number;height:number},target=input.target;
  if(viewport.width<1||viewport.height<1||viewport.width>8192||viewport.height>8192||viewport.dpr<0.25||viewport.dpr>8
   ||viewport.visualScale!==1||viewport.offsetLeft!==0||viewport.offsetTop!==0)return reject('unsupported-viewport');
  if(![image.width,image.height].every(value=>finite(value)&&Number.isInteger(value)&&value>=1&&value<=16384))return reject('invalid-image-size');
  if(image.width*image.height>MAX_CAPTURE_PIXELS)return reject('capture-too-large');
  if(Math.abs(image.width-Math.round(viewport.width*viewport.dpr))>1||Math.abs(image.height-Math.round(viewport.height*viewport.dpr))>1)return reject('image-size-mismatch');
  const sx=image.width/viewport.width,sy=image.height/viewport.height;
  if(Math.abs(sx-sy)>1/Math.min(viewport.width,viewport.height))return reject('image-size-mismatch');
  if(target.width<=0||target.height<=0||target.left<0||target.top<0||target.left+target.width>viewport.width||target.top+target.height>viewport.height)return reject('target-not-visible');
  if(input.masks.length>256)return reject('too-many-masks');
  if(Reflect.ownKeys(input.masks).length!==input.masks.length+1)return reject('invalid-masks');
  const masks=Array.from(input.masks) as unknown[];if(!masks.every(rect))return reject('invalid-masks');
  const left=Math.max(0,Math.floor((target.left-12)*sx)),top=Math.max(0,Math.floor((target.top-12)*sy));
  const right=Math.min(image.width,Math.ceil((target.left+target.width+12)*sx)),bottom=Math.min(image.height,Math.ceil((target.top+target.height+12)*sy));
  const crop=Object.freeze({left,top,width:right-left,height:bottom-top});
  if(crop.width*crop.height>MAX_CROP_PIXELS)return reject('crop-too-large');
  const clipped:Readonly<CssRect>[]=[];
  for(const mask of masks){
   if(mask.width===0||mask.height===0)continue;
   // Inflate by one pixel after outward rounding to cover edge antialiasing.
   const ml=Math.max(left,Math.floor(mask.left*sx)-1),mt=Math.max(top,Math.floor(mask.top*sy)-1);
   const mr=Math.min(right,Math.ceil((mask.left+mask.width)*sx)+1),mb=Math.min(bottom,Math.ceil((mask.top+mask.height)*sy)+1);
   if(mr>ml&&mb>mt)clipped.push(Object.freeze({left:ml-left,top:mt-top,width:mr-ml,height:mb-mt}));
  }
  return Object.freeze({state:'planned',crop,masks:Object.freeze(clipped)});
 }catch{return reject('invalid-input');}
}
