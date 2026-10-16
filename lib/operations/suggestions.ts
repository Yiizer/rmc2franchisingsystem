import type { CatalogTemplate, FormFields } from './types';

export const PROPOSAL_HELP_PROMPTS = {
  suggest: 'Suggest proposals',
  explain: 'Why does this proposal fit?',
  compare: 'Compare the alternatives',
} as const;
export type ProposalHelpTopic = keyof typeof PROPOSAL_HELP_PROMPTS;

function matchTemplate(fields: FormFields, template: CatalogTemplate) {
  const government = ['DepEd', 'Government'].includes(fields.sector);
  const sectorKnown = government || fields.sector === 'Private';
  const request = (fields.requestedPlan || '').trim().toLowerCase();
  const familyMatch = !!request && request.includes(template.family.toLowerCase());
  const sectorMatch = sectorKnown && (template.sector === 'Government' ? government : !government);
  const standard = template.variant === 'Standard';
  const reasons = [
    ...(familyMatch ? [`Matches the requested ${template.family} plan.`] : []),
    ...(sectorMatch ? [government ? `The inquiry is marked ${fields.sector}; this proposal is a government-employee program.` : 'The inquiry is for a private-sector account; this proposal contains group healthcare rates and benefits.'] : []),
    ...(standard ? ['The Standard version is offered as a starting option.'] : []),
  ];
  const cues = [
    ...(familyMatch ? [{ from: template.family, to: 'Requested plan', kind: 'plan' as const }] : []),
    ...(sectorMatch ? [{ from: fields.sector, to: government ? 'Government plan' : 'Group healthcare', kind: 'sector' as const }] : []),
    ...(standard ? [{ from: 'Standard', to: 'Starting option', kind: 'variant' as const }] : []),
  ];
  return { template, score: (familyMatch ? 30 : 0) + (sectorMatch ? 20 : 0) + (standard ? 4 : 0), reasons: reasons.length ? reasons : ['Available in the supplied proposal library for manual review. No sector or requested-plan match was found.'], cues };
}

/** Shared by the visible cards and simulated chat. These are preparation rules, not underwriting rules. */
export function suggestTemplates(fields: FormFields, templates: CatalogTemplate[]) {
  return templates.filter(template => template.active
    && !(template.sector==='Government'&&fields.sector==='Private')
    && !(template.annualOnly&&fields.payment&&fields.payment!=='Annual')
    && !(template.sourceId==='D023'&&Number(fields.dependents)>0)
  ).map(template => matchTemplate(fields, template)).sort((a, b) => b.score - a.score).slice(0, 3);
}

/** Proposal-only quick actions share exactly the same source matching as the visible cards. */
export function getProposalHelp(fields: FormFields, templates: CatalogTemplate[], selectedId: string, topic: ProposalHelpTopic) {
  const suggested = suggestTemplates(fields, templates);
  const selected = templates.find(template => template.id === selectedId && template.active);
  const items = topic === 'explain' ? (selected ? [matchTemplate(fields, selected)] : []) : topic === 'compare' && selected ? [matchTemplate(fields, selected), ...suggested.filter(option => option.template.id !== selected.id)].slice(0, 3) : suggested;
  return {
    title: topic === 'explain' ? 'Your selected proposal' : topic === 'compare' ? 'Compare proposal options' : 'Suggested proposals',
    description: topic === 'explain' ? (selected ? 'Here is how this template matches the inquiry.' : 'Choose a template first to see its proposal explanation.') : topic === 'compare' ? 'Compare the program and variant named in each supplied proposal. Open its source for the complete benefits and rates.' : 'Suggestions use the requested plan and sector, with Standard versions listed first.',
    items,
    note: 'You choose the proposal. Confirm eligibility and coverage in its source; no benefits or rates are added by this helper.',
  };
}
