'use client';
import { ArrowDown, ArrowRight, Building2, Check, CheckCircle2, FileText, Layers, CircleAlert, Sparkles } from 'lucide-react';
import { suggestTemplates } from '@/lib/operations/suggestions';
import type { CatalogTemplate, FormFields } from '@/lib/operations/types';
import { documentIssues } from '@/lib/operations/types';

// These labels condense the supplied source notes; they do not add coverage rules.
const SOURCE_LABELS: Record<string, string[]> = {
  'This proposal states VAT exclusive and does not supply dependent rates.': ['VAT exclusive', 'No dependent rates'],
  'The source labels the PHP 6,000 line as another principal rate. No dependent rate is inferred from that label.': ['₱6,000 = principal rate', 'Dependent rate unconfirmed'],
  'Coverage variant is selected by staff. Review its waiting periods, major-surgery exclusions and eligibility wording in the source.': ['Check waiting periods', 'Check surgery exclusions', 'Check eligibility'],
  'CorpoPlus room type follows the proposal: Regular Private. TOR/MOA differences are not merged into this document.': ['CorpoPlus: Regular Private', 'Proposal terms used'],
};
const CUE_ICONS = { plan: FileText, sector: Building2, variant: Layers };

export default function ProposalHelp({fields,templates,selectedId,editable,onChoose,onSource,customized=false}:{customized?:boolean;fields:FormFields;templates:CatalogTemplate[];selectedId:string;editable:boolean;onChoose:(id:string)=>void;onSource:(template:CatalogTemplate)=>void}){
  const recommended=suggestTemplates(fields,templates)[0],selected=templates.find(t=>t.id===selectedId);
  if(!recommended)return <p className="ops-ai-comment">No supplied proposal templates are available.</p>;
  const same=selected?.id===recommended.template.id,matched=recommended.score>4;
  const selectionIssues=selected?documentIssues(fields,selected):[];
  const warnings=recommended.template.warnings.flatMap(warning=>SOURCE_LABELS[warning]||[warning]);
  return <div className="ops-proposal-help ops-ai-visual" data-proposal-help>
    <h4 className={'ops-ai-visual-title'+(same&&matched?' good':'')}>
      {same&&matched?<><CheckCircle2 size={17}/>Good choice for this form</>:matched?<><Sparkles size={16}/>Suggested for this form</>:<><CircleAlert size={16}/>No clear match</>}
    </h4>
    <div className="ops-ai-plan-flow" aria-label="Proposal comparison">
      {selected&&!same&&<>
        <div className="ops-ai-plan current"><span className="ops-ai-plan-label">Your choice <span className="ops-ai-kept"><Check size={11}/>Still selected</span></span><b>{selected.name}</b></div>
        <div className="ops-ai-flow-arrow" aria-label="Compare with the suggestion"><ArrowDown size={22}/><span>Compare</span></div>
      </>}
      <div className={'ops-ai-plan suggested'+(matched?'':' manual')}>
        <span className="ops-ai-plan-label">{same&&matched?<><CheckCircle2 size={14}/>Selected · matches</>:matched?<><Sparkles size={14}/>AI suggestion</>:'Library option · review manually'}</span>
        <b>{recommended.template.name}</b>
        <span className="ops-ai-plan-source">{recommended.template.sourceId}</span>
      </div>
    </div>
    {matched?<dl className="ops-ai-match-cues" aria-label="Why this proposal is suggested">
      {recommended.cues.map(cue=>{const Icon=CUE_ICONS[cue.kind];return <div className="ops-ai-match-cue" key={cue.kind}><dt><Icon size={14}/>{cue.from}</dt><ArrowRight size={15} aria-hidden="true"/><dd>{cue.to}</dd></div>;})}
    </dl>:<p className="ops-ai-no-match">No plan or sector match. Choose manually.</p>}
    {editable&&!same&&<button className="ops-btn primary ops-ai-use" onClick={()=>onChoose(recommended.template.id)}>{matched?'Use suggestion':'Choose this template'}<ArrowRight size={15}/></button>}
    <button className="ops-link ops-ai-preview" onClick={()=>onSource(recommended.template)}><FileText size={14}/>Preview template</button>
    {selectionIssues.length>0&&<div className="ops-ai-visual-warning"><h4><CircleAlert size={14}/>Complete before preparing</h4><ul>{selectionIssues.map(issue=><li key={issue}>{issue}</li>)}</ul></div>}
    {warnings.length>0&&<div className="ops-ai-visual-warning"><h4><CircleAlert size={14}/>Check in template</h4><ul className="ops-ai-warning-tags">{warnings.map(warning=><li key={warning}>{warning}</li>)}</ul></div>}
    <p className="ops-ai-visual-footnote">{customized?"Template match only. Customized content needs supervisor review.":"Check eligibility, benefits & rates in the template."}</p>
  </div>;
}
