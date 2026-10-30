"use client";
import { useId, useState } from 'react';
import { ArrowRight, CheckCircle2, CircleAlert, Pencil, ListChecks } from 'lucide-react';
import { LABELS, documentIssues } from '@/lib/operations/types';
import type { CatalogTemplate, FormFields, CustomizedProposal } from '@/lib/operations/types';
import { proposalChecks } from '@/lib/operations/proposal-fields';
import './operations-proposal-checks.css';

export type ProposalCheckInputs = {fields:FormFields; originalFields:FormFields; template?:CatalogTemplate; customization?:CustomizedProposal; versionLabel?:string; savedVersion?:boolean};
const sorted = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));

/** Optional comparison: calculated only by the user's Check action. Required validation is separate. */
export function useProposalDetailCheck(input?: ProposalCheckInputs) {
  const id = useId();
  const signature = input ? JSON.stringify({fields:sorted(input.fields), source:sorted(input.originalFields),
    template:input.template && [input.template.id,input.template.sourceId,input.template.sourceHash,input.template.sector,input.template.annualOnly,input.template.active],
    customization:input.customization && [input.customization.id,sorted(input.customization.edits)], version:input.versionLabel,savedVersion:input.savedVersion}) : '';
  const [snapshot, setSnapshot] = useState<{signature:string; checks:ReturnType<typeof proposalChecks>; missing:string[]; edits:number; customized:boolean; versionLabel:string; sourceUnavailable:boolean} | null>(null);
  const stale = !!snapshot && snapshot.signature !== signature;
  function run() {
    if (!input) return;
    setSnapshot({signature, checks:proposalChecks(input.fields,input.originalFields,input.customization ? undefined : input.template),
      missing:documentIssues(input.fields,input.template,!!input.customization).filter(issue=>!input.savedVersion||issue!=='Choose a proposal template'), edits:Object.keys(input.customization?.edits || {}).length,
      sourceUnavailable:!!input.savedVersion&&!input.template, customized:!!input.customization, versionLabel:input.versionLabel || 'Working details'});
  }
  return {id,snapshot,stale,run};
}
type CheckState = ReturnType<typeof useProposalDetailCheck>;
export function ProposalCheckButton({check,disabled=false}:{check:CheckState;disabled?:boolean}) {
  return <button className="ops-btn ops-check-proposal" disabled={disabled} aria-controls={check.snapshot ? check.id : undefined} onClick={check.run}><ListChecks size={16}/>{check.stale ? 'Check again' : 'Check proposal details'}</button>;
}
export function ProposalCheckResults({check}:{check:CheckState}) {
  const {snapshot,stale,id} = check;
  if (!snapshot) return null;
  const {checks,missing,edits,customized,versionLabel} = snapshot;
  const count = checks.length + missing.length;
  return <section id={id} className="ops-proposal-checks" aria-label="Proposal detail checks" tabIndex={0}>
    <p className="ops-checks-context">{versionLabel} · compared with the submitted form</p>
    {stale ? <div className="ops-checks-summary attention" role="status"><CircleAlert size={18}/><b>Details changed · check again</b></div> : <>
      <div className={'ops-checks-summary ' + (count ? 'attention' : 'matched')} role="status">{count ? <CircleAlert size={18}/> : <CheckCircle2 size={18}/>}<b>{count ? `${count} ${count === 1 ? 'detail needs' : 'details need'} review` : customized ? 'Autofill details match the form' : 'Details match the form'}</b></div>
      <div className="ops-checks-results">
        {missing.length > 0 && <article className="ops-check-item error"><h4>Complete before preparing</h4><ul>{missing.map(issue => <li key={issue}>{issue}</li>)}</ul></article>}
        {checks.map((item,index) => <article className={'ops-check-item ' + (item.kind === 'error' ? 'error' : 'changed')} key={item.field+index}>
          <h4>{LABELS[item.field] || 'Proposal'}</h4><p>{item.message}</p>
          {item.kind === 'changed' && <div className="ops-check-values"><div><small>Submitted form</small><b>{item.original || 'Not supplied'}</b></div><ArrowRight size={16} aria-label="Changed to"/><div><small>{versionLabel}</small><b>{item.current || 'Blank'}</b></div></div>}
        </article>)}
        {snapshot.sourceUnavailable && <p className="ops-checks-note">Form details checked. This saved master differs from the current catalog; refer to its original proposal for template rules.</p>}
        {!count && <p className="ops-checks-note">Titles and Philippine phone formatting checked.</p>}
      </div>
      {customized && <div className="ops-checks-custom"><Pencil size={16}/><div><b>Customized content · {edits} edited {edits === 1 ? 'section' : 'sections'}</b><p>Separate supervisor review required. Autofill checks do not approve benefits or rates.</p></div></div>}
    </>}
  </section>;
}
export default function ProposalDetailChecks(input:ProposalCheckInputs) {
  const check = useProposalDetailCheck(input);
  return <div className="ops-check-control"><ProposalCheckButton check={check}/><div className="ops-checker-label"><b>AI proposal checker</b><small>Simulated AI · staff review required</small></div><ProposalCheckResults check={check}/></div>;
}
