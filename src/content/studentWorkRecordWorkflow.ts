import type { StudentWorkProjectionResponse } from '../profile/studentWorkProjection';
import { studentWorkProjectionResponseSchema } from '../profile/studentWorkProjection';
import { createStudentWorkRecordSession } from './studentWorkRecordSession';
import { captureStudentWorkPresencePreparation, studentWorkWorkflowAvailability } from './studentWorkPresencePreparation';
import { RecordWorkflow, type RecordSessionFactory } from './recordWorkflow';
/** Cooperative lifecycle with finite presence preparation and fixed runtime, popup and Agent entry. */
export class StudentWorkRecordWorkflow extends RecordWorkflow<StudentWorkProjectionResponse> {
  constructor(doc: Document, load: () => Promise<StudentWorkProjectionResponse>, factory: RecordSessionFactory<StudentWorkProjectionResponse> = createStudentWorkRecordSession) {
    super(doc, load, factory, {
      availability: studentWorkWorkflowAvailability, capturePreparation: captureStudentWorkPresencePreparation,
      prepare: supplied => {
        const parsed = studentWorkProjectionResponseSchema.safeParse(supplied);
        return parsed.success ? { success: true, data: parsed.data, count: parsed.data.studentWork.length }
          : { success: false, reason: 'profile-projection-invalid' };
      },
    });
  }
}
