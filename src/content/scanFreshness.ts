import type { ScanResult } from '../shared/types';
import { scanDocument, type ScanState } from './scanner';

function observation(result: ScanResult): string {
  const ids = new Map(result.fields.map((field, index) => [field.id, `field-${index}`]));
  const groups = new Map<string, number>();
  const fields = result.fields.map(field => {
    if (field.groupId && !groups.has(field.groupId)) groups.set(field.groupId, groups.size);
    return { ...field, id: ids.get(field.id), groupId: field.groupId ? groups.get(field.groupId) : undefined };
  });
  const graph = result.semanticGraph && { ...result.semanticGraph, nodes: result.semanticGraph.nodes.map(node =>
    node.kind === 'field' ? { ...node, fieldId: ids.get(node.fieldId) } : node) };
  return JSON.stringify({ url: result.url, title: result.title, fields, graph, warnings: result.warnings });
}

function fingerprint(value: string, id: string): string {
  return JSON.stringify(JSON.parse(value), (_key, part: unknown) => part === id ? 'field-reference' : part);
}

/** Read-only re-observation. Random scan references change; the actual page nodes must not. */
export function verifyScanObservation(state: ScanState): ScanResult | undefined {
  if (!state.result.semanticGraph || state.document.URL !== state.result.url) return undefined;
  const fresh = scanDocument(state.document);
  if (fresh.controls.size !== state.controls.size || fresh.semanticTargets.size !== state.semanticTargets.size) return undefined;
  const previous = [...state.controls.entries()];
  for (const [index, [id, control]] of [...fresh.controls.entries()].entries()) {
    const [originalId, original] = previous[index]!;
    if (control.node !== original.node || control.adapter !== original.adapter
      || fingerprint(control.fingerprint, id) !== fingerprint(original.fingerprint, originalId)) return undefined;
    if ('members' in control) {
      if (!('members' in original) || control.members.length !== original.members.length
        || control.members.some((member, i) => member !== original.members[i])) return undefined;
    }
  }
  for (const [id, node] of state.semanticTargets) if (fresh.semanticTargets.get(id) !== node) return undefined;
  return observation(state.result) === observation(fresh.result) ? state.result : undefined;
}
