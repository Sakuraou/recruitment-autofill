import {afterEach,expect,it} from 'vitest';
import {awardCardComparator} from '../src/content/awardRecordIdentity';
import type {AwardProjectionEntry} from '../src/profile/awardProjection';
const award:AwardProjectionEntry={id:'award-2022',name:'虚构校级二等奖学金',date:'2022-11-15',school:'虚构大学',issuer:'虚构大学',description:'根据虚构学年评定规则获得校级二等奖学金。'};
function card(body:string){document.body.innerHTML='<article role="listitem">'+body+'</article>';return document.querySelector('article')!;}
const full=()=>`<h3>${award.name}</h3><p>获奖时间：${award.date}</p><p>所在学校：${award.school}</p>`;
afterEach(()=>{document.body.innerHTML='';});
it('exact name, full date and school prove one saved award',()=>{
  const reader=awardCardComparator(card(full()),[award]);expect(reader.ready).toBe(true);
  expect(reader.compare(award)).toEqual({verdict:'same',signals:['primary','start-date','secondary'],provenance:'rule'});
});
it('repeated scholarship names in different years remain distinct records',()=>{
  const other={...award,id:'award-2023',date:'2023-11-15'};const reader=awardCardComparator(card(full()),[award,other]);
  expect(reader.compare(award).verdict).toBe('same');expect(reader.compare(other).verdict).toBe('different');
});
it('explicit award name does not need an unlabeled heading',()=>{
  expect(awardCardComparator(card(`<p>奖励名称：${award.name}</p><p>获奖时间：2022.11.15</p><p>颁奖单位：${award.issuer}</p>`),[award]).compare(award).verdict).toBe('same');
});
it('definition list evidence is read within the current card',()=>{
  expect(awardCardComparator(card(`<dl><dt>奖励名称</dt><dd>${award.name}</dd><dt>获奖日期</dt><dd>2022/11/15</dd><dt>所在学校</dt><dd>${award.school}</dd></dl>`),[award]).compare(award).verdict).toBe('same');
});
it('table summaries can prove the same saved award',()=>{
  expect(awardCardComparator(card(`<table><tr><th>奖励名称</th><td>${award.name}</td></tr><tr><th>获奖日期</th><td>${award.date}</td></tr><tr><th>颁奖单位</th><td>${award.issuer}</td></tr></table>`),[award]).compare(award).verdict).toBe('same');
});
it('name alone cannot skip a source record',()=>{
  expect(awardCardComparator(card(`<h3>${award.name}</h3>`),[award]).compare(award).verdict).toBe('insufficient');
});
it('name and date alone do not establish a unique award',()=>{
  expect(awardCardComparator(card(`<h3>${award.name}</h3><p>获奖时间：${award.date}</p>`),[award]).compare(award).verdict).toBe('insufficient');
});
it('a complete matching description can supply secondary evidence',()=>{
  expect(awardCardComparator(card(`<h3>${award.name}</h3><p>获奖时间：${award.date}</p><p>简要描述：${award.description}</p>`),[award]).compare(award).verdict).toBe('same');
});
it.each(['2022-11','2022-02-30','2022-11-16…'])('incomplete, invalid or clipped page dates remain insufficient: %s',date=>{
  expect(awardCardComparator(card(`<h3>${award.name}</h3><p>获奖时间：${date}</p><p>所在学校：${award.school}</p>`),[award]).compare(award).verdict).toBe('insufficient');
});
it('month-only source dates cannot establish a full-date identity',()=>{
  expect(awardCardComparator(card(full()),[{...award,date:'2022-11'}]).compare({...award,date:'2022-11'}).verdict).toBe('insufficient');
});
it('conflicting school evidence rejects the identity despite matching name and date',()=>{
  expect(awardCardComparator(card(full().replace(award.school!,'另一虚构大学')),[award]).compare(award).verdict).toBe('insufficient');
});
it('conflicting issuer evidence rejects a matching school',()=>{
  expect(awardCardComparator(card(full()+'<p>颁奖单位：其他单位</p>'),[award]).compare(award).verdict).toBe('insufficient');
});
it('duplicate dates on one card are a contradiction',()=>{
  expect(awardCardComparator(card(full()+'<p>获奖日期：2023-11-15</p>'),[award]).compare(award).verdict).toBe('insufficient');
});
it('multiple headings cannot pick a convenient title',()=>{
  expect(awardCardComparator(card(full()+'<h3>另一个标题</h3>'),[award]).ready).toBe(false);
});
it('a school heading is not implicitly a scholarship name',()=>{
  expect(awardCardComparator(card(`<h3>${award.school}</h3><p>获奖时间：${award.date}</p>`),[award]).ready).toBe(false);
});
it('detached and hidden cards cannot supply evidence',()=>{
  const element=card(full());element.hidden=true;expect(awardCardComparator(element,[award]).ready).toBe(false);
  element.hidden=false;element.remove();expect(awardCardComparator(element,[award]).ready).toBe(false);
});
it('nested record and editor text cannot borrow missing secondary evidence',()=>{
  const element=card(`<h3>${award.name}</h3><p>获奖时间：${award.date}</p><article><p>所在学校：${award.school}</p></article><form><p>所在学校：${award.school}</p></form>`);
  expect(awardCardComparator(element,[award]).compare(award).verdict).toBe('insufficient');
});
it('duplicate source IDs make the collection unverified',()=>{
  expect(awardCardComparator(card(full()),[award,award]).ready).toBe(false);
});
it('invalid source calendar data cannot reach same',()=>{
  expect(awardCardComparator(card(full()),[{...award,date:'2022-02-30'}]).ready).toBe(false);
});
it('only value-free results can leave the comparator',()=>{
  const result=awardCardComparator(card(full()),[award]).compare(award);const serialized=JSON.stringify(result);
  for(const value of [award.name,award.school,award.date,award.description])expect(serialized).not.toContain(value);
  expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.signals)).toBe(true);
});
