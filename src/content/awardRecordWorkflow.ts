import {awardProjectionResponseSchema,type AwardProjectionResponse} from '../profile/awardProjection';
import {createAwardRecordSession} from './awardRecordSession';
import {captureAwardPresencePreparation,awardWorkflowAvailability} from './awardPresencePreparation';
import {RecordWorkflow,type ProjectionLoader,type RecordSessionFactory} from './recordWorkflow';
/** Page-local award lifecycle; runtime entry and Agent ownership are enforced by the content dispatcher. */
export class AwardRecordWorkflow extends RecordWorkflow<AwardProjectionResponse>{
  constructor(doc:Document,load:ProjectionLoader<AwardProjectionResponse>,factory:RecordSessionFactory<AwardProjectionResponse>=createAwardRecordSession){
    super(doc,load,factory,{availability:awardWorkflowAvailability,capturePreparation:captureAwardPresencePreparation,prepare:supplied=>{
      const parsed=awardProjectionResponseSchema.safeParse(supplied);
      return parsed.success?{success:true,data:parsed.data,count:parsed.data.awards.length}:{success:false};
    }});
  }
}
