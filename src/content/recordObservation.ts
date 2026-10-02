import type { SemanticNode } from '../shared/semanticGraph';
import type { ScanState, ScannedControl } from './scanner';
import { belongsToDocument } from './domUtils';
import { stableAriaComboboxObservationMatches } from './controlAdapter';

function subtree(scan: ScanState, listId: string): readonly SemanticNode[] | undefined {
  const graph = scan.result.semanticGraph;
  if (!graph) return undefined;
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const list = byId.get(listId);
  if (list?.kind !== 'record-list') return undefined;
  const queue = [listId]; const seen = new Set<string>(); const nodes: SemanticNode[] = [];
  while (queue.length && nodes.length < 1500) {
    const id = queue.shift()!;
    if (seen.has(id)) return undefined;
    const node = byId.get(id);
    if (!node) return undefined;
    seen.add(id); nodes.push(node); queue.push(...node.childIds);
  }
  return queue.length ? undefined : nodes;
}

/** Scan-local IDs are metadata; all other private fingerprint state remains exact. */
function comparableFingerprint(control: ScannedControl): string | undefined {
  try {
    const parsed: unknown = JSON.parse(control.fingerprint);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const data = parsed as Record<string, unknown>;
    if (!data.field || typeof data.field !== 'object' || Array.isArray(data.field)) return undefined;
    return JSON.stringify({ ...data, field: { ...data.field, id: undefined, groupId: undefined } });
  } catch { return undefined; }
}

/** Page-local comparison only: no values, hashes or nodes are returned or logged. */
export function recordObservationMatches(previous: ScanState, current: ScanState, listId: string): boolean {
  if (previous.document !== current.document || previous.result.url !== current.result.url
    || current.document.URL !== current.result.url) return false;
  const before = subtree(previous, listId); const after = subtree(current, listId);
  if (!before || !after || before.length !== after.length) return false;
  const byId = new Map(after.map(node => [node.id, node]));
  for (const node of before) {
    const actual = byId.get(node.id);
    const oldTarget = previous.semanticTargets.get(node.id);
    const target = current.semanticTargets.get(node.id);
    if (!actual || target !== oldTarget || !target || !belongsToDocument(target, current.document)) return false;
    // Scrolling changes bounds and rescanning assigns new field IDs. Neither
    // authorizes a changed topology, target instance, action or field state.
    const structural = (entry: SemanticNode): string => JSON.stringify({ ...entry, bounds: undefined,
      ...(entry.kind === 'field' ? { fieldId: undefined } : {}) });
    if (structural(node) !== structural(actual)) return false;
    if (node.kind === 'field' && actual.kind === 'field') {
      const oldControl = previous.controls.get(node.fieldId); const control = current.controls.get(actual.fieldId);
      if (!oldControl || !control || control.node !== oldControl.node || control.adapter !== oldControl.adapter) return false;
      if (oldControl.adapter === 'aria-combobox' && control.adapter === 'aria-combobox' && oldControl.observation
        && (!control.observation || !stableAriaComboboxObservationMatches(control.node, oldControl.observation))) return false;
      if (oldControl.adapter === 'radio-group' && control.adapter === 'radio-group'
        && (oldControl.members.length !== control.members.length
          || oldControl.members.some((member, index) => member !== control.members[index]))) return false;
      const fingerprint = comparableFingerprint(oldControl);
      if (fingerprint === undefined || fingerprint !== comparableFingerprint(control)) return false;
    }
  }
  return true;
}
