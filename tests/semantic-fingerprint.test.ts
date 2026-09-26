import { describe, expect, it } from 'vitest';
import { structuralFingerprint, type StructuralFingerprintInput } from '../src/content/semantic/structuralFingerprint';

describe('structure-only semantic fingerprints', () => {
  const structure: StructuralFingerprintInput = {
    kind: 'field', tagName: 'input', role: 'textbox', inputType: 'text', siblingIndex: 2,
    framePath: [0], childKinds: [], attributeNames: ['required', 'aria-label'],
  };

  it('is stable for the same allowlisted structure', () => {
    expect(structuralFingerprint(structure)).toBe(structuralFingerprint({ ...structure, attributeNames: ['aria-label', 'required'] }));
    expect(structuralFingerprint(structure)).toMatch(/^[a-f\d]{16}$/u);
  });

  it('ignores runtime personal values, page text and URLs even if an unsafe caller supplies them', () => {
    const first = structuralFingerprint({ ...structure, value: '私密姓名', textContent: '私密项目名', url: 'https://example.invalid/?phone=1' } as StructuralFingerprintInput);
    const second = structuralFingerprint({ ...structure, value: '另一个姓名', textContent: '另一个项目', url: 'https://other.invalid/' } as StructuralFingerprintInput);
    expect(first).toBe(second);
  });

  it('changes when an allowlisted structural property changes', () => {
    expect(structuralFingerprint(structure)).not.toBe(structuralFingerprint({ ...structure, inputType: 'date' }));
  });

  it('ignores dynamic or personal attribute names outside the fixed allowlist', () => {
    expect(structuralFingerprint({ ...structure, attributeNames: ['required', 'data-user-phone'] }))
      .toBe(structuralFingerprint({ ...structure, attributeNames: ['required', 'data-user-other-person'] }));
  });

  it('maps dynamic tag, role and input type tokens to non-identifying buckets', () => {
    expect(structuralFingerprint({ ...structure, tagName: 'person-private-alpha' }))
      .toBe(structuralFingerprint({ ...structure, tagName: 'person-other-secret' }));
    expect(structuralFingerprint({ ...structure, role: 'user-private-alpha' }))
      .toBe(structuralFingerprint({ ...structure, role: 'user-other-secret' }));
    expect(structuralFingerprint({ ...structure, inputType: 'private-alpha' }))
      .toBe(structuralFingerprint({ ...structure, inputType: 'private-other-secret' }));
  });
});
