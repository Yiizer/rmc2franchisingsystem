import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AppError } from './errors';
import { MIME, files } from './file-store';
import { resourceBytes } from './template-source';
import type { FormFields, SourceForm } from './types';

const mapping:Record<string,string>={agentName:'C7',requestDate:'J7',branch:'D8',agentPhone:'J8',company:'B10',industry:'J11',address:'C12',contactName:'D14',contactEmail:'B17',contactPhone:'J16',contactPosition:'C18',existingProvider:'J18',addressee:'B21',addresseePosition:'G21',requestedPlan:'D22',payment:'G23',employees:'D25',dependents:'J24',employeeAges:'C26',dependentAges:'J26',hospitals:'C29',dental:'I29'};
function text(value:ExcelJS.CellValue):string {
  if(value===null||value===undefined)return '';
  if(value instanceof Date)return value.toISOString().slice(0,10);
  if(typeof value==='object'){if('richText' in value)return value.richText.map(r=>r.text).join('');if('result' in value)return text(value.result as ExcelJS.CellValue);if('text' in value)return value.text;return '';}
  return String(value).trim();
}
export async function parseForm(bytes:Buffer, filename:string, sender:string):Promise<SourceForm> {
  if(bytes.length>7*1024*1024)throw new AppError('The Excel form must be smaller than 7 MB.');
  const workbook=new ExcelJS.Workbook();
  try{await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);}catch{throw new AppError('This file could not be read as an .xlsx workbook.');}
  if(workbook.worksheets.length>20)throw new AppError('The workbook has too many sheets for a franchise form.');
  const sheet=workbook.worksheets.find(s=>text(s.getCell('A6').value).toUpperCase().includes('ACCOUNT PROFILE'));
  if(!sheet)throw new AppError('Use the franchise form layout: ACCOUNT PROFILE in A6. The original file is kept, but unknown layouts need a field mapping before import.');
  if(sheet.actualRowCount>500||sheet.actualColumnCount>100)throw new AppError('The populated form sheet is larger than the supported franchise form layout.');
  const fields:FormFields={};
  for(const [key,cell] of Object.entries(mapping))fields[key]=text(sheet.getCell(cell).value);
  const business=text(sheet.getCell('J10').value)+' '+fields.industry;
  fields.sector=/deped/i.test(business)?'DepEd':/gov/i.test(business)?'Government':'Private';
  fields.division='Unconfirmed';fields.agentEmail=sender.trim();
  fields.payment=/semi/i.test(fields.payment)?'Semiannual':/annual/i.test(fields.payment)?'Annual':fields.payment;
  const cells:{cell:string;value:string}[]=[];sheet.eachRow(row=>row.eachCell(cell=>{const value=text(cell.value);if(value)cells.push({cell:cell.address,value});}));
  const relative='attachments/'+randomUUID()+'.xlsx';await files().put(relative,bytes,{contentType:MIME.xlsx});
  return {filename:path.basename(filename),storage:relative,format:'xlsx',sheet:sheet.name,cells,fields,receivedAt:new Date().toISOString()};
}
export async function preservePdfForm(bytes:Buffer,filename:string,sender:string):Promise<SourceForm> {
  if(bytes.length>7*1024*1024)throw new AppError('The submitted PDF must be smaller than 7 MB.');
  if(!bytes.subarray(0,8).toString('ascii').startsWith('%PDF-')||!bytes.subarray(-4096).toString('latin1').includes('%%EOF'))throw new AppError('This attachment could not be read as a PDF. Upload the original PDF or Excel form.');
  const relative='attachments/'+randomUUID()+'.pdf';await files().put(relative,bytes,{contentType:MIME.pdf});
  // Preserve the actual attachment; do not manufacture form fields from PDF filenames or proposal text.
  const fields:FormFields={agentEmail:sender.trim(),division:'Unconfirmed'};
  return {filename:path.basename(filename),storage:relative,format:'pdf',sheet:'',cells:[],fields,receivedAt:new Date().toISOString()};
}
export async function sampleForm(fields?:FormFields):Promise<Buffer> {
  const workbook=new ExcelJS.Workbook();
  await workbook.xlsx.load(await resourceBytes('franchise-form.xlsx') as unknown as ExcelJS.Buffer);
  const sheet=workbook.worksheets[0];
  const fake:FormFields={agentName:'Andrea Mendoza',requestDate:new Date().toISOString().slice(0,10),branch:'Antipolo',agentPhone:'09171234567',company:'Sampaguita National High School',industry:'DepEd',address:'Antipolo City, Rizal',contactName:'Ariana Santos',contactEmail:'school.contact@example.com',contactPhone:'09981234567',contactPosition:'HR Manager',existingProvider:'None',addressee:'Ariana Santos',addresseePosition:'HR Manager',requestedPlan:'DepEd plan',payment:'Annual',employees:'10',dependents:'0',employeeAges:'25–58',dependentAges:'',hospitals:'For confirmation',dental:'For confirmation'};
  const values=fields??fake;
  for(const [key,cell] of Object.entries(mapping))sheet.getCell(cell).value=values[key]||'';
  sheet.getCell('J10').value=fields?(fields.sector==='DepEd'?'GOVT / DepEd':fields.sector==='Government'?'GOVT':'PRIVATE'):'GOVT';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
