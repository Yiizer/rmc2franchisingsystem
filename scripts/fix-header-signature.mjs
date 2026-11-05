// Some proposal templates (Total CorpoShield D094 and D096) carry the signer's signature image in the page header.
// That header is used on every page, so the signature is printed over the text on most pages. This writes a fixed
// COPY with the signature moved into the letter body, next to "Best regards,", where the other templates have it
// (anchored to that paragraph, 27 pt down and 32 pt in, as in D095). The original file is never changed.
//   node scripts/fix-header-signature.mjs <in.docx> <out.docx>
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import PizZip from 'pizzip';

const [input, output] = process.argv.slice(2);
assert.ok(input && output, 'usage: node scripts/fix-header-signature.mjs <in.docx> <out.docx>');
const zip = new PizZip(await readFile(input));
const EMU = 12700, isSignature = drawing => { const e = drawing.match(/<wp:extent cx="(\d+)" cy="(\d+)"/); if (!e) return false; const w = e[1] / EMU, h = e[2] / EMU; return w > 60 && w < 200 && h > 40 && h < 150; };

let moved = null;
for (const name of Object.keys(zip.files).filter(n => /^word\/header\d+\.xml$/.test(n))) {
  let xml = zip.file(name).asText();
  // The whole run that holds the signature drawing (header-anchored, deep below the header).
  const run = [...xml.matchAll(/<w:r(?:\s[^>]*)?>(?:(?!<\/w:r>)[\s\S])*?<w:drawing>[\s\S]*?<\/w:drawing>(?:(?!<w:r[ >])[\s\S])*?<\/w:r>/g)].find(m => {
    const d = m[0].match(/<w:drawing>[\s\S]*?<\/w:drawing>/)[0], v = d.match(/positionV relativeFrom="\w+"[\s\S]*?<wp:posOffset>(-?\d+)/);
    return isSignature(d) && v && Number(v[1]) / EMU > 200;
  });
  if (!run) continue;
  assert.equal(moved, null, 'more than one header signature found');
  const rels = zip.file('word/_rels/' + name.slice(5) + '.rels').asText(), id = run[0].match(/r:embed="([^"]+)"/)[1];
  const target = (rels.match(new RegExp('<Relationship[^>]*Id="' + id + '"[^>]*/>')) || [''])[0].match(/Target="([^"]+)"/)?.[1];
  assert.ok(target, 'signature image relationship not found');
  moved = { header: name, run: run[0], id, target };
  zip.file(name, xml.replace(run[0], ''));
}
assert.ok(moved, 'no header signature found: nothing to fix');

// Give document.xml its own relationship to the same image.
const relsName = 'word/_rels/document.xml.rels'; let rels = zip.file(relsName).asText();
const used = new Set([...rels.matchAll(/Id="(rId\d+)"/g)].map(m => m[1])); let n = 100; while (used.has('rId' + n)) n++;
const newId = 'rId' + n;
rels = rels.replace('</Relationships>', `<Relationship Id="${newId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${moved.target}"/></Relationships>`);
zip.file(relsName, rels);

// Re-anchor the drawing to the "Best regards," paragraph: 27 pt below it, 32 pt from the column edge (as in D095).
let run = moved.run.replace(`r:embed="${moved.id}"`, `r:embed="${newId}"`)
  .replace(/(<wp:positionV relativeFrom=")\w+("[^>]*>\s*<wp:posOffset>)-?\d+/, `$1paragraph$2${27 * EMU}`)
  .replace(/(<wp:positionH relativeFrom=")\w+("[^>]*>\s*<wp:posOffset>)-?\d+/, `$1column$2${32 * EMU}`);
const docName = 'word/document.xml'; let doc = zip.file(docName).asText();
const paragraph = [...doc.matchAll(/<w:p[ >](?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g)].find(m => m[0].replace(/<[^>]+>/g, '').trim().startsWith('Best regards'));
assert.ok(paragraph, '"Best regards," paragraph not found');
const fixed = paragraph[0].replace(/<\/w:p>$/, run + '</w:p>');
doc = doc.slice(0, paragraph.index) + fixed + doc.slice(paragraph.index + paragraph[0].length);
zip.file(docName, doc);

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log('Moved the signature from', moved.header.slice(5), 'into the "Best regards," paragraph ->', output);
