/** Original explicit HTML labels only. No text, geometry or send permission inferred. */
export function captureControlLabels(node: HTMLInputElement | HTMLTextAreaElement): readonly HTMLLabelElement[] | undefined {
  if (!node.id || node.ownerDocument !== document || node.getRootNode() !== document || !node.isConnected) return undefined;
  const labels = [...(node.labels ?? [])];
  if (labels.length < 1 || labels.length > 4 || labels.some(label => !(label instanceof HTMLLabelElement)
    || label.ownerDocument !== document || label.getRootNode() !== document || !label.isConnected
    || label.htmlFor !== node.id || label.control !== node)) return undefined;
  return Object.freeze(labels);
}

/** The set, document order and every actual label node must still be original. */
export function sameControlLabels(node: HTMLInputElement | HTMLTextAreaElement, labels: readonly HTMLLabelElement[]): boolean {
  const current = captureControlLabels(node);
  return !!current && current.length === labels.length && current.every((label, index) => label === labels[index]);
}
