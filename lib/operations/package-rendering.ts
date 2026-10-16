import { readFileSync } from 'node:fs';
import { safeStorage } from './database';
import { sourceHeaderArtwork } from './office-artwork';
import type { GeneratedPackage, InquiryRecord, ProposalRenderer } from './types';

// Older packages have no renderer marker. Inspect the saved PDF itself rather
// than guessing from its date or changing a submitted package.
const known=new Map<string,ProposalRenderer>();
export function packageRenderer(generated:GeneratedPackage):ProposalRenderer{
  if(generated.renderer&&generated.renderer!=='native-word')return generated.renderer;
  const cached=known.get(generated.pdf);if(cached)return cached;
  try{
    const pdf=readFileSync(safeStorage(generated.pdf)).toString('latin1');
    let renderer:ProposalRenderer=pdf.includes('Skia/PDF')?'browser-print':pdf.includes('LibreOffice')?'native-word':'unknown';
    if(renderer==='native-word'){
      const docx=readFileSync(safeStorage(generated.docx));
      if(sourceHeaderArtwork(docx).length)renderer='native-word-legacy';
    }
    if(known.size>=500)known.delete(known.keys().next().value!);
    known.set(generated.pdf,renderer);return renderer;
  }catch{return 'unknown';}
}
export function packageRenderers(records:InquiryRecord[]){
  return Object.fromEntries(records.flatMap(record=>[...(record.generated?[record.generated]:[]),...record.submissions.map(version=>version.generated)]).map(generated=>[generated.id,packageRenderer(generated)]));
}
