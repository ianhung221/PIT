import { classifyPhysicalContact, type PhysicalContact, type ContactClassification } from './pitContact.ts';
export const CONTACT_EPISODE={window:.5,separation:.1} as const;
export interface ContactEpisode {
  startedAt:number;lastAt:number;status:'observing'|'evaluating'|'locked'|'expired'|'done';
  classification:ContactClassification;counted:boolean;diagnosticId:number;
}
export const makeContactEpisodes=()=>({current:null as ContactEpisode|null});
export function observeContactEpisode(state:ReturnType<typeof makeContactEpisodes>,contact:PhysicalContact|null,at:number,pending=false) {
  if(state.current&&at-state.current.lastAt>=CONTACT_EPISODE.separation-1e-8) state.current=null;
  const result={started:false,damage:false,promoted:false,unsafe:false,countAttempt:false,changed:false,assessment:contact?classifyPhysicalContact(contact):null};
  if(!contact) return result;
  if(!state.current) {
    state.current={startedAt:at,lastAt:at,status:pending?'done':'observing',classification:'scrape',counted:false,diagnosticId:0};
    if(pending)return result;
    result.started=true;result.damage=true;result.changed=true;
  }
  const e=state.current;e.lastAt=at;
  if(!e.diagnosticId&&!result.started&&e.status==='done') return result;
  const classification=result.assessment!.classification;
  if(e.status==='locked')return result;
  if(classification==='unsafe'||classification==='excessive') {
    e.status='locked';e.classification=classification;
    result.unsafe=true;result.changed=true;result.countAttempt=!e.counted;e.counted=true;
    return result;
  }
  if(e.status!=='observing')return result;
  if(at-e.startedAt>CONTACT_EPISODE.window+1e-8) {
    e.status='expired';result.changed=true;return result;
  }
  if(classification==='effective') {
    e.status='evaluating';e.classification=classification;e.counted=true;
    result.promoted=true;result.changed=true;result.countAttempt=true;
  }
  return result;
}
export function finishContactEpisode(state:ReturnType<typeof makeContactEpisodes>) {
  if(state.current?.status==='evaluating')state.current.status='done';
}
