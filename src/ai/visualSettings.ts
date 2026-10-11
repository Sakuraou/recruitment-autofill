import { z } from 'zod';
import { hasAiRequestConsent } from './connection';
import { isExtensionContext } from '../profile/storage';
export const VISUAL_SETTINGS_KEY='recruitment.visual.consent.v1';
export const visualConsentSchema=z.object({version:z.literal(1),enabled:z.literal(true),userConfirmed:z.literal(true)}).strict();
export function hasVisualRequestConsent(connection:unknown,visual:unknown):boolean{return hasAiRequestConsent(connection)&&visualConsentSchema.safeParse(visual).success}
export async function loadVisualConsent():Promise<unknown>{if(!isExtensionContext())return undefined;const data=await chrome.storage.local.get(VISUAL_SETTINGS_KEY);const parsed=visualConsentSchema.safeParse(data[VISUAL_SETTINGS_KEY]);return parsed.success?parsed.data:undefined}
/** Separate local opt-in for redacted screenshots; enabling text AI alone grants no visual requests. */
export async function setVisualConsent(enabled:boolean,userConfirmed=false):Promise<void>{if(!isExtensionContext())throw Error('请在扩展设置中操作');if(!enabled){await chrome.storage.local.remove(VISUAL_SETTINGS_KEY);return}if(!userConfirmed)throw Error('启用局部截图识别前须确认请求范围');await chrome.storage.local.set({[VISUAL_SETTINGS_KEY]:{version:1,enabled:true,userConfirmed:true}})}
