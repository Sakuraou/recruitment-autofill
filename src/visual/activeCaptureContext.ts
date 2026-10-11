import type { ActiveCaptureTab } from './mv3CaptureBackgroundPort';
interface WindowContext { id?:number;type?:string }
interface TabContext {id?:number;windowId:number;active?:boolean;url?:string;pendingUrl?:string;status?:string}
interface Dependencies {revision():number;getBrowserWindow():Promise<WindowContext>;getActiveTabs(windowId:number):Promise<TabContext[]>}
/** Extension action popups can become the last focused window. Capture only the latest normal browser window. */
export async function resolveActiveCaptureContext(deps:Dependencies):Promise<ActiveCaptureTab|undefined>{
 try{const revision=deps.revision(),window=await deps.getBrowserWindow();if(window.type!=='normal'||window.id===undefined||!Number.isSafeInteger(window.id)||window.id<0)return undefined;
 const tabs=await deps.getActiveTabs(window.id),tab=tabs.length===1?tabs[0]:undefined;
 if(revision!==deps.revision()||!tab||tab.id===undefined||!Number.isSafeInteger(tab.id)||tab.id<=0||tab.windowId!==window.id||!tab.active||tab.pendingUrl||tab.status!=='complete'||!tab.url||!/^https?:\/\//u.test(tab.url))return undefined;
 return{tabId:tab.id,windowId:tab.windowId,url:tab.url,revision};}catch{return undefined}
}
