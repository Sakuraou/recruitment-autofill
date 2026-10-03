import { internshipProjectionResponseSchema, type InternshipProjectionResponse } from '../profile/internshipProjection';
import { internshipFillOrder } from '../profile/internshipFillOrder';
import { createInternshipRecordSession, internshipRecordAvailability } from './internshipRecordSession';
import { RecordWorkflow, type ProjectionLoader, type RecordSessionFactory } from './recordWorkflow';

/** Uses the same bounded, cooperative lifecycle as projects, with internship-only facts. */
export class InternshipRecordWorkflow extends RecordWorkflow<InternshipProjectionResponse> {
  constructor(doc: Document, load: ProjectionLoader<InternshipProjectionResponse>,
    factory: RecordSessionFactory<InternshipProjectionResponse> = createInternshipRecordSession) {
    super(doc, load, factory, { availability: internshipRecordAvailability, prepare: supplied => {
      const parsed = internshipProjectionResponseSchema.safeParse(supplied);
      if (!parsed.success) return { success: false };
      const order = internshipFillOrder(parsed.data.internships);
      return order.status === 'ready' ? { success: true, data: parsed.data, count: parsed.data.internships.length }
        : { success: false, reason: order.reason };
    } });
  }
}
