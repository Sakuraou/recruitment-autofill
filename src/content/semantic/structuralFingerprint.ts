export interface StructuralFingerprintInput {
  kind: 'page' | 'section' | 'record-list' | 'record' | 'field' | 'action';
  tagName?: string;
  role?: string;
  inputType?: string;
  siblingIndex?: number;
  framePath?: readonly number[];
  childKinds?: readonly StructuralFingerprintInput['kind'][];
  /** Attribute names only. Values, URLs and page text are deliberately unsupported. */
  attributeNames?: readonly string[];
}

const normalizeToken = (value: string | undefined): string => (value ?? '').trim().toLowerCase();
const allowedTagNames = new Set([
  'a', 'article', 'aside', 'body', 'button', 'dialog', 'div', 'fieldset', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'html', 'input', 'label', 'legend', 'li', 'main', 'nav', 'ol', 'option', 'section', 'select', 'span', 'table', 'tbody',
  'td', 'textarea', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const allowedRoles = new Set([
  'alert', 'alertdialog', 'article', 'banner', 'button', 'cell', 'checkbox', 'columnheader', 'combobox', 'complementary',
  'contentinfo', 'dialog', 'document', 'feed', 'figure', 'form', 'grid', 'gridcell', 'group', 'heading', 'img', 'link',
  'list', 'listbox', 'listitem', 'main', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'navigation',
  'none', 'note', 'option', 'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader',
  'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'switch', 'tab', 'table', 'tablist',
  'tabpanel', 'textbox', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem',
]);
const allowedInputTypes = new Set([
  'button', 'checkbox', 'color', 'date', 'datetime-local', 'email', 'file', 'hidden', 'image', 'month', 'number', 'password',
  'radio', 'range', 'reset', 'search', 'submit', 'tel', 'text', 'time', 'url', 'week',
]);
const allowedAttributeNames = new Set([
  'required', 'disabled', 'readonly', 'multiple', 'role', 'contenteditable',
  'aria-required', 'aria-disabled', 'aria-readonly', 'aria-haspopup', 'aria-expanded',
  'aria-controls', 'aria-selected', 'aria-multiselectable',
]);

const allowlistedToken = (value: string | undefined, allowed: ReadonlySet<string>, fallback: string): string => {
  const normalized = normalizeToken(value);
  if (normalized === '') return '';
  return allowed.has(normalized) ? normalized : fallback;
};

/** Builds an opaque structure-only digest. Extra runtime properties are ignored. */
export function structuralFingerprint(input: StructuralFingerprintInput): string {
  const payload = JSON.stringify({
    kind: input.kind,
    tagName: allowlistedToken(input.tagName, allowedTagNames, 'custom'),
    role: allowlistedToken(input.role, allowedRoles, 'unknown'),
    inputType: allowlistedToken(input.inputType, allowedInputTypes, 'unknown'),
    siblingIndex: Number.isInteger(input.siblingIndex) && (input.siblingIndex ?? -1) >= 0 ? input.siblingIndex : undefined,
    framePath: input.framePath?.filter(part => Number.isInteger(part) && part >= 0).slice(0, 10),
    childKinds: input.childKinds?.slice(0, 100),
    attributeNames: input.attributeNames?.map(normalizeToken).filter(name => allowedAttributeNames.has(name)).sort().slice(0, 50),
  });
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < payload.length; index++) {
    hash ^= BigInt(payload.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}
