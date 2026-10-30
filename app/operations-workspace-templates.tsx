'use client';
import { useState } from 'react';
import { Check, CheckCircle2, Eye, Pencil, Sparkles, CircleAlert, ArrowLeft, LayoutGrid } from 'lucide-react';
import type { CatalogTemplate, CustomizedProposal } from '@/lib/operations/types';
import type { suggestTemplates, reviewTemplateChoice } from '@/lib/operations/suggestions';

import { templateDescription } from '@/lib/operations/template-descriptions';

type Suggestion = ReturnType<typeof suggestTemplates>[number];
type Props = {
  templates: CatalogTemplate[];
  suggestions: Suggestion[];
  review: ReturnType<typeof reviewTemplateChoice> | null;
  reviewStale: boolean;
  onReview: () => void;
  selectedId: string;
  customization?: CustomizedProposal;
  editable: boolean;
  busy: boolean;
  onChoose: (id: string) => void;
  onPreview: (template: CatalogTemplate) => void;
  onCustomize: (id: string) => void;
};

function TemplateCard({ template, recommended, selected, customized, editable, busy, onChoose, onPreview, onCustomize }: {
  template: CatalogTemplate; recommended: boolean; selected: boolean; customized: boolean;
} & Pick<Props, 'editable' | 'busy' | 'onChoose' | 'onPreview' | 'onCustomize'>) {
  return <article className={'ops-template-card' + (selected ? ' selected' : '')} aria-label={template.name}>
    <div className="ops-template-card-heading">
      <h3>{template.name}</h3>
      {selected && <span className="ops-template-selection"><CheckCircle2 size={16}/>Selected</span>}
    </div>
    <div className="ops-template-card-meta"><span>{template.variant}</span><small>{template.sourceId}</small>{customized && <span>Customized copy</span>}</div>
    <p className="ops-template-description">{templateDescription(template)}</p>
    {recommended && <span className="ops-template-match">Suggested match</span>}
    <div className="ops-template-card-actions">
      <button className="ops-btn" onClick={() => onPreview(template)} aria-label={'Preview ' + template.name}><Eye size={15}/>Preview</button>
      <button className={'ops-btn ops-select-template' + (selected ? ' is-selected' : '')} aria-label={selected ? 'Selected ' + template.name : 'Select ' + template.name} aria-pressed={selected} disabled={!editable || busy} onClick={() => { if (!selected) onChoose(template.id); }}>{selected ? <><Check size={15}/>Selected</> : 'Select template'}</button>
      <button className="ops-btn ops-customize-template" disabled={!editable || busy} onClick={() => onCustomize(template.id)} aria-label={(customized ? 'Continue customizing ' : 'Customize ') + template.name}><Pencil size={15}/>{customized ? 'Continue customizing' : 'Customize'}</button>
    </div>
  </article>;
}

export default function WorkspaceTemplates({ templates, suggestions, review, reviewStale, onReview, selectedId, customization, editable, busy, onChoose, onPreview, onCustomize }: Props) {
  const active = templates.filter(template => template.active);
  const families = [...new Set(active.map(template => template.family))];
  const initialFamily = active.find(template => template.id === selectedId)?.family || families[0] || '';
  const [family, setFamily] = useState(initialFamily);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [advisorOpen,setAdvisorOpen]=useState(true);
  const visibleFamily = families.includes(family) ? family : initialFamily;
  const others = active.filter(template => template.family === visibleFamily);
  const card = (template: CatalogTemplate, recommended = false) => <TemplateCard key={template.id} template={template} recommended={recommended} selected={selectedId === template.id} customized={customization?.templateId === template.id} editable={editable && active.some(current => current.id === template.id)} busy={busy} onChoose={onChoose} onPreview={onPreview} onCustomize={onCustomize}/>;
  return <section className="ops-workspace-templates" aria-label="Proposal templates">
    <p className="ops-section-intro">Preview a plan, then select it or make a customized copy.</p>
    {!editable && <p className="ops-locked-reason">View only. Selection and customization are available when you can edit this inquiry.</p>}
    <div className="ops-template-view-heading"><div><h3>{libraryOpen ? 'Template library' : 'Suggested templates'}</h3><small>{libraryOpen ? 'Browse by plan family.' : 'Matched to the submitted form'}</small></div><button className="ops-btn" onClick={() => { if (!libraryOpen) setFamily(initialFamily); setLibraryOpen(!libraryOpen); }}>{libraryOpen ? <><ArrowLeft size={16}/>Back to suggestions</> : <><LayoutGrid size={16}/>View all templates</>}</button></div>
    {libraryOpen ? <section id="workspace-template-library" aria-label="Template library"><div className="ops-template-family-filter" role="group" aria-label="Filter by plan family">{families.map(value => <button key={value} className="ops-btn" aria-pressed={visibleFamily === value} onClick={() => setFamily(value)}>{value}</button>)}</div><div className="ops-template-grid">{others.map(template => card(template))}</div>{!others.length && <p className="ops-section-intro">No active templates are available.</p>}</section> : <section aria-label="Suggested templates"><div className="ops-template-grid">{suggestions.map(item => card(item.template, true))}</div>{!suggestions.length && <p className="ops-suggestions-stale">{active.length ? 'No matching templates for the known details. Confirm the requested plan or use View all templates to choose manually.' : 'No active templates are available. Ask an administrator to add a template.'}</p>}</section>}

    {advisorOpen?<>
    <section className="ops-template-advisor compact" aria-label="AI template advisor">
      <div className="ops-advisor-heading"><div><h3><Sparkles size={18}/>AI template advisor</h3><small>Simulated AI · staff review required</small></div><button className="ops-btn" disabled={busy || !active.length} onClick={onReview}>{reviewStale ? 'Review again' : selectedId ? 'Check selected template' : 'Explain recommendation'}</button><button className="ops-btn" aria-label="Dismiss template advice" onClick={()=>setAdvisorOpen(false)}>Dismiss</button></div>
      <p>Compare the chosen template with the client’s request and see why a plan fits.</p>
      {review && <div className="ops-advisor-result" aria-live="polite">{reviewStale ? <p className="ops-suggestions-stale"><CircleAlert size={17}/>Details or templates changed · review again</p> : <>
        <b className={'ops-advisor-verdict ' + (review.status === 'Matches known requirements' ? 'matched' : 'attention')}>{review.status === 'Matches known requirements' ? <CheckCircle2 size={18}/> : <CircleAlert size={18}/>} {review.status}</b>
        {review.recommendedId && <p><strong>Recommended:</strong> {templates.find(t => t.id === review.recommendedId)?.name}</p>}
        <ul>{review.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        <div className="ops-advisor-sources">{review.sourceIds.map(id => {const source=templates.find(t=>t.id===id);return source && <button className="ops-btn" key={id} onClick={()=>onPreview(source)}><Eye size={15}/>Preview {source.name}</button>;})}</div>
        <small>{review.note}</small>
      </>}</div>}
    </section>
    </>:<button className="ops-btn" onClick={()=>setAdvisorOpen(true)}><Sparkles size={16}/>Show template advisor</button>}
  </section>;
}
