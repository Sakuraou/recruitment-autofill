import { createRecordSemanticPortHandler, type RecordSemanticPortDependencies } from './recordSemanticPort';
export function createProjectSemanticPortHandler(dependencies?: RecordSemanticPortDependencies) {
  return createRecordSemanticPortHandler(dependencies, 'project');
}
