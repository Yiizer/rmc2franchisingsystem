import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import ExcelJS from 'exceljs';

await mkdir('test-results', { recursive: true });
const checks = [], temporary = [];
const pass = name => { checks.push(name); console.log('PASS ' + name); };
async function moduleFrom(file, name) {
  const target = process.cwd() + '/test-results/' + name + '.mjs'; temporary.push(target);
  await writeFile(target, ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  return import(pathToFileURL(target).href);
}
try {
  const { previewWorkbook } = await moduleFrom('lib/operations/form-preview.ts', 'preview-module');
  const { suggestTemplates } = await moduleFrom('lib/operations/suggestions.ts', 'suggestions-module');
  const original = await readFile('resources/private/franchise-form.xlsx'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const hash = sha(original), preview = await previewWorkbook(original), sheet = preview.sheets[0];
  assert.equal(sha(original), hash); pass('Preview does not mutate the original workbook bytes');
  assert.equal(sheet.cells.find(cell => cell.address === 'B10').value, 'BALUCUC NATIONAL HIGH SCHOOL');
  assert.equal(sheet.cells.find(cell => cell.address === 'J7').value, '10-08-26'); pass('Original company and formatted date are shown');
  assert.equal(sheet.cells.find(cell => cell.address === 'A7').style.borderTop, '1px solid #2f5496');
  assert.equal(sheet.cells.find(cell => cell.address === 'A7').runs[0].style.fontWeight, 700); pass('Original borders, theme colors and rich-text emphasis are retained');
  assert.equal(sheet.images.length, 2); assert.ok(sheet.images.every(image => image.src.startsWith('data:image/png;base64,'))); pass('Embedded source images are included without external URLs');
  assert.ok(sheet.height < 2000); pass('A thousand formatted empty rows do not become a thousand-row preview');

  const fixture = new ExcelJS.Workbook(), first = fixture.addWorksheet('Submitted details'), second = fixture.addWorksheet('Census');
  first.mergeCells('A1:C2'); first.getCell('A1').value = 'Merged account name'; first.getCell('A1').alignment = { wrapText: true };
  first.getColumn(1).width = 20; first.getColumn(2).width = 12; first.getRow(1).height = 30;
  second.getCell('A1').value = 'Member count'; second.getCell('B1').value = 12;
  const sample = await previewWorkbook(Buffer.from(await fixture.xlsx.writeBuffer()));
  assert.deepEqual(sample.sheets.map(sheet => sheet.name), ['Submitted details', 'Census']);
  assert.equal(sample.sheets[0].cells.filter(cell => cell.value === 'Merged account name').length, 1);
  assert.ok(sample.sheets[0].cells.find(cell => cell.address === 'A1').width > 200); pass('Multiple sheets and merged cells preserve their native layout');

  const templates = JSON.parse(await readFile('resources/private/catalog.json', 'utf8'));
  const government = suggestTemplates({ sector: 'DepEd', requestedPlan: 'DepEd plan' }, templates);
  assert.ok(government.every(option => option.template.sector === 'Government'));
  assert.ok(government[0].reasons.some(reason => reason.includes('DepEd'))); pass('Government suggestions explain the matching form sector');
  const requested = suggestTemplates({ sector: 'Private', requestedPlan: 'Total CorpoShield' }, templates);
  assert.ok(requested.every(option => option.template.family === 'Total CorpoShield')); pass('A requested product family changes the suggestions');
  const unknown = suggestTemplates({ sector: 'Unconfirmed' }, templates);
  assert.ok(unknown.every(option => !option.reasons.some(reason => reason.includes('private-sector account')))); pass('Unknown sectors do not claim a private-sector match');
  assert.ok(suggestTemplates({ sector: 'DepEd' }, templates.map(template => ({ ...template, active: template.sourceId !== government[0].template.sourceId }))).every(option => option.template.sourceId !== government[0].template.sourceId)); pass('Inactive templates are excluded');
  await writeFile('test-results/form-viewer.json', JSON.stringify({ at: new Date().toISOString(), checks, preview: { name: sheet.name, width: sheet.width, height: sheet.height, images: sheet.images.length } }, null, 2));
  console.log('\n' + checks.length + ' focused checks passed.');
} finally { for (const file of temporary) await unlink(file); }
