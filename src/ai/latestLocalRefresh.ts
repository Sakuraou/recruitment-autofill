/** Latest-only local settings refresh. Invalidation is synchronous, so a revoked opt-in cannot survive an async load. */
export function createLatestLocalRefresh<T>(load:()=>Promise<T>,publish:(state:T|undefined)=>void):()=>Promise<void>{
 let epoch=0;
 return async()=>{const own=++epoch;publish(undefined);let state:T;try{state=await load()}catch{return}if(own===epoch)publish(state)};
}
