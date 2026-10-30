import type { CatalogTemplate, FormFields } from './types';

export const PROPOSAL_HELP_PROMPTS = {
  suggest: 'Suggest proposals',
  explain: 'Why does this proposal fit?',
  compare: 'Compare the alternatives',
} as const;
export type ProposalHelpTopic = keyof typeof PROPOSAL_HELP_PROMPTS;

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function requestedVariant(request: string) {
  if (/dreaded/.test(request)) return 'PEC + dreaded covered';
  if (/\bpec\b|pre existing/.test(request)) return 'PEC covered';
  if (/\bstandard\b/.test(request)) return 'Standard';
  return '';
}
function restrictions(fields: FormFields, template: CatalogTemplate) {
  const variant = requestedVariant(normalize(fields.requestedPlan || ''));
  return [
    ...(!template.active ? ['This template is no longer available.'] : []),
    ...(template.sector === 'Government' && fields.sector === 'Private' ? ['This government program does not match the private-sector account.'] : []),
    ...(template.annualOnly && fields.payment && fields.payment !== 'Annual' ? ['The source supplies annual rates only; the requested payment schedule differs.'] : []),
    ...(template.sourceId === 'D023' && Number(fields.dependents) > 0 ? ['This source does not supply the requested dependent rates.'] : []),
    ...(variant && template.variant !== variant ? [`The request specifies ${variant}; this is the ${template.variant} variant.`] : []),
  ];
}
function matchTemplate(fields: FormFields, template: CatalogTemplate) {
  const government = ['DepEd', 'Government'].includes(fields.sector);
  const sectorKnown = government || fields.sector === 'Private';
  const request = normalize(fields.requestedPlan || '');
  const familyMatch = !!request && request.includes(normalize(template.family));
  const sectorMatch = sectorKnown && (template.sector === 'Government' ? government : !government);
  const standard = template.variant === 'Standard';
  const variant = requestedVariant(request);
  const variantMatch = !!variant && template.variant === variant;
  const reasons = [
    ...(familyMatch ? [`Matches the requested ${template.family} plan.`] : []),
    ...(variantMatch ? [`The source is the requested ${variant} variant.`] : []),
    ...(sectorMatch ? [government ? `The inquiry is marked ${fields.sector}; this proposal is a government-employee program.` : 'The inquiry is for a private-sector account; this proposal contains group healthcare rates and benefits.'] : []),
    ...(standard ? ['The Standard version is offered as a starting option.'] : []),
  ];
  const cues = [
    ...(familyMatch ? [{ from: template.family, to: 'Requested plan', kind: 'plan' as const }] : []),
    ...(sectorMatch ? [{ from: fields.sector, to: government ? 'Government plan' : 'Group healthcare', kind: 'sector' as const }] : []),
    ...(standard ? [{ from: 'Standard', to: 'Starting option', kind: 'variant' as const }] : []),
  ];
  return { template, score: (familyMatch ? 30 : 0) + (sectorMatch ? 20 : 0) + (variantMatch ? 15 : 0) + (standard && !variant ? 4 : 0), reasons: reasons.length ? reasons : ['Available in the supplied proposal library for manual review. No sector or requested-plan match was found.'], cues };
}

/** Shared by the visible cards and simulated chat. These are preparation rules, not underwriting rules. */
export function suggestTemplates(fields: FormFields, templates: CatalogTemplate[]) {
  return templates.filter(template => !restrictions(fields, template).length)
    .map(template => matchTemplate(fields, template)).filter(item => item.score > 4)
    .sort((a, b) => b.score - a.score).slice(0, 3);
}

/** On-demand simulated review. Never changes a selection or claims to verify unlisted coverage. */
export function reviewTemplateChoice(fields: FormFields, templates: CatalogTemplate[], selectedId: string, customized = false) {
  const selected = templates.find(template => template.id === selectedId);
  const suggested = suggestTemplates(fields, templates);
  const request = normalize(fields.requestedPlan || '');
  const requestedFamilies = [...new Set(templates.filter(t => request.includes(normalize(t.family))).map(t => t.family))];
  const recommendation = suggested.find(item => !requestedFamilies.length || requestedFamilies.includes(item.template.family))?.template;
  const target = selected || recommendation;
  const issues = target ? restrictions(fields, target) : ['No available template matches the known requirements.'];
  if (target && requestedFamilies.length && !requestedFamilies.includes(target.family)) issues.push('The selected plan family differs from the requested plan.');
  const unknown = [
    ...(selectedId && !selected ? ['The selected template is missing from the catalog; review an available source before proceeding.'] : []),
    ...(!request ? ['The requested plan is missing; confirm the intended coverage with the agent.'] : !requestedFamilies.length ? ['The requested plan is not recognized in the catalog; confirm it with the agent.'] : []),
    ...(!['Private', 'Government', 'DepEd'].includes(fields.sector) ? ['Confirm the account sector before choosing a program.'] : []),
    ...(!['Annual', 'Semiannual'].includes(fields.payment) ? ['Confirm the payment schedule.'] : []),
    ...(!/^\d+$/.test(fields.dependents || '') ? ['Confirm the number of dependents.'] : []),
    ...(customized ? ['This is a customized copy. Changes to benefits and rates need separate supervisor review.'] : []),
    ...(/semi annual|semiannual|op limit/.test(request) ? ['Confirm the requested outpatient limit in the source; a benefit limit does not establish the payment schedule.'] : []),
  ];
  const alternativeFits = !!recommendation && recommendation.id !== selected?.id && !unknown.length;
  const status = issues.length || unknown.length ? (issues.length && alternativeFits ? 'Another template fits better' : 'Needs review') : 'Matches known requirements';
  const reasons = [...issues, ...unknown, ...(target ? matchTemplate(fields, target).reasons : [])].slice(0, 3);
  return {status, reasons, selectedId, recommendedId:recommendation?.id,
    sourceIds:[...new Set([target?.id, recommendation?.id].filter((id):id is string => !!id))],
    note:'Simulated review of catalog information only. Open the source to confirm complete eligibility, rates and benefits.'};
}

/** Proposal-only quick actions share exactly the same source matching as the visible cards. */
export function getProposalHelp(fields: FormFields, templates: CatalogTemplate[], selectedId: string, topic: ProposalHelpTopic) {
  const suggested = suggestTemplates(fields, templates);
  const selected = templates.find(template => template.id === selectedId && template.active);
  const items = topic === 'explain' ? (selected ? [matchTemplate(fields, selected)] : []) : topic === 'compare' && selected ? [matchTemplate(fields, selected), ...suggested.filter(option => option.template.id !== selected.id)].slice(0, 3) : suggested;
  return {
    title: topic === 'explain' ? 'Your selected proposal' : topic === 'compare' ? 'Compare proposal options' : 'Suggested proposals',
    description: topic === 'explain' ? (selected ? 'Here is how this template matches the inquiry.' : 'Choose a template first to see its proposal explanation.') : topic === 'compare' ? 'Compare the program and variant named in each supplied proposal. Open its source for the complete benefits and rates.' : 'Suggestions use the requested plan, explicit coverage variant and known catalog restrictions.',
    items,
    note: 'You choose the proposal. Confirm eligibility and coverage in its source; no benefits or rates are added by this helper.',
  };
}

/** Stable inputs for requested matches. Polling and unrelated edits do not invalidate them. */
export function suggestionInputs(fields: FormFields, templates: CatalogTemplate[]) {
  return JSON.stringify({
    fields: [fields.requestedPlan || '', fields.sector || '', fields.payment || '', fields.dependents || ''],
    templates: templates.map(({id, sourceHash, active, family, variant, sector, annualOnly, name, sourceId}) =>
      ({id, sourceHash, active, family, variant, sector, annualOnly, name, sourceId})).sort((a,b)=>a.id.localeCompare(b.id)),
  });
}
