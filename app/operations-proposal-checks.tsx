import { Check, CircleAlert } from 'lucide-react';
import { LABELS, documentIssues } from '@/lib/operations/types';
import type { CatalogTemplate, FormFields, CustomizedProposal } from '@/lib/operations/types';
import { proposalChecks } from '@/lib/operations/proposal-fields';

export default function ProposalDetailChecks({fields,originalFields,template,customization}:{fields:FormFields;originalFields:FormFields;template?:CatalogTemplate;customization?:CustomizedProposal}){
  const checks=proposalChecks(fields,originalFields,customization?undefined:template);
  const changed=checks.filter(check=>check.kind==='changed'),missing=documentIssues(fields,template,!!customization);
  return <div className="ops-proposal-checks">{customization&&<article className="ops-ai-comment warning"><h4>Customized content</h4><p>{Object.keys(customization.edits).length} edited sections need supervisor review. These edits are separate from the autofill checks below.</p></article>}
          {missing.length>0&&<article className="ops-ai-comment warning"><h4><CircleAlert size={15}/>Complete before preparing</h4><ul>{missing.map(issue=><li key={issue}>{issue}</li>)}</ul></article>}
          {checks.map((check,index)=><article className="ops-ai-comment warning" key={index}><h4><CircleAlert size={15}/>{LABELS[check.field]||'Proposal'}</h4><p>{check.message}</p>{check.kind==='changed'&&<div className="ops-ai-value"><small><b>Form:</b> {check.original||'Not supplied'}</small><small><b>Working:</b> {check.current||'Blank'}</small></div>}</article>)}
          {!checks.length&&!missing.length&&<article className="ops-ai-comment good"><h4><Check size={15}/>{customization?"Autofill details match the form":"Details match the form"}</h4><p>Supplied titles and Philippine phone formatting have been checked.</p></article>}
          {changed.length>0&&<p className="ops-ai-footnote">A changed value may be a valid correction. It is recorded for supervisor review.</p>}
        </div>;
}
