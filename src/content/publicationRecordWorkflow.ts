import { publicationProjectionResponseSchema, type PublicationProjectionResponse } from '../profile/publicationProjection';
import { createPublicationRecordSession } from './publicationRecordSession';
import { capturePublicationPresencePreparation, publicationWorkflowAvailability } from './publicationPresencePreparation';
import { RecordWorkflow, type ProjectionLoader, type RecordSessionFactory } from './recordWorkflow';

/** Publication record workflow with guarded local transactions. */
export class PublicationRecordWorkflow extends RecordWorkflow<PublicationProjectionResponse> {
  constructor(doc: Document, load: ProjectionLoader<PublicationProjectionResponse>,
    factory: RecordSessionFactory<PublicationProjectionResponse> = createPublicationRecordSession) {
    super(doc, load, factory, { availability: publicationWorkflowAvailability, capturePreparation: capturePublicationPresencePreparation, prepare: supplied => {
      const parsed = publicationProjectionResponseSchema.safeParse(supplied);
      return parsed.success ? { success: true, data: parsed.data, count: parsed.data.publications.length } : { success: false };
    } });
  }
}
