import { fieldAliases, contextualAliases, type AliasScope } from '../profile/aliases';
import type { FieldDescriptor } from '../shared/types';
import { containsAlias, normalize } from './confidence';

/** Local evidence only; this does not bind a record or authorize a model/write. */
export function weakMeaningEvidenceAgrees(field: FieldDescriptor, scope: AliasScope, key: string): boolean {
  const primary = [field.label, field.ariaLabel, field.tableHeader].filter(text => text.trim());
  if (!primary.length || primary.some(text => text.length > 180)) return false;
  const dictionary = [...fieldAliases, ...contextualAliases.filter(entry => entry.scope === scope)];
  const agrees = (text: string): boolean => {
    const normalized = normalize(text);
    const hits = dictionary.flatMap(entry => entry.aliases.flatMap(alias => {
      if (!containsAlias(text, alias)) return [];
      const token = normalize(alias); const starts: number[] = [];
      for (let start = normalized.indexOf(token); start >= 0; start = normalized.indexOf(token, start + 1)) starts.push(start);
      return starts.map(start => ({ start, end: start + token.length, scope: entry.scope, key: entry.key }));
    }));
    const maximal = hits.filter(hit => !hits.some(other => other.start <= hit.start && other.end >= hit.end
      && (other.start < hit.start || other.end > hit.end)));
    return maximal.length > 0 && maximal.every(hit => hit.scope === scope && hit.key === key);
  };
  return primary.every(text => agrees(text) && text.normalize('NFKC').split(/\s*(?:[/、;；]|或者|或是|以及|和|与|及|或|\bor\b|\band\b)\s*/iu)
    .every(fragment => !!fragment.trim() && agrees(fragment)));
}
