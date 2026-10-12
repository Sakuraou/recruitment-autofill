import { expect, it, vi } from 'vitest';
import { STUDENT_WORK_SEMANTIC_BINDING_PATHS, STUDENT_WORK_SEMANTIC_BINDING_FORMAT, semanticRequestSchema, parseSemanticProposal, type SemanticRequest } from '../src/ai/semanticProtocol';
import { studentWorkSemanticRequestSchema } from '../src/ai/studentWorkPortProtocol';
import { createChatCompletionsProvider } from '../src/companion/chatCompletionsProvider';
import { createResponsesProvider } from '../src/companion/responsesProvider';
const request=():SemanticRequest=>({protocol:6,requestId:crypto.randomUUID(),allowedPaths:[...STUDENT_WORK_SEMANTIC_BINDING_PATHS],fields:[{ref:'field-0',fingerprint:'0123456789abcdef',kind:'input',type:'text',section:'student-work',record:'creating',label:'这段校园经历中的头衔是啥',ariaLabel:'',tableHeader:'',title:'',placeholder:'',options:[]}]});
const answer=(value:SemanticRequest,path='studentWork.role')=>({requestId:value.requestId,status:'mapped',bindings:[{ref:'field-0',fingerprint:'0123456789abcdef',path,certainty:'certain',evidence:'label'}]});
it('only offers nine logical meanings in a creating studentWork editor and does not widen the old protocol',()=>{
 const value=request();expect(semanticRequestSchema.safeParse(value).success).toBe(true);
 expect(studentWorkSemanticRequestSchema.safeParse({type:'RA_STUDENT_WORK_SEMANTIC',request:value}).success).toBe(true);
 for(const mode of ['protocol','section','record','catalogue','reference','profile','index']){
  const candidate=structuredClone(value);
  if(mode==='protocol')Object.assign(candidate,{protocol:1});
  if(mode==='section')candidate.fields[0]!.section='basic';
  if(mode==='record')candidate.fields[0]!.record='none';
  if(mode==='catalogue')candidate.allowedPaths.reverse();
  if(mode==='reference')candidate.fields[0]!.ref='field-1';
  if(mode==='profile')Object.assign(candidate,{profile:{name:'private'}});
  if(mode==='index')Object.assign(candidate,{intentIndex:0});
  expect(semanticRequestSchema.safeParse(candidate).success).toBe(false);
 }
 for(const path of ['basic.name','studentWork.0.role','studentWork.id','projects.name'])expect(parseSemanticProposal(answer(value,path),value)).toBeUndefined();
 expect(parseSemanticProposal({...answer(value),value:'personal answer'},value)).toBeUndefined();
});
it.each(['json_object','json_schema'] as const)('compatible %s provider sends the studentWork-only schema and accepts no answer/action fields',async outputFormat=>{
 const value=request(),proposal=answer(value),fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(proposal)}}]})));
 const provider=createChatCompletionsProvider({baseUrl:'https://fictional.invalid/v1',apiKey:'fictional',model:'fictional',outputFormat,fetcher})!;
 expect(await provider(value,new AbortController().signal)).toEqual({state:'ready',proposal});
 const body=JSON.parse(fetcher.mock.calls[0]![1].body);expect(body.messages[0].content).toContain('infer cadre identity');
 expect(body.messages[0].content).toContain(JSON.stringify(STUDENT_WORK_SEMANTIC_BINDING_FORMAT.schema));
 expect(body.messages[1].content).toBe(JSON.stringify(value));expect(body.tools).toBeUndefined();
 if(outputFormat==='json_schema')expect(body.response_format.json_schema.schema.properties.bindings.items.properties.path.enum).toEqual([...STUDENT_WORK_SEMANTIC_BINDING_PATHS]);
});
it('the existing Responses transport also uses the separate studentWork catalogue',async()=>{
 const value=request(),proposal=answer(value),fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({status:'completed',output:[{type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(proposal)}]}]})));
 expect(await createResponsesProvider({apiKey:'fictional',model:'fictional',fetcher})!(value,new AbortController().signal)).toEqual({state:'ready',proposal});
 expect(JSON.parse(fetcher.mock.calls[0]![1].body).text.format).toEqual(STUDENT_WORK_SEMANTIC_BINDING_FORMAT);
});
