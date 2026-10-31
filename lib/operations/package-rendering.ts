import { files, isStorageError } from './file-store';
import { sourceHeaderArtwork } from './office-artwork';
import type { GeneratedPackage, InquiryRecord, ProposalRenderer } from './types';

// Older packages have no renderer marker. Inspect the saved PDF itself rather
// than guessing from its date or changing a submitted package.
const known=new Map<string,ProposalRenderer>();
/** The renderer when it is known without reading any file (marker on the package, or already inspected); else undefined. */
export function cachedRenderer(generated:GeneratedPackage):ProposalRenderer|undefined{
  if(generated.renderer&&generated.renderer!=='native-word')return generated.renderer;
  return known.get(generated.pdf);
}
function remember(generated:GeneratedPackage,renderer:ProposalRenderer){
  if(!known.has(generated.pdf)&&known.size>=500)known.delete(known.keys().next().value!);
  known.set(generated.pdf,renderer);
}
/**
 * With `rethrowTransient`, a temporary storage outage is thrown (503) instead of answered as 'unknown', so a caller that
 * must not guess (submit) can tell the user to retry. Without it the screens simply show 'unknown' and re-check next time.
 */
export async function packageRenderer(generated:GeneratedPackage,opts:{rethrowTransient?:boolean}={}):Promise<ProposalRenderer>{
  const cached=cachedRenderer(generated);if(cached)return cached;
  try{
    const pdf=(await files().get(generated.pdf)).toString('latin1');
    let renderer:ProposalRenderer=pdf.includes('Skia/PDF')?'browser-print':pdf.includes('LibreOffice')?'native-word':'unknown';
    if(renderer==='native-word'){
      const docx=await files().get(generated.docx);
      if(sourceHeaderArtwork(docx).length)renderer='native-word-legacy';
    }
    remember(generated,renderer);return renderer;
  }catch(error){
    // A permanently missing file stays 'unknown'; a temporary storage problem is never remembered so it is re-checked.
    if(isStorageError(error)&&error.code==='not_found')remember(generated,'unknown');
    else if(opts.rethrowTransient&&isStorageError(error)&&error.code==='unavailable')throw error;
    return 'unknown';
  }
}
// Reading is bounded so a cold cache over remote storage cannot open hundreds of downloads at once.
export async function packageRenderers(records:InquiryRecord[]){
  const packages=new Map<string,GeneratedPackage>();
  for(const record of records)for(const generated of [...(record.generated?[record.generated]:[]),...record.submissions.map(version=>version.generated)])packages.set(generated.id,generated);
  const list=[...packages.values()],found:ProposalRenderer[]=[];let next=0;
  await Promise.all(Array.from({length:Math.min(6,list.length)},async()=>{for(let i=next++;i<list.length;i=next++)found[i]=await packageRenderer(list[i]);}));
  return Object.fromEntries(list.map((generated,i)=>[generated.id,found[i]]));
}
