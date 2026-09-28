import { describe, expect, it } from 'vitest';
import { RecordRunContext, type RecordRunCaptureSource } from '../src/planner/recordRunContext';
import {
  SEMANTIC_GRAPH_SCHEMA_VERSION,
  type PageSemanticGraph,
  type SemanticNode,
} from '../src/shared/semanticGraph';

const fingerprint = '0123456789abcdef';

interface FixtureOptions {
  cards?: readonly Element[];
  editor?: Element;
  list?: Element;
  includeMissingTarget?: boolean;
}

function fixture(options: FixtureOptions = {}) {
  const list = options.list ?? document.createElement('section');
  if (!list.isConnected) document.body.append(list);
  const cards = options.cards ?? [];
  for (const card of cards) list.append(card);
  if (options.editor) list.append(options.editor);

  const recordIds = cards.map((_, index) => `record:${index}`);
  const childIds = [...recordIds];
  const nodes: SemanticNode[] = [
    {
      kind: 'page', id: 'page:0', parentId: null, childIds: ['section:0'], order: 0,
      structuralFingerprint: fingerprint, evidence: [],
    },
    {
      kind: 'section', id: 'section:0', parentId: 'page:0', childIds: ['record-list:0'], order: 0,
      structuralFingerprint: fingerprint, evidence: ['heading'], heading: '项目经历', role: 'project', confidence: 1,
    },
  ];
  cards.forEach((_, index) => nodes.push({
    kind: 'record', id: recordIds[index]!, parentId: 'record-list:0', childIds: [], order: index,
    structuralFingerprint: fingerprint, evidence: ['repeated-structure'], index, state: 'summary',
  }));
  const expectedFieldIds: string[] = [];
  if (options.editor) {
    childIds.push('record:99');
    expectedFieldIds.push('scan:0');
    nodes.push({
      kind: 'record', id: 'record:99', parentId: 'record-list:0', childIds: ['field:99'], order: cards.length,
      structuralFingerprint: fingerprint, evidence: ['editor-actions'], index: cards.length, state: 'creating',
    }, {
      kind: 'field', id: 'field:99', parentId: 'record:99', childIds: [], order: 0,
      structuralFingerprint: fingerprint, evidence: ['visible-label'], fieldId: 'scan:0',
    });
  }
  nodes.push({
    kind: 'record-list', id: 'record-list:0', parentId: 'section:0', childIds, order: 0,
    structuralFingerprint: fingerprint, evidence: ['repeated-structure'], recordType: 'project',
    existingRecordCount: cards.length, editorState: options.editor ? 'creating' : 'closed',
  });
  const targets = new Map<string, Element>([['record-list:0', list]]);
  cards.forEach((card, index) => {
    if (!options.includeMissingTarget || index !== cards.length - 1) targets.set(recordIds[index]!, card);
  });
  if (options.editor) targets.set('record:99', options.editor);
  return {
    source: {
      graph: { schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION, rootId: 'page:0', nodes } satisfies PageSemanticGraph,
      expectedFieldIds,
      semanticTargets: targets,
      recordType: 'project' as const,
      recordListNodeId: 'record-list:0',
    },
    list,
  };
}

function ready(context: RecordRunContext, options: FixtureOptions = {}) {
  const result = context.capture(fixture(options).source);
  if (result.status !== 'ready') throw new Error(`测试捕获失败：${result.reason}`);
  return result;
}

describe('记录运行上下文与 DOM 连续句柄', () => {
  it('每次重扫生成相邻版本和新令牌，结果中不保存 DOM 或字段值', () => {
    document.body.innerHTML = '';
    const card = document.createElement('article');
    card.textContent = '私密项目 sentinel-private-value';
    const context = new RecordRunContext();
    const first = ready(context, { cards: [card] });
    const second = ready(context, { cards: [card], list: card.parentElement! });

    expect(first.runToken).toBe(context.runToken);
    expect(second.runToken).toBe(context.runToken);
    expect(first.snapshotVersion).toBe(1);
    expect(second.snapshotVersion).toBe(2);
    expect(first.snapshotToken).not.toBe(second.snapshotToken);
    expect(first.candidates[0]?.candidateHandle).toBe(second.candidates[0]?.candidateHandle);
    expect(first.candidates[0]?.identityReady).toBe(false);
    const serialized = JSON.stringify([first, second]);
    expect(serialized).not.toContain('sentinel-private-value');
    expect(serialized).not.toContain('HTML');
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.candidates)).toBe(true);
    expect(Object.isFrozen(first.candidates[0])).toBe(true);
  });

  it('卡片重排保持句柄，新卡获得新句柄，离开一轮后重新出现不会复用旧句柄', () => {
    document.body.innerHTML = '';
    const list = document.createElement('section');
    const firstCard = document.createElement('article');
    const secondCard = document.createElement('article');
    const newCard = document.createElement('article');
    const context = new RecordRunContext();
    const initial = ready(context, { list, cards: [firstCard, secondCard] });
    const firstHandle = initial.candidates[0]!.candidateHandle;
    const secondHandle = initial.candidates[1]!.candidateHandle;

    list.replaceChildren(secondCard, firstCard, newCard);
    const reordered = ready(context, { list, cards: [secondCard, firstCard, newCard] });
    expect(reordered.candidates.map(item => item.candidateHandle)).toEqual([secondHandle, firstHandle, 2]);

    list.replaceChildren(firstCard, newCard);
    ready(context, { list, cards: [firstCard, newCard] });
    list.replaceChildren(firstCard, secondCard, newCard);
    const reappeared = ready(context, { list, cards: [firstCard, secondCard, newCard] });
    expect(reappeared.candidates[1]!.candidateHandle).toBe(3);
    expect(reappeared.candidates[1]!.candidateHandle).not.toBe(secondHandle);
  });

  it('列表或卡片 DOM 被替换时不会把旧句柄错误延续给新节点', () => {
    document.body.innerHTML = '';
    const oldList = document.createElement('section');
    const card = document.createElement('article');
    const context = new RecordRunContext();
    const initial = ready(context, { list: oldList, cards: [card] });
    const oldHandle = initial.candidates[0]!.candidateHandle;

    const newList = document.createElement('section');
    oldList.replaceWith(newList);
    newList.append(card);
    const moved = ready(context, { list: newList, cards: [card] });
    expect(moved.candidates[0]!.candidateHandle).not.toBe(oldHandle);

    const replacement = document.createElement('article');
    card.replaceWith(replacement);
    const replaced = ready(context, { list: newList, cards: [replacement] });
    expect(replaced.candidates[0]!.candidateHandle).not.toBe(moved.candidates[0]!.candidateHandle);
  });

  it('编辑器句柄只跟随同一 DOM 实例，字段事件和表单重置只增加修订号', () => {
    document.body.innerHTML = '';
    const form = document.createElement('form');
    const list = document.createElement('section');
    const editor = document.createElement('div');
    const input = document.createElement('input');
    editor.append(input);
    form.append(list);
    document.body.append(form);
    const context = new RecordRunContext();
    const initial = ready(context, { list, editor });
    expect(initial.editorRevision).toBe(0);

    input.dispatchEvent(new Event('input', { bubbles: true }));
    const afterInput = ready(context, { list, editor });
    expect(afterInput.editorCandidate?.editorHandle).toBe(initial.editorCandidate?.editorHandle);
    expect(afterInput.editorRevision).toBe(1);

    input.dispatchEvent(new Event('change', { bubbles: true }));
    form.dispatchEvent(new Event('reset', { bubbles: true }));
    const afterReset = ready(context, { list, editor });
    expect(afterReset.editorRevision).toBe(3);

    const replacement = document.createElement('div');
    replacement.append(document.createElement('input'));
    editor.replaceWith(replacement);
    const replaced = ready(context, { list, editor: replacement });
    expect(replaced.editorCandidate?.editorHandle).not.toBe(initial.editorCandidate?.editorHandle);
    expect(replaced.editorRevision).toBe(0);

    ready(context, { list });
    const reopened = ready(context, { list, editor: replacement });
    expect(reopened.editorCandidate?.editorHandle).not.toBe(replaced.editorCandidate?.editorHandle);
  });

  it('缺失、断连或列表外目标失败关闭，不猜测连续关系', () => {
    document.body.innerHTML = '';
    const list = document.createElement('section');
    const card = document.createElement('article');
    const context = new RecordRunContext();
    expect(context.capture(fixture({ list, cards: [card], includeMissingTarget: true }).source)).toMatchObject({
      status: 'request-human', reason: 'record-target-missing',
    });

    const outside = document.createElement('article');
    document.body.append(outside);
    const outsideFixture = fixture({ list, cards: [card] });
    outsideFixture.source.semanticTargets.set('record:0', outside);
    expect(context.capture(outsideFixture.source)).toMatchObject({
      status: 'request-human', reason: 'record-target-outside-list',
    });

    const secondCard = document.createElement('article');
    const duplicateFixture = fixture({ list, cards: [card, secondCard] });
    duplicateFixture.source.semanticTargets.set('record:1', card);
    expect(context.capture(duplicateFixture.source)).toMatchObject({
      status: 'request-human', reason: 'record-target-ambiguous',
    });

    const disconnectedFixture = fixture({ list, cards: [card] });
    disconnectedFixture.list.remove();
    expect(context.capture(disconnectedFixture.source)).toMatchObject({
      status: 'request-human', reason: 'record-target-disconnected',
    });
  });

  it('畸形来源和抛错的目标表不会越过失败关闭边界', () => {
    document.body.innerHTML = '';
    const context = new RecordRunContext();
    expect(() => context.capture(null as unknown as RecordRunCaptureSource)).not.toThrow();
    expect(context.capture(null as unknown as RecordRunCaptureSource)).toMatchObject({
      status: 'request-human', reason: 'invalid-planner-input',
    });

    const broken = fixture();
    broken.source.semanticTargets = new Proxy(broken.source.semanticTargets, {
      get() { throw new Error('untrusted target map'); },
    });
    expect(() => context.capture(broken.source)).not.toThrow();
    expect(context.capture(broken.source)).toMatchObject({
      status: 'request-human', reason: 'record-target-missing',
    });
  });

  it('档案修订号仅显式递增，开始新步骤会取消旧等待，停止后不能恢复捕获', () => {
    document.body.innerHTML = '';
    const context = new RecordRunContext();
    expect(context.profileRevision).toBe(0);
    expect(context.bumpProfileRevision()).toBe(1);
    const first = context.beginStep();
    expect(first.aborted).toBe(false);
    const second = context.beginStep();
    expect(first.aborted).toBe(true);
    expect(second.aborted).toBe(false);
    context.cancelStep();
    expect(second.aborted).toBe(true);
    const final = context.beginStep();
    context.stop();
    expect(final.aborted).toBe(true);
    expect(context.stopped).toBe(true);
    expect(context.capture(fixture().source)).toMatchObject({ status: 'request-human', reason: 'run-stopped' });
    expect(() => context.beginStep()).toThrow('运行已停止');
    expect(() => context.bumpProfileRevision()).toThrow('运行已停止');
  });
});
