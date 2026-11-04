// Makes two fictional forms to email into the test inbox during a demo: an Excel form (imported automatically) and a
// PDF (waits on the Requests page for "Create inquiry"). Needs test-results/demo-online/tmp/sample-form.xlsx from demo-seed-online.mjs.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const out = 'test-results/demo-online/email-these';
await mkdir(out, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const book = new ExcelJS.Workbook(); await book.xlsx.load(await readFile('test-results/demo-online/tmp/sample-form.xlsx'));
const sheet = book.worksheets[0]; book.creator = 'RMC2 demo data (fictional)';
const values = { C7: 'Joanna Reyes', J7: today, D8: 'Batangas', J8: '09175553001', B10: 'Rizal Coastal Foods Corporation', J10: 'PRIVATE', J11: 'Seafood processing', C12: '45 National Highway, Batangas City', D14: 'Ms. Andrea Lopez', B17: 'hr.rizalcoastal@clients.example.test', J16: '09985553002', C18: 'HR Officer', J18: 'None', B21: 'Ms. Andrea Lopez', G21: 'HR Officer', D22: 'Total CorpoHealthCheck', G23: 'Annual', D25: 60, J24: 15, C26: '20–57', J26: '1–50', C29: 'For confirmation', I29: 'For confirmation' };
for (const [cell, value] of Object.entries(values)) sheet.getCell(cell).value = value;
await writeFile(out + '/Franchise-Form-Rizal-Coastal-Foods.xlsx', Buffer.from(await book.xlsx.writeBuffer()));

const pdf = await PDFDocument.create(), page = pdf.addPage([595, 842]), font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
let y = 780; const line = (text, f = font, size = 11) => { page.drawText(text, { x: 60, y, size, font: f }); y -= size + 10; };
line('FRANCHISE INQUIRY FORM (scanned copy)', bold, 15); y -= 6;
for (const text of ['Agent: Paolo Garcia   Branch: Laguna   Date: ' + today, 'Account: Mountain View Academy (private school)', 'Address: 10 Rizal Street, Calamba, Laguna', 'Contact: Mr. Ramon Dela Cruz, School Administrator', 'Requested plan: Group healthcare, annual', 'Employees: 40, ages 24–60   Dependents: 0', '', 'Fictional demo document. No real client or agent.']) line(text);
await writeFile(out + '/Scanned-Inquiry-Mountain-View-Academy.pdf', await pdf.save());
console.log('Wrote 2 files to ' + out);
