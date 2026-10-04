import { createRecordSemanticPortHandler, type RecordSemanticPortDependencies } from './recordSemanticPort';
export function createInternshipSemanticPortHandler(dependencies?: RecordSemanticPortDependencies) { return createRecordSemanticPortHandler(dependencies, 'internship'); }
