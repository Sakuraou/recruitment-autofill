import { describe, expect, it } from 'vitest';
import { classifyAction } from '../src/content/semantic/actionClassifier';
import { SEMANTIC_GRAPH_SCHEMA_VERSION, type PageSemanticGraph } from '../src/shared/semanticGraph';
import { semanticGraphProblems } from '../src/shared/semanticGraphValidation';

const fingerprint = '0123456789abcdef';

function fieldGraph(fieldIds: string[], framePath?: number[]): PageSemanticGraph {
  return {
    schemaVersion: SEMANTIC_GRAPH_SCHEMA_VERSION,
    rootId: 'page:0',
    nodes: [
      {
        id: 'page:0', kind: 'page', parentId: null,
        childIds: fieldIds.map((_, index) => `field:${index}`), order: 0,
        structuralFingerprint: fingerprint, evidence: [], framePath,
      },
      ...fieldIds.map((fieldId, index) => ({
        id: `field:${index}`,
        kind: 'field' as const,
        parentId: 'page:0',
        childIds: [],
        order: index,
        structuralFingerprint: fingerprint,
        evidence: [],
        framePath,
        fieldId,
      })),
    ],
  };
}

describe('I-002 semantic graph security gates available before graphBuilder', () => {
  it('treats a button with the browser-default submit type as restricted', () => {
    // graphBuilder must pass the DOM property `button.type`, which is "submit"
    // even when the page omits the HTML type attribute.
    const button = document.createElement('button');
    button.textContent = '保存';

    expect(button.getAttribute('type')).toBeNull();
    expect(button.type).toBe('submit');
    expect(classifyAction({
      accessibleName: button.textContent,
      tagName: button.tagName,
      inputType: button.type,
    })).toMatchObject({ action: 'submit', risk: 'restricted' });
  });

  it.each([
    [{ accessibleName: '最终提交', tagName: 'button', inputType: 'submit' }, 'submit'],
    [{ accessibleName: '删除这段经历', tagName: 'button', inputType: 'button' }, 'delete-record'],
    [{ accessibleName: '上传附件', tagName: 'input', inputType: 'file' }, 'upload'],
  ] as const)('never lowers a dangerous control below restricted: %j', (candidate, action) => {
    expect(classifyAction(candidate)).toMatchObject({ action, risk: 'restricted' });
  });

  it('requires the graph to contain every scanned field exactly once', () => {
    expect(semanticGraphProblems(fieldGraph(['scan:0', 'scan:1']), ['scan:0', 'scan:1']))
      .toHaveLength(0);

    const duplicateCodes = semanticGraphProblems(fieldGraph(['scan:0', 'scan:0']), ['scan:0', 'scan:1'])
      .map(problem => problem.code);
    expect(duplicateCodes).toEqual(expect.arrayContaining(['duplicate-field', 'missing-field']));

    const extraCodes = semanticGraphProblems(fieldGraph(['scan:0', 'scan:private']), ['scan:0'])
      .map(problem => problem.code);
    expect(extraCodes).toContain('unexpected-field');
  });

  it('accepts numeric iframe paths and rejects DOM-derived names in framePath', () => {
    expect(semanticGraphProblems(fieldGraph(['scan:0'], [0, 2]), ['scan:0']))
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'frame-path' })]));

    const unsafe = fieldGraph(['scan:0']) as unknown as {
      nodes: Array<{ framePath?: unknown }>;
    };
    unsafe.nodes[1]!.framePath = ['candidate-private-frame'];
    expect(semanticGraphProblems(unsafe as unknown as PageSemanticGraph, ['scan:0'])
      .map(problem => problem.code)).toContain('frame-path');
  });
});
