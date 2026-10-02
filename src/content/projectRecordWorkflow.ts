import { projectProjectionResponseSchema, type ProjectProjectionResponse } from '../profile/projection';
import { createProjectRecordSession, projectRecordAvailability } from './projectRecordSession';
import { RecordWorkflow, type ProjectionLoader, type RecordSessionFactory } from './recordWorkflow';

/** Project-specific facts and semantics on the shared page-local lifecycle. */
export class ProjectRecordWorkflow extends RecordWorkflow<ProjectProjectionResponse> {
  constructor(doc: Document, load: ProjectionLoader<ProjectProjectionResponse>,
    factory: RecordSessionFactory<ProjectProjectionResponse> = createProjectRecordSession) {
    super(doc, load, factory, { availability: projectRecordAvailability, prepare: supplied => {
      const parsed = projectProjectionResponseSchema.safeParse(supplied);
      return parsed.success ? { success: true, data: parsed.data, count: parsed.data.projects.length } : { success: false };
    } });
  }
}
