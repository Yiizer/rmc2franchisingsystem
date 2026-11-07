// Client-safe (no server imports): the UI and the server share this Philippine mobile rule (feedback round 2026-11-07, item 2).

/** Digits only, a leading 0063 / 63 / 0 dropped; '' unless exactly 10 digits remain. So 0917 123 4567, +63 917-123-4567 and 9171234567 are equal. */
export function phMobileKey(value:string):string{
  const key=(value||'').replace(/\D/g,'').replace(/^(?:0063|63|0)/,'');
  return key.length===10?key:'';
}
/** The client's mobile equals the agent's (the linked Division Head / SOA phone, otherwise the form's agent phone). A warning only; it never blocks anything. */
export function hasSharedMobile(record:{fields:Record<string,string>;ownerAgent?:{phone:string}}):boolean{
  const client=phMobileKey(record.fields.contactPhone||'');
  return !!client&&client===phMobileKey(record.ownerAgent?.phone||record.fields.agentPhone||'');
}
