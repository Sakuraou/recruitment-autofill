import { awardProjectionEntrySchema, type AwardProjectionEntry } from '../profile/awardProjection';
import { calendarDateBounds } from '../profile/calendarDates';
import type { RecordIdentitySignal, RecordIdentityVerdict } from '../planner/recordPlanner';
import { hiddenReason } from './domUtils';
import { recordSummaryText } from './recordSummaryText';
export interface AwardIdentityResult { readonly verdict:RecordIdentityVerdict;readonly signals:readonly RecordIdentitySignal[];readonly provenance:'rule' }
type Key='name'|'date'|'school'|'issuer'|'description';
type Evidence=Partial<Record<Key,string>>&{heading?:string;conflict?:boolean};
const labels:Readonly<Record<Key,RegExp>>={name:/^(?:奖励名称|获奖名称|奖项名称|award\s*name)$/iu,
  date:/^(?:获奖时间|获奖日期|award\s*date)$/iu,school:/^(?:所在学校|获奖学校|学校名称|school)$/iu,
  issuer:/^(?:颁奖单位|授奖单位|issuer)$/iu,description:/^(?:简要描述|获奖描述|奖励描述|award\s*description)$/iu};
const normal=(value:string|undefined)=>(value??'').normalize('NFKC').replace(/\s+/gu,' ').trim();
const complete=(value:string|undefined):value is string=>!!value?.trim()&&value.length<=20_000&&!/…|\.{3}|请选择|尚未确认/iu.test(value);
function date(value:string|undefined){const found=/^(\d{4})[-/.](\d{2})[-/.](\d{2})$/u.exec(normal(value));
  if(!found)return undefined;const iso=`${found[1]}-${found[2]}-${found[3]}`;return calendarDateBounds(iso)?iso:undefined;}
function evidence(card:Element|undefined):Evidence{
  if(!card?.isConnected||hiddenReason(card))return {};
  if(card.querySelectorAll('dt,tr,p,h1,h2,h3,h4,h5,h6,[role="heading"]').length>1000)return {conflict:true};
  const values:Record<Key,string[]>={name:[],date:[],school:[],issuer:[],description:[]};
  const add=(label:string,value:string)=>{const key=(Object.keys(labels) as Key[]).find(key=>labels[key].test(label.replace(/[:：]\s*$/u,'').trim()));
    if(key&&complete(value))values[key].push(normal(value));};
  for(const term of card.querySelectorAll('dt'))if(term.nextElementSibling?.tagName==='DD')add(recordSummaryText(term,card),recordSummaryText(term.nextElementSibling,card));
  for(const row of card.querySelectorAll('tr')){const cells=[...row.children].filter(cell=>cell.matches('th,td'));if(cells.length===2)add(recordSummaryText(cells[0]!,card),recordSummaryText(cells[1]!,card));}
  for(const paragraph of card.querySelectorAll('p')){const text=recordSummaryText(paragraph,card);const separator=text.search(/[:：]/u);if(separator>0)add(text.slice(0,separator),text.slice(separator+1).trim());}
  const headings=[...card.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')].map(heading=>recordSummaryText(heading,card)).filter(Boolean);
  const result:Evidence={conflict:headings.length>1||headings.some(text=>!complete(text)),...(headings.length===1?{heading:headings[0]}:{})};
  for(const key of Object.keys(values) as Key[]){const distinct=[...new Set(values[key])];if(distinct.length===1)result[key]=distinct[0];if(distinct.length>1)result.conflict=true;}
  return result;
}
function sourceReady(records:readonly AwardProjectionEntry[]){return Array.isArray(records)&&records.length<=100&&new Set(records.map(record=>record.id)).size===records.length
  &&records.every(record=>awardProjectionEntrySchema.safeParse(record).success&&complete(record.name));}
export function awardIdentityFactsReady(award:AwardProjectionEntry):boolean{
  return awardProjectionEntrySchema.safeParse(award).success&&complete(award.name)&&!!date(award.date)
    &&(complete(award.school)||complete(award.issuer)||complete(award.description)&&normal(award.description).length>=12);
}
function resolveHeading(observed:Evidence,records:readonly AwardProjectionEntry[]):Evidence{
  const names=new Set(records.map(record=>normal(record.name)));
  const secondary=new Set(records.flatMap(record=>[record.school,record.issuer,record.level]).filter(complete).map(normal));
  if(!observed.heading||!names.has(observed.heading)||secondary.has(observed.heading))return observed;
  return observed.name&&observed.name!==observed.heading?{...observed,conflict:true}:{...observed,name:observed.heading};
}
function compare(observed:Evidence,award:AwardProjectionEntry):AwardIdentityResult{
  const result=(verdict:RecordIdentityVerdict,signals:RecordIdentitySignal[]):AwardIdentityResult=>Object.freeze({verdict,signals:Object.freeze(signals),provenance:'rule'});
  if(!awardProjectionEntrySchema.safeParse(award).success||observed.conflict||!complete(observed.name)||!complete(award.name))return result('insufficient',[]);
  if(observed.name!==normal(award.name))return result('different',['primary']);
  const actualDate=date(observed.date),expectedDate=date(award.date);
  if(observed.date&&!actualDate)return result('insufficient',['primary']);
  if(!actualDate||!expectedDate)return result('insufficient',['primary']);
  if(actualDate!==expectedDate)return result('different',['primary','start-date']);
  let secondary=false;
  for(const key of ['school','issuer','description'] as const){const expected=normal(award[key]);const actual=observed[key];
    if(complete(expected)&&complete(actual)){
      if(actual!==expected)return result('insufficient',['primary','start-date']);
      if(key!=='description'||expected.length>=12)secondary=true;
    }}
  return secondary?result('same',['primary','start-date','secondary']):result('insufficient',['primary','start-date']);
}
/** Captured visible summary facts stay private; only a value-free verdict may leave this reader. */
export function awardCardComparator(card:Element|undefined,records:readonly AwardProjectionEntry[]):Readonly<{ready:boolean;compare:(award:AwardProjectionEntry)=>AwardIdentityResult}>{
  const observed=sourceReady(records)?resolveHeading(evidence(card),records):{conflict:true};
  return Object.freeze({ready:!observed.conflict&&complete(observed.name),compare:(award:AwardProjectionEntry)=>compare(observed,award)});
}
