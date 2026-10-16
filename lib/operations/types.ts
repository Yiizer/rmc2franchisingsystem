export type StaffRole = 'Employee' | 'Supervisor' | 'Admin';
export type Staff = { id: string; name: string; email: string; role: StaffRole; position: string; active: boolean; canApprove: boolean };
export type WorkflowStatus = 'New inquiry' | 'Preparing proposal' | 'Waiting for agent details' | 'Awaiting approval' | 'Needs correction' | 'Approved — sending' | 'Approved — email failed' | 'Sent';
export type FormFields = Record<string, string>;
export type CustomEdit = { text:string; bold?:boolean; italic?:boolean; underline?:boolean; fontSize?:number; color?:string; align?:'left'|'center'|'right'|'both' };
export type CustomChange = { id:string; label:string; before:string; after:string; formatting:string[] };
export type CustomizedProposal = { id:string; templateId:string; sourceHash:string; edits:Record<string,CustomEdit>; createdAt:string; createdBy:string; updatedAt:string; updatedBy:string };
export type CustomizedSnapshot = CustomizedProposal & {changes:CustomChange[]};
export type MailDraft = { to: string; subject: string; body: string };
export type SourceCell = { cell: string; value: string };
export type SourceForm = { filename: string; storage: string; format?: 'xlsx' | 'pdf'; kind?:'sample'|'attachment'; sheet: string; cells: SourceCell[]; fields: FormFields; receivedAt: string };
export const isSampleForm=(source:SourceForm)=>source.kind==='sample'||(!source.storage&&source.filename==='Sample franchise form.xlsx');
export type ProposalRenderer='native-word'|'native-word-v2'|'native-word-legacy'|'browser-print'|'unknown';
export type AuditEntry = { id: string; at: string; actorId: string; actor: string; action: string; changes?: { field: string; before: string; after: string }[] };
export type ChatEntry = { id: string; at: string; role: 'user' | 'assistant'; text: string; actorId: string; sources: string[] };
export type GeneratedPackage = { id: string; templateId: string; sourceHash: string; sourceDocx?: string; sourceName?: string; templateName?: string; renderer?:ProposalRenderer; pdf: string; docx: string; filename: string; generatedAt: string; preparedBy: string; fingerprint: string; fields: FormFields; pageCount: number; customization?: CustomizedSnapshot };
export type Submission = { version: number; at: string; submittedBy: string; fields: FormFields; email: MailDraft; emailOverrides: string[]; generated: GeneratedPackage; notes: string; warnings: string[]; decision?: { action: 'approve' | 'return'; actorId: string; at: string; note: string; flags: string[]; customizationReviewed?: boolean }; delivery?: { id: string; at: string; mode: 'local-test'; file: string } };
export type InquiryRecord = { id: string; revision: number; status: WorkflowStatus; createdAt: string; updatedAt: string; fields: FormFields; source: SourceForm; email: MailDraft; emailOverrides: string[]; templateId: string; customization?: CustomizedProposal; customizationArchive?: CustomizedProposal[]; generated?: GeneratedPackage; submissions: Submission[]; handledBy: string[]; workProgress?: Record<string,{step:number;at:string;paused:boolean}>; history: AuditEntry[]; chat: ChatEntry[]; notes: string; returnNote: string; returnFlags: string[]; detailRequests: { at: string; actorId: string; body: string; to: string; file: string }[] };
export type CatalogTemplate = { id: string; name: string; family: string; variant: string; sector: 'Government' | 'All'; sourceName: string; sourceId: string; sourceHash: string; file: string; text: string; placeholders: string[]; warnings: string[]; annualOnly: boolean; active: boolean };
export type Notice = { id: string; inquiryId: string; title: string; message: string; at: string; recipientIds: string[]; readBy: string[] };
export type InquiryActivity = { inquiryId:string; userId:string; startedAt:string; seenAt:string };
export type WorkspaceData = { packageRenderers:Record<string,ProposalRenderer>; user: Staff; users: Staff[]; inquiries: InquiryRecord[]; activity:InquiryActivity[]; templates: CatalogTemplate[]; notifications: Notice[]; integrations: { database: string; gmail: string; ai: string; documents: string } };

export const FORM_GROUPS = [
  { title: 'Account', fields: [['company','Account name'],['sector','Sector'],['industry','Nature of business'],['address','Address'],['division','Division'],['branch','Branch'],['requestDate','Request date']] },
  { title: 'Agent and contact', fields: [['agentName','Agent name'],['agentEmail','Agent reply email'],['agentPhone','Agent phone'],['contactName','Client contact'],['contactEmail','Client contact email'],['contactPhone','Client phone'],['contactPosition','Client position'],['addressee','Proposal addressee'],['addresseePosition','Addressee position']] },
  { title: 'Requested coverage', fields: [['requestedPlan','Requested plan'],['existingProvider','Existing provider'],['payment','Payment schedule'],['employees','Regular employees'],['dependents','Dependents'],['employeeAges','Employee age range'],['dependentAges','Dependent age range'],['hospitals','Preferred hospitals / clinics'],['dental','Preferred dental clinics']] },
] as const;
export const LABELS: Record<string,string> = {...Object.fromEntries(FORM_GROUPS.flatMap(g=>g.fields.map(([key,label])=>[key,label]))),proposalDate:'Proposal date',addresseeTitle:'Addressee title'};
export const editableStatus = (status: WorkflowStatus) => ['New inquiry','Preparing proposal','Waiting for agent details','Needs correction'].includes(status);
export const canPrepareProposal = (user:Pick<Staff,'role'>) => user.role==='Employee'||user.role==='Supervisor';
export function defaultEmail(fields: FormFields, template?: Pick<CatalogTemplate,'name'>, preparer = 'Franchising team'): MailDraft {
  return { to: fields.agentEmail || '', subject: `Proposal — ${fields.company || 'Account'}${template ? ' — '+template.name : ''}`, body: `Dear ${fields.agentName || 'Agent'},\n\nPlease find attached the ${template?.name || 'healthcare'} proposal for ${fields.company || 'your account'}, prepared from the submitted franchise form.\n\nPlease review the attached proposal for the complete rates, benefits and coverage conditions. Let us know if you need any clarification.\n\nBest regards,\n${preparer}\nFranchising Operations\nRMC2 Consultancy Corporation` };
}
export function missingFields(fields: FormFields): string[] {
  const required = ['company','address','agentName','agentEmail','agentPhone','addressee','addresseePosition','requestDate','sector','payment','employees','dependents','employeeAges'];
  if (Number(fields.dependents)>0) required.push('dependentAges');
  return required.filter(key => !fields[key]?.trim()).map(key=>LABELS[key]||key);
}
export function documentIssues(fields: FormFields, template?: CatalogTemplate, customized=false): string[] {
  const problems=missingFields(fields);
  if(!template) problems.push('Choose a proposal template');
  if(fields.agentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.agentEmail)) problems.push('Valid agent reply email');
  if(fields.employees && (!/^\d+$/.test(fields.employees)||Number(fields.employees)<1)) problems.push('Employee count must be a whole number greater than zero');
  if(fields.dependents && !/^\d+$/.test(fields.dependents)) problems.push('Dependent count must be a whole number, including zero');
  if(fields.requestDate && !/^\d{4}-\d{2}-\d{2}$/.test(fields.requestDate)) problems.push('Valid request date');
  if(fields.proposalDate && !/^\d{4}-\d{2}-\d{2}$/.test(fields.proposalDate)) problems.push('Valid proposal date');
  if('proposalDate' in fields&&!fields.proposalDate?.trim())problems.push('Proposal date');
  if(!customized && template?.annualOnly && fields.payment!=='Annual') problems.push('Selected proposal supplies annual rates only — select another template or clarify the payment schedule');
  if(!customized && template?.sourceId==='D023' && Number(fields.dependents)>0) problems.push('BureauHealth 4,250 does not supply dependent rates');
  return [...new Set(problems)];
}
export const manilaTime = (value: string) => new Intl.DateTimeFormat('en-PH',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Manila'}).format(new Date(value));
export function ageLabel(value: string, now=Date.now()) { const mins=Math.max(0,Math.floor((now-Date.parse(value))/60000)); return mins<1?'Just now':mins<60?`${mins}m ago`:mins<1440?`${Math.floor(mins/60)}h ${mins%60}m ago`:`${Math.floor(mins/1440)}d ${Math.floor(mins%1440/60)}h ago`; }
