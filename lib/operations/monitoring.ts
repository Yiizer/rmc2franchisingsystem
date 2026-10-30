import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { AppError, catalog, db, safeStorage, sourceFile } from './database';
import { conversionName, pdfFromDocx } from './document-renderer';
import type { Staff } from './types';
export async function monitoring(user:Staff,probe=false){
  if(user.role!=='Admin')throw new AppError('Admin access is required for service health and AI usage.',403);
  const started=Date.now(),services:{name:string;state:'healthy'|'available'|'offline'|'simulated';detail:string}[]=[];
  try{db().prepare('SELECT 1').get();services.push({name:'Database',state:'healthy',detail:'Shared database responds'});}catch{services.push({name:'Database',state:'offline',detail:'Database check failed'});}
  const storage=safeStorage('.health-'+randomUUID());try{writeFileSync(storage,'check',{flag:'wx'});unlinkSync(storage);services.push({name:'Private file storage',state:'healthy',detail:'Files can be saved and read'});}catch{services.push({name:'Private file storage',state:'offline',detail:'Storage is unavailable'});}
  const converter=conversionName();let state:'available'|'healthy'|'offline'=converter.includes('needs setup')?'offline':'available',detail=converter;
  if(probe&&state!=='offline')try{const template=catalog().find(item=>item.active);if(!template)throw Error();await pdfFromDocx(readFileSync(sourceFile(template)),true);state='healthy';detail='Word-to-PDF conversion completed';}catch{state='offline';detail='PDF conversion check failed';}
  services.push({name:'PDF converter',state,detail},{name:'Email',state:'simulated',detail:'Local test mailbox; no live email connection'},{name:'AI provider',state:'simulated',detail:'Source-based assistance; no live AI provider connected'});
  const usage=db().prepare('SELECT COUNT(*) requests,COALESCE(SUM(input_tokens),0) inputTokens,COALESCE(SUM(output_tokens),0) outputTokens FROM ai_usage WHERE at>=?').get(new Date(Date.now()-30*86400000).toISOString());
  return {checkedAt:new Date().toISOString(),durationMs:Date.now()-started,services,ai:{connected:false,period:'Last 30 days',usage,detail:'No paid AI requests are made by the current assistant.'}};
}
