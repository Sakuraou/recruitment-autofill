import { createRecordSemanticPortHandler, type RecordSemanticPortDependencies } from './recordSemanticPort';
export function createEducationSemanticPortHandler(dependencies?: RecordSemanticPortDependencies) {
  return createRecordSemanticPortHandler(dependencies, 'education');
}
