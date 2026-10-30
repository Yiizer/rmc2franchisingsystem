'use client';
import { Download, Flag, Pencil } from 'lucide-react';
import type { CustomizedSnapshot, Staff } from '@/lib/operations/types';
import { manilaTime } from '@/lib/operations/types';
import { staffName } from './operations-common';

export default function CustomReview({snapshot,users,canReview,reviewed,onReviewed,flags,onFlags,originalUrl}:{snapshot:CustomizedSnapshot;users:Staff[];canReview:boolean;reviewed:boolean;onReviewed:(value:boolean)=>void;flags:string[];onFlags:(values:string[])=>void;originalUrl:string}){
  return <section className="ops-card ops-custom-review" aria-label="Customized proposal review">
    <div className="ops-card-head"><div><h2><Pencil size={18}/>Customized proposal <span className="ops-badge customized">{snapshot.changes.length} changed sections</span></h2><p>Created by {staffName(users,snapshot.createdBy)} · Last edited by {staffName(users,snapshot.updatedBy)} · {manilaTime(snapshot.updatedAt)}</p></div><a className="ops-btn" href={originalUrl}><Download size={15}/>Original template</a></div>
    <div className="ops-custom-review-body"><p className="ops-custom-review-intro">Compare each edit with the template. Flag changes that need correction.</p>
      {!snapshot.changes.length&&<p>This copy is marked customized. No content changes were made.</p>}
      {snapshot.changes.map(change=>{const flag='Custom edit '+change.id+': '+change.label;return <article key={change.id} className={'ops-custom-change'+(flags.includes(flag)?' flagged':'')}><div className="ops-custom-change-heading"><b>{change.label}</b>{canReview?<label><input type="checkbox" checked={flags.includes(flag)} onChange={event=>onFlags(event.target.checked?[...flags,flag]:flags.filter(value=>value!==flag))}/><Flag size={13}/>Flag for correction</label>:flags.includes(flag)&&<span className="ops-badge amber">Flagged</span>}</div><div className="ops-custom-comparison"><div><small>Original template</small><p>{change.before||'(Blank)'}</p></div><div><small>Customized</small><p>{change.after||'(Removed)'}</p>{change.formatting.length>0&&<span className="ops-custom-format-note">Formatting changed: {change.formatting.join(', ')}</span>}</div></div></article>;})}
      {canReview&&<label className="ops-custom-review-ack"><input type="checkbox" checked={reviewed} onChange={event=>onReviewed(event.target.checked)}/><span>I reviewed the customized content, including rates, benefits and conditions.</span></label>}
      {canReview&&flags.some(flag=>flag.startsWith('Custom edit '))&&<p className="ops-custom-flag-note">Flagged edits need correction. Use “Return for correction” in the action panel.</p>}
    </div>
  </section>;
}
