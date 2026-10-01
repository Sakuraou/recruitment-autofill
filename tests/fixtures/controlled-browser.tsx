import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { scanDocument } from '../../src/content/scanner';
import { fillScan } from '../../src/content/autofill';
import { createControlAdapter } from '../../src/content/controlAdapter';

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
  return { checks, nativeSelect, frame: { status: frameResult.status, realmCorrect } };
}
