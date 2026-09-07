import { useState } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { scanDocument } from '../src/content/scanner';
import { fillScan } from '../src/content/autofill';

afterEach(cleanup);
it('native setters update React controlled input, textarea and select state without submitting', async () => {
  let submits = 0;
  function ControlledForm() {
    const [name, setName] = useState('');
    const [answer, setAnswer] = useState('');
    const [level, setLevel] = useState('');
    return <form onSubmit={event => { event.preventDefault(); submits++; }}>
      <label>姓名<input value={name} onChange={event => setName(event.target.value)} /></label>
      <label>自我评价<textarea value={answer} onChange={event => setAnswer(event.target.value)} /></label>
      <label>最高学历<select value={level} onChange={event => setLevel(event.target.value)}><option value="">请选择</option><option value="master">硕士</option></select></label>
      <output data-testid="state">{JSON.stringify({ name, answer, level })}</output>
    </form>;
  }
  render(<ControlledForm />);
  const state = scanDocument();
  const values = ['虚构用户', '来自真实档案的原文', 'master'];
  // Each event is flushed as a separate browser turn, matching the content executor.
  for (const [index, field] of state.result.fields.entries()) {
    await act(async () => {
      const outcomes = await fillScan(state, { scanId: state.result.scanId,
        items: [{ fieldId: field.id, value: values[index]!, confirmed: true }] });
      expect(outcomes[0]?.status).toBe('filled');
    });
  }
  expect(JSON.parse(screen.getByTestId('state').textContent!)).toEqual({ name: values[0], answer: values[1], level: values[2] });
  expect(submits).toBe(0);
});
