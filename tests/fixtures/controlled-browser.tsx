import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { scanDocument } from '../../src/content/scanner';
import { fillScan } from '../../src/content/autofill';
import { createControlAdapter } from '../../src/content/controlAdapter';
import { bindRecordEditor } from '../../src/planner/recordEditorBinder';
import { lifecycle } from './record-editor-context';

type Mode = 'commit' | 'user-choice' | 'replace';

/** Fictional, local-only React form; no profile storage or extension messages. */
function ControlledCombo({ mode, actions }: { mode: Mode; actions: { options: number; submits: number } }) {
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);
  const [value, setValue] = useState('');
  const [replacement, setReplacement] = useState(false);
  const [renders, setRenders] = useState(0);
  useEffect(() => {
    if (!expanded) return;
    const timer = setTimeout(() => {
      if (mode === 'user-choice') setValue('手动答案');
      if (mode === 'replace') setReplacement(true);
      setReady(true);
    }, 25);
    return () => clearTimeout(timer);
  }, [expanded, mode]);
  return <form onSubmit={event => { event.preventDefault(); actions.submits++; }}>
    <button key={replacement ? 'replacement' : 'original'} type="button" role="combobox" aria-label="最高学历"
      aria-valuetext={value || '请选择'} aria-controls="levels" aria-expanded={expanded}
      onClick={() => setExpanded(true)}>{value || '请选择'}</button>
    <div id="levels" role="listbox" hidden={!expanded}>
      {ready && <div role="option" aria-selected={value === '硕士'} onClick={() => {
        actions.options++;
        setTimeout(() => { setValue('硕士'); setExpanded(false); }, 25);
      }}>硕士</div>}
    </div>
    <button type="button" data-rerender onClick={() => setRenders(count => count + 1)}>重绘</button>
    <output data-state>{value}</output><output data-renders>{renders}</output>
    <button type="submit">最终提交</button>
  </form>;
}

function ControlledSelect({ events }: { events: { changes: number } }) {
  const [ready, setReady] = useState(false);
  const [value, setValue] = useState('');
  const [renders, setRenders] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 25);
    return () => clearTimeout(timer);
  }, []);
  return <form>
    <label>最高学历<select value={value} onChange={event => { events.changes++; setValue(event.target.value); }}>
      <option value="">请选择</option>{ready && <option value="master">硕士</option>}
    </select></label>
    <button type="button" data-rerender onClick={() => setRenders(count => count + 1)}>重绘</button>
    <output data-state>{value}</output><output data-renders>{renders}</output>
  </form>;
}

type CheckboxMode = 'false-noop' | 'rollback' | 'rollback-refused';
function ControlledRecord({ mode, actions }: { mode: CheckboxMode; actions: { clicks: number; submits: number } }) {
  const [checked, setChecked] = useState(false);
  const [renders, setRenders] = useState(0);
  return <form onSubmit={event => { event.preventDefault(); actions.submits++; }}>
    <section data-record-list>
      <input aria-label="是否学生干部" type="checkbox" checked={checked}
        onClick={event => { actions.clicks++; if (mode === 'rollback-refused' && actions.clicks > 1) event.preventDefault(); }}
        onChange={event => { if (!event.nativeEvent.defaultPrevented) setChecked(event.target.checked); }} />
      {mode !== 'false-noop' && <input aria-label="项目名称" maxLength={1} />}
    </section>
    <output data-checked>{String(checked)}</output>
    <button type="button" data-rerender onClick={() => setRenders(count => count + 1)}>重绘</button>
    <output data-renders>{renders}</output>
    <button type="submit">最终提交</button>
  </form>;
}

async function recordCheckboxChecks() {
  const checks = [];
  for (const mode of ['false-noop', 'rollback', 'rollback-refused'] as const) {
    document.body.innerHTML = '<main id="fixture"></main>';
    const root = createRoot(document.querySelector('#fixture')!);
    const actions = { clicks: 0, submits: 0 };
    flushSync(() => root.render(<ControlledRecord mode={mode} actions={actions} />));
    const list = document.querySelector<HTMLElement>('[data-record-list]')!;
    const elements = [...list.querySelectorAll('input')];
    const state = lifecycle(elements, undefined, list);
    let saves = 0;
    state.fixture.editor.querySelector('button')!.addEventListener('click', () => { saves++; });
    const result = await bindRecordEditor({
      plan: state.populatePlan, capture: state.editing, activeTransaction: state.active,
      runContext: state.context, scanState: state.fixture.scanState,
      provideValue: ({ fieldNodeId }) => fieldNodeId === 'field:0' ? (mode === 'false-noop' ? '否' : 'true') : '超长值',
      rescan: () => state.context.capture(state.fixture.source),
    });
    (document.querySelector('[data-rerender]') as HTMLButtonElement).click();
    await new Promise(resolve => setTimeout(resolve, 20));
    const expectedChecked = mode === 'rollback-refused';
    checks.push({ mode, status: result.status, reason: result.status === 'request-human' ? result.reason : '',
      rollbackComplete: result.status === 'request-human' ? result.rollbackComplete : true,
      written: result.writtenFieldCount, clicks: actions.clicks, submits: actions.submits, saves,
      retained: elements[0]!.checked === expectedChecked
        && document.querySelector('[data-checked]')!.textContent === String(expectedChecked) });
    state.context.stop();
    flushSync(() => root.unmount());
  }
  return checks;
}

export async function runChecks() {
  const checks: Array<{ mode: string; status: string; optionClicks: number; submits: number; retained: boolean }> = [];
  for (const mode of ['commit', 'user-choice', 'replace'] as const) {
    document.body.innerHTML = '<main id="fixture"></main>';
    const root = createRoot(document.querySelector('#fixture')!);
    const actions = { options: 0, submits: 0 };
    flushSync(() => root.render(<ControlledCombo mode={mode} actions={actions} />));
    const state = scanDocument();
    const field = state.result.fields.find(candidate => candidate.type === 'aria-combobox')!;
    const outcomes = await fillScan(state, { scanId: state.result.scanId,
      items: [{ fieldId: field.id, value: '硕士', confirmed: true }] });
    (document.querySelector('[data-rerender]') as HTMLButtonElement).click();
    await new Promise(resolve => setTimeout(resolve, 20));
    const expected = mode === 'commit' ? '硕士' : mode === 'user-choice' ? '手动答案' : '';
    checks.push({ mode, status: outcomes[0]!.status, optionClicks: actions.options, submits: actions.submits,
      retained: document.querySelector('[data-state]')!.textContent === expected });
    flushSync(() => root.unmount());
  }
  document.body.innerHTML = '<main id="fixture"></main>';
  const root = createRoot(document.querySelector('#fixture')!);
  const events = { changes: 0 };
  flushSync(() => root.render(<ControlledSelect events={events} />));
  const state = scanDocument();
  const outcomes = await fillScan(state, { scanId: state.result.scanId,
    items: [{ fieldId: state.result.fields[0]!.id, value: 'master', confirmed: true }] });
  (document.querySelector('[data-rerender]') as HTMLButtonElement).click();
  await new Promise(resolve => setTimeout(resolve, 20));
  const nativeSelect = { status: outcomes[0]!.status, changes: events.changes,
    retained: document.querySelector('[data-state]')!.textContent === 'master' && document.querySelector('select')!.value === 'master' };
  flushSync(() => root.unmount());

  document.body.innerHTML = '<iframe></iframe>';
  const frame = document.querySelector('iframe')!.contentDocument!;
  frame.body.innerHTML = '<input role="combobox" aria-controls="list"><div id="list" role="listbox"><div role="option">硕士</div></div>';
  const combo = frame.querySelector('input')!;
  let realmCorrect = false;
  frame.querySelector('[role="option"]')!.addEventListener('click', event => {
    realmCorrect = event instanceof frame.defaultView!.MouseEvent;
    combo.value = '硕士';
  });
  const frameResult = await createControlAdapter(combo).write('硕士');
  return { checks, nativeSelect, frame: { status: frameResult.status, realmCorrect }, recordCheckboxes: await recordCheckboxChecks() };
}
