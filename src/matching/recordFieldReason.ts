/** Shared factual/formatting reasons; a known value grants no browser action authority. */
export type RecordFieldReason = 'field-semantic-unknown' | 'field-semantic-ambiguous' | 'profile-value-missing'
  | 'profile-date-precision' | 'profile-value-invalid' | 'field-options-unresolved' | 'profile-value-too-long'
  | 'field-unsupported';
