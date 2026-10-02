import { educationProjectionResponseSchema, type EducationProjectionResponse } from '../profile/educationProjection';
import { educationFillOrder } from '../profile/educationFillOrder';
import { createEducationRecordSession, educationRecordAvailability } from './educationRecordSession';
import { RecordWorkflow, type ProjectionLoader, type RecordSessionFactory } from './recordWorkflow';

/** Uses the same bounded, cooperative lifecycle as projects, with education-only facts. */
export class EducationRecordWorkflow extends RecordWorkflow<EducationProjectionResponse> {
  constructor(doc: Document, load: ProjectionLoader<EducationProjectionResponse>,
    factory: RecordSessionFactory<EducationProjectionResponse> = createEducationRecordSession) {
    super(doc, load, factory, { availability: educationRecordAvailability, prepare: supplied => {
      const parsed = educationProjectionResponseSchema.safeParse(supplied);
      if (!parsed.success) return { success: false };
      const order = educationFillOrder(parsed.data.education);
      return order.status === 'ready' ? { success: true, data: parsed.data, count: parsed.data.education.length }
        : { success: false, reason: order.reason };
    } });
  }
}
