import {expect,it} from 'vitest';
import {agentStepRequestSchema,parseAgentStepProposal} from '../src/agent/nextStepProtocol';
const observationRequest=()=>({protocol:1,requestId:crypto.randomUUID(),pending:{fields:1,records:0,blockers:1},tasks:[{ref:'task-0',kind:'observe-options',count:1}],canComplete:false});
it('bounded option observation counts pending fields and grants one offered ref',()=>{
 const raw=observationRequest(),parsed=agentStepRequestSchema.safeParse(raw);expect(parsed.success).toBe(true);if(!parsed.success)return;
 expect(parseAgentStepProposal({requestId:raw.requestId,status:'act',ref:'task-0',reason:'available-task'},parsed.data)?.ref).toBe('task-0');
});
it('observation can coexist with ordinary fields and all six different record categories',()=>{
 const raw=observationRequest();raw.pending.records=6;
 raw.tasks=[...raw.tasks,{ref:'task-1',kind:'fill-visible',count:1},...['education','project','internship','award','publication','student-work'].map((kind,i)=>({ref:`task-${i+2}`,kind:kind+'-records',count:1}))];
 expect(agentStepRequestSchema.safeParse(raw).success).toBe(true);
});
it.each(['no-fields','duplicate','arbitrary-click','no-capability'] as const)('invalid %s cannot authorize an observation',mode=>{
 const raw=observationRequest();if(mode==='no-fields')raw.pending.fields=0;if(mode==='duplicate')raw.tasks.push({...raw.tasks[0]!,ref:'task-1'});if(mode==='arbitrary-click')raw.tasks[0]!.kind='click-button';if(mode==='no-capability')raw.tasks[0]!.count=0;
 expect(agentStepRequestSchema.safeParse(raw).success).toBe(false);
});
it('remaining observed question cannot be waived as completed',()=>{
 const parsed=agentStepRequestSchema.safeParse(observationRequest());expect(parsed.success).toBe(true);if(!parsed.success)return;
 expect(parseAgentStepProposal({requestId:parsed.data.requestId,status:'complete',ref:null,reason:'no-pending-work'},parsed.data)).toBeUndefined();
});
