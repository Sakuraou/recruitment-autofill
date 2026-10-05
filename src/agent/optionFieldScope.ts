import type {ScanResult} from '../shared/types';
import { isValidSemanticGraph } from '../shared/semanticGraphValidation';
const repeated=new Set(['education','project','internship','student-work','award','publication','language','skill','family']);
/** Ordinary page work cannot borrow an already-open record editor. */
export function agentOrdinaryFieldIds(scan: ScanResult): ReadonlySet<string> {
  const graph = scan.semanticGraph;
  if (!graph || !isValidSemanticGraph(graph, scan.fields.map(field => field.id))) return new Set();
  const nodes = new Map(graph.nodes.map(node => [node.id, node])); const blocked = new Set<string>();
  for (const node of graph.nodes) if (node.kind === 'field') {
    let parent = node.parentId ? nodes.get(node.parentId) : undefined;
    while (parent) {
      if (parent.kind === 'record' || parent.kind === 'record-list') { blocked.add(node.fieldId); break; }
      parent = parent.parentId ? nodes.get(parent.parentId) : undefined;
    }
  }
  return new Set(scan.fields.filter(field => !blocked.has(field.id)).map(field => field.id));
}
/** Observation cannot borrow a repeatable section whose editor/list was not fully classified. */
export function agentOptionFieldIds(scan:ScanResult):ReadonlySet<string>{
 const allowed=new Set(agentOrdinaryFieldIds(scan)),graph=scan.semanticGraph;
 if(!graph)return new Set();const nodes=new Map(graph.nodes.map(node=>[node.id,node]));
 for(const node of graph.nodes)if(node.kind==='field'&&allowed.has(node.fieldId)){
  let parent=node.parentId?nodes.get(node.parentId):undefined;
  while(parent){if(parent.kind==='section'&&repeated.has(parent.role)){allowed.delete(node.fieldId);break;}parent=parent.parentId?nodes.get(parent.parentId):undefined;}
 }
 return allowed;
}
