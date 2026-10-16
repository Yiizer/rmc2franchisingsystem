import type { CatalogTemplate, FormFields } from './types';

const titlePattern = /^(Dr\.?|Engr\.?|Atty\.?|Prof\.?|Hon\.?|Rev\.?|Mr\.?|Mrs\.?|Ms\.?|Miss)\s+/i;
export const proposalTitles = ['', 'Dr.', 'Engr.', 'Atty.', 'Prof.', 'Hon.', 'Rev.', 'Mr.', 'Mrs.', 'Ms.', 'Miss'];
export function suppliedTitle(name: string = '') {
  const title = name.trim().match(titlePattern)?.[1] || '';
  return title ? proposalTitles.find(value=>value.toLowerCase()===title.replace(/\.$/, '').toLowerCase()+'.')||'Miss' : '';
}
function samePerson(first:string='',second:string=''){return first.trim().replace(titlePattern,'').toLowerCase()===second.trim().replace(titlePattern,'').toLowerCase();}
export function addresseeName(fields: FormFields) {
  const title = fields.addresseeTitle || suppliedTitle(fields.addressee);
  const name = (fields.addressee || '').trim().replace(titlePattern, '');
  return name ? [title, name].filter(Boolean).join(' ') : '';
}
export function proposalFields(fields: FormFields, source: FormFields): FormFields {
  return {...fields, proposalDate: fields.proposalDate ?? fields.requestDate ?? '', addresseeTitle: fields.addresseeTitle ?? (suppliedTitle(source.addressee) || suppliedTitle(fields.addressee) || (samePerson(fields.addressee,source.contactName) ? suppliedTitle(source.contactName) : ''))};
}
export function philippinePhone(value: string = '') {
  let digits = value.replace(/[^\d]/g, '');
  if (digits.startsWith('0063')) digits = digits.slice(4);
  else if (digits.startsWith('63')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  const valid = !/[a-z]/i.test(value) && /^(?:9\d{9}|[2-8]\d{8,9})$/.test(digits);
  return {valid, national: valid ? digits : '', display: valid ? '(+63) '+digits : value.trim()};
}
export type ProposalCheck = {field:string;kind:'error'|'changed';message:string;original?:string;current?:string};
export function proposalChecks(fields: FormFields, source: FormFields, template?: CatalogTemplate): ProposalCheck[] {
  const checks:ProposalCheck[]=[];
  for (const key of ['agentPhone','contactPhone']) if(fields[key]&&!philippinePhone(fields[key]).valid) checks.push({field:key,kind:'error',message:'Enter a complete Philippine number. Use (+63) without the leading 0.'});
  const originalTitle=suppliedTitle(source.addressee)|| (samePerson(fields.addressee,source.contactName)?suppliedTitle(source.contactName):'');
  const currentTitle=fields.addresseeTitle||suppliedTitle(fields.addressee);
  if (/^(Dr|Engr|Atty|Prof|Hon|Rev)\./i.test(originalTitle) && currentTitle.toLowerCase()!==originalTitle.toLowerCase()) checks.push({field:'addresseeTitle',kind:'error',message:'Keep the professional title supplied in the form: '+originalTitle});
  const typedTitle=suppliedTitle(fields.addressee);
  if(typedTitle&&fields.addresseeTitle&&typedTitle.toLowerCase()!==fields.addresseeTitle.toLowerCase()) checks.push({field:'addresseeTitle',kind:'error',message:'The title in the name and the selected title differ. Confirm the addressee.'});
  if(fields.proposalDate&&source.requestDate&&fields.proposalDate!==source.requestDate)checks.push({field:'proposalDate',kind:'changed',message:'Proposal date differs from the form’s request date — verify this is intentional.',original:source.requestDate,current:fields.proposalDate});
  for(const [key,value] of Object.entries(fields)) {
    if(['proposalDate','addresseeTitle'].includes(key)||!value?.trim()&&!source[key]?.trim())continue;
    const original=source[key]||'';
    const same=key.endsWith('Phone')?philippinePhone(original).valid&&philippinePhone(value).valid&&philippinePhone(original).national===philippinePhone(value).national:key==='addressee'?addresseeName({...source,addresseeTitle:originalTitle}).toLowerCase()===addresseeName(fields).toLowerCase():original.trim()===value.trim();
    if(!same)checks.push({field:key,kind:'changed',message:original?'Different from the submitted form — please verify.':'Added after intake — please verify.',original,current:value});
  }
  if(template?.sector==='Government'&&!['Government','DepEd'].includes(fields.sector))checks.push({field:'templateId',kind:'error',message:'This template is for government employees; the form has a different sector.'});
  return checks;
}
