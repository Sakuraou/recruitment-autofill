import { ariaCheckboxFingerprint, ariaComboboxFingerprint, ariaRadioGroupFingerprint, controlFingerprint,
  describeAriaCheckbox, describeAriaCombobox, describeAriaRadioGroup, describeControl, describeRadioGroup,
  radioGroupFingerprint, type ScannedControl } from './scanner';
import { describeMobileSelect, mobileFingerprint } from './mobileSelect';
import { stableAriaComboboxObservationMatches } from './controlAdapter';

/** Private observation only; do not return its value-bearing fingerprint through messaging or storage. */
export function currentControlFingerprint(control: ScannedControl, id: string): string | undefined {
  if (!control.node.isConnected) return undefined;
  switch (control.adapter) {
    case undefined: return controlFingerprint(control.node, describeControl(control.node, id));
    case 'radio-group': return control.members.every(member => member.isConnected)
      ? radioGroupFingerprint(control.members, describeRadioGroup(control.members, id)) : undefined;
    case 'mobile-select': return mobileFingerprint(control.node, describeMobileSelect(control.node, id));
    case 'aria-combobox': return control.observation && !stableAriaComboboxObservationMatches(control.node, control.observation)
      ? undefined : ariaComboboxFingerprint(control.node, describeAriaCombobox(control.node, id, control.controller), control.controller);
    case 'aria-radio-group': return control.members.every(member => member.isConnected)
      ? ariaRadioGroupFingerprint(control.node, control.members, describeAriaRadioGroup(control.node, control.members, id, control.controller), control.controller) : undefined;
    case 'aria-checkbox': return ariaCheckboxFingerprint(control.node, describeAriaCheckbox(control.node, id, control.controller), control.controller);
  }
}
