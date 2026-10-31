import { randomUUID } from 'node:crypto';
import { AppError, catalog, db } from './database';
import { MIME, deleteQuietly, files } from './file-store';
import { templateBytes } from './template-source';
import { conversionName, pdfFromDocx } from './document-renderer';
import type { Staff } from './types';
export async function monitoring(user:Staff,probe=false){
  if(user.role!=='Admin')throw new AppError('Admin access is required for service health and AI usage.',403);
  const started=Date.now(),services:{name:string;state:'healthy'|'available'|'offline'|'simulated';detail:string}[]=[];
  try{await db.get('SELECT 1');services.push({name:'Database',state:'healthy',detail:'Shared database responds'});}catch{services.push({name:'Database',state:'offline',detail:'Database check failed'});}
  const probeKey='health/'+randomUUID()+'.txt';let storageDetail='Storage is unavailable';
  try{
    await files().put(probeKey,Buffer.from('check'),{contentType:MIME.text});if((await files().get(probeKey)).toString()!=='check')throw Error();
    // A remote bucket must be private: an anonymous request for the probe object has to fail.
    const publicUrl=files().publicUrl?.(probeKey);
    if(publicUrl){let anonymous=0;try{anonymous=(await fetch(publicUrl,{cache:'no-store',signal:AbortSignal.timeout(10000)})).status;}catch{/* unreachable anonymously is fine */}if(anonymous===200){storageDetail='The storage bucket is PUBLIC. Make it private in Supabase.';throw Error();}}
    await files().delete(probeKey);services.push({name:'Private file storage',state:'healthy',detail:'Files can be saved and read'});
  }catch{await deleteQuietly(probeKey);services.push({name:'Private file storage',state:'offline',detail:storageDetail});}
  const converter=conversionName();let state:'available'|'healthy'|'offline'=converter.includes('needs setup')?'offline':'available',detail=converter;
  if(probe&&state!=='offline')try{const template=(await catalog()).find(item=>item.active);if(!template)throw Error();await pdfFromDocx(await templateBytes(template),true);state='healthy';detail='Word-to-PDF conversion completed';}catch{state='offline';detail='PDF conversion check failed';}
  services.push({name:'PDF converter',state,detail},{name:'Email',state:'simulated',detail:'Local test mailbox; no live email connection'},{name:'AI provider',state:'simulated',detail:'Source-based assistance; no live AI provider connected'});
  const usage=await db.get('SELECT COUNT(*) requests,COALESCE(SUM(input_tokens),0) inputTokens,COALESCE(SUM(output_tokens),0) outputTokens FROM ai_usage WHERE at>=?',new Date(Date.now()-30*86400000).toISOString());
  return {checkedAt:new Date().toISOString(),durationMs:Date.now()-started,services,ai:{connected:false,period:'Last 30 days',usage,detail:'No paid AI requests are made by the current assistant.'}};
}
