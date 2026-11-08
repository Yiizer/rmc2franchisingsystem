// Monitoring PDF export (feedback round 2026-11-08b, item 4). Built in the browser with pdf-lib (already a dependency, loaded only when
// someone exports) from the numbers already on screen: no extra request and no new role path.
// Colours are never written here: every one is read from the page's tokens (operations-tokens.css / the --pd-* aliases) at export time.
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';

export type PdfModel = {
  rangeLabel: string; periodLabel: string; compareText: string; generatedAt: string; asOf: string; fileName: string;
  kpis: { label: string; value: string; delta: string; tone: 'good' | 'bad' | 'neutral'; sub: string; color: string }[];
  trend: { noun: string; labels: string[]; received: number[]; sent: number[]; future: boolean[] };
  weekdays: { day: string; sent: number }[] | null; weekdayNote: string;
  funnel: { step: string; count: number; ofFirst: string; ofBefore: string }[];
  timing: { name: string; created: string; avgCreate: string; sent: string; avgHandling: string }[];
};

const TOKENS = ['--ops-ink', '--ops-muted', '--ops-line', '--ops-surface', '--ops-navy', '--ops-done', '--ops-error', '--pd-received', '--pd-sent', '--pd-track', '--pd-neutral-bar', '--pd-declined', '--pd-idle'] as const;
type Token = typeof TOKENS[number];

/** Resolves a CSS colour token on `root` to 0..1 RGB via a probe element (handles rgb(), rgba() and color(srgb …) from color-mix). */
function readTokens(root: HTMLElement, rgb: (r: number, g: number, b: number) => RGB): Record<Token, RGB> {
  const probe = document.createElement('span');
  probe.style.display = 'none'; root.appendChild(probe);
  try {
    return Object.fromEntries(TOKENS.map(name => {
      probe.style.color = ''; probe.style.color = `var(${name})`;
      const value = getComputedStyle(probe).color, srgb = /color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/.exec(value), legacy = /rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/.exec(value);
      const [r, g, b] = srgb ? srgb.slice(1, 4).map(Number) : legacy ? legacy.slice(1, 4).map(n => Number(n) / 255) : [0, 0, 0];
      return [name, rgb(r, g, b)];
    })) as Record<Token, RGB>;
  } finally { probe.remove(); }
}

const W = 842, H = 595, M = 32; // A4 landscape, points

export async function buildMonitoringPdf(model: PdfModel, root: HTMLElement): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const c = readTokens(root, rgb), doc = await PDFDocument.create();
  doc.setTitle(`Monitoring · ${model.rangeLabel} · ${model.periodLabel}`); doc.setCreator('RMC2 Coverdesk'); doc.setCreationDate(new Date());
  const regular = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const supported = new Set(regular.getCharacterSet());
  // The standard PDF font covers Latin-1 and common punctuation; anything else (e.g. a name in another script) prints as "?".
  const clean = (text: string) => [...text.replace(/→/g, '->').replace(/−/g, '-')].map(ch => supported.has(ch.codePointAt(0)!) ? ch : '?').join('');
  const pages: PDFPage[] = [];
  const newPage = () => { const p = doc.addPage([W, H]); pages.push(p); return p; };
  let page = newPage();
  const fit = (text: string, font: PDFFont, size: number, width: number) => {
    let out = clean(text);
    if (font.widthOfTextAtSize(out, size) <= width) return out;
    while (out.length > 1 && font.widthOfTextAtSize(out + '…', size) > width) out = out.slice(0, -1);
    return out + '…';
  };
  /** y is measured from the top of the page to the text baseline. */
  const text = (value: string, x: number, y: number, size = 9, font = regular, color = c['--ops-ink'], opts: { width?: number; align?: 'left' | 'right' | 'center' } = {}) => {
    const shown = opts.width ? fit(value, font, size, opts.width) : clean(value), w = font.widthOfTextAtSize(shown, size);
    const dx = opts.align === 'right' && opts.width ? opts.width - w : opts.align === 'center' && opts.width ? (opts.width - w) / 2 : 0;
    page.drawText(shown, { x: x + dx, y: H - y, size, font, color });
  };
  const box = (x: number, y: number, w: number, h: number, fill?: RGB, border?: RGB) => page.drawRectangle({ x, y: H - y - h, width: w, height: h, color: fill, borderColor: border, borderWidth: border ? 0.75 : 0 });
  const line = (x1: number, y1: number, x2: number, y2: number, color = c['--ops-line']) => page.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: 0.75, color });
  const card = (x: number, y: number, w: number, h: number, title: string, note: string) => { box(x, y, w, h, c['--ops-surface'], c['--ops-line']); text(title, x + 10, y + 16, 10, bold, c['--ops-navy'], { width: w - 20 }); if (note) text(note, x + 10, y + 28, 7.5, regular, c['--ops-muted'], { width: w - 20 }); };

  // ---------- Header ----------
  text('Monitoring', M, M + 14, 18, bold, c['--ops-navy']);
  text(`Generated ${model.generatedAt} (Manila time)`, W - M - 300, M + 6, 8, regular, c['--ops-muted'], { width: 300, align: 'right' });
  text(`Data as of ${model.asOf}`, W - M - 300, M + 17, 8, regular, c['--ops-muted'], { width: 300, align: 'right' });
  text(`${model.rangeLabel} · ${model.periodLabel}`, M, M + 34, 12, bold);
  text(model.compareText, M, M + 47, 8.5, regular, c['--ops-muted'], { width: W - 2 * M });
  line(M, M + 56, W - M, M + 56);

  // ---------- KPI tiles ----------
  const gap = 8, tileW = (W - 2 * M - gap * 4) / 5, tileY = M + 66, tileH = 62;
  model.kpis.forEach((kpi, i) => {
    const x = M + i * (tileW + gap);
    box(x, tileY, tileW, tileH, c['--ops-surface'], c['--ops-line']);
    box(x, tileY, 3, tileH, c[kpi.color as Token] || c['--ops-muted']);
    text(kpi.label, x + 10, tileY + 14, 8, bold, c['--ops-muted'], { width: tileW - 16 });
    text(kpi.value, x + 10, tileY + 36, 20, bold, c['--ops-navy']);
    if (kpi.delta) text(kpi.delta, x + 10 + bold.widthOfTextAtSize(clean(kpi.value), 20) + 8, tileY + 34, 8.5, bold, kpi.tone === 'good' ? c['--ops-done'] : kpi.tone === 'bad' ? c['--ops-error'] : c['--ops-muted']);
    text(kpi.sub, x + 10, tileY + 52, 7.5, regular, c['--ops-muted'], { width: tileW - 16 });
  });

  // ---------- Row 2: trend + busiest day ----------
  const rowY = tileY + tileH + 12, rowH = 186, wideW = Math.round((W - 2 * M - 12) * 0.66), narrowX = M + wideW + 12, narrowW = W - M - narrowX;
  card(M, rowY, wideW, rowH, 'Proposals over time', `Inquiries received and proposals sent, per ${model.trend.noun}`);
  // legend
  let lx = M + wideW - 130;
  for (const [label, token] of [['Received', '--pd-received'], ['Sent', '--pd-sent']] as const) { box(lx, rowY + 9, 8, 8, c[token]); text(label, lx + 12, rowY + 16, 8, regular, c['--ops-muted']); lx += 62; }
  {
    const x0 = M + 34, y0 = rowY + 40, cw = wideW - 34 - 12, ch = rowH - 40 - 24, n = model.trend.labels.length;
    // Whole-number gridlines: one per unit up to 4, otherwise 4 equal steps on a top rounded up to a multiple of 4.
    const max = Math.max(1, ...model.trend.received, ...model.trend.sent), steps = Math.min(4, max), top = max <= 4 ? max : Math.ceil(max / 4) * 4;
    for (let k = 0; k <= steps; k++) { const y = y0 + ch - ch * k / steps; line(x0, y, x0 + cw, y, c['--ops-line']); text(String(top * k / steps), M + 6, y + 3, 7, regular, c['--ops-muted'], { width: 22, align: 'right' }); }
    const group = cw / Math.max(1, n), bar = Math.max(1, Math.min(10, group * 0.36));
    const every = Math.max(1, Math.ceil(n * 34 / cw));
    model.trend.labels.forEach((label, i) => {
      const gx = x0 + i * group + group / 2;
      if (!model.trend.future[i]) ([[model.trend.received[i], '--pd-received', -bar - 0.5], [model.trend.sent[i], '--pd-sent', 0.5]] as const).forEach(([v, token, dx]) => { if (v > 0) { const h = ch * v / top; box(gx + dx, y0 + ch - h, bar, h, c[token]); } });
      if (i % every === 0 || i === n - 1 && n <= 12) text(label, gx - 20, y0 + ch + 11, 6.5, regular, c['--ops-muted'], { width: 40, align: 'center' });
    });
  }
  card(narrowX, rowY, narrowW, rowH, 'Busiest day', 'Proposals sent by weekday');
  if (model.weekdays) {
    const max = Math.max(1, ...model.weekdays.map(d => d.sent)), top = model.weekdays.reduce((best, d, i, all) => d.sent > all[best].sent ? i : best, 0), few = model.weekdays.reduce((s, d) => s + d.sent, 0) < 5;
    model.weekdays.forEach((d, i) => {
      const y = rowY + 44 + i * 18, trackX = narrowX + 44, trackW = narrowW - 44 - 36, hi = !few && i === top;
      text(d.day, narrowX + 10, y + 8, 8, hi ? bold : regular, hi ? c['--ops-navy'] : c['--ops-muted']);
      box(trackX, y, trackW, 9, c['--pd-track']);
      if (d.sent) box(trackX, y, Math.max(3, trackW * d.sent / max), 9, hi ? c['--pd-sent'] : c['--pd-neutral-bar']);
      text(String(d.sent), trackX + trackW + 4, y + 8, 8, hi ? bold : regular, c['--ops-ink'], { width: 22, align: 'right' });
    });
  }
  if (model.weekdayNote) text(model.weekdayNote, narrowX + 10, rowY + rowH - 10, 7.5, regular, c['--ops-muted'], { width: narrowW - 20 });

  // ---------- Row 3: pipeline + time per employee ----------
  const lowY = rowY + rowH + 12, lowH = H - M - 14 - lowY;
  card(M, lowY, wideW, lowH, 'Pipeline', 'Inquiries received in this period, step by step');
  {
    const first = model.funnel[0]?.count || 0, colX = [M + 10, M + 80, M + wideW - 190, M + wideW - 140, M + wideW - 76], barW = colX[2] - colX[1] - 14;
    text('Count', colX[2], lowY + 44, 7, bold, c['--ops-muted'], { width: 36, align: 'right' }); text('Of received', colX[3], lowY + 44, 7, bold, c['--ops-muted'], { width: 54, align: 'right' }); text('Of step before', colX[4], lowY + 44, 7, bold, c['--ops-muted'], { width: 64, align: 'right' });
    model.funnel.forEach((step, i) => {
      const y = lowY + 54 + i * ((lowH - 62) / Math.max(1, model.funnel.length)), last = i === model.funnel.length - 1;
      text(step.step, colX[0], y + 9, 8, bold);
      box(colX[1], y + 1, barW, 10, c['--pd-track']);
      if (step.count && first) box(colX[1], y + 1, Math.max(2, barW * step.count / first), 10, last ? c['--pd-sent'] : c['--pd-received']);
      text(String(step.count), colX[2], y + 9, 9, bold, c['--ops-navy'], { width: 36, align: 'right' });
      text(step.ofFirst, colX[3], y + 9, 8, regular, c['--ops-muted'], { width: 54, align: 'right' });
      text(step.ofBefore, colX[4], y + 9, 8, regular, c['--ops-muted'], { width: 64, align: 'right' });
    });
  }
  // Time per employee: as many rows as fit on page 1, the rest on following pages (full width, header repeated).
  // The numeric columns keep fixed widths (they sum to 168); the name takes the rest.
  const columns = (x: number, w: number) => { const nameW = w - 168; return [{ x, w: nameW, key: 'name' as const, label: 'Employee', right: false }, { x: x + nameW, w: 38, key: 'created' as const, label: 'Created', right: true }, { x: x + nameW + 38, w: 48, key: 'avgCreate' as const, label: 'Avg create', right: true }, { x: x + nameW + 86, w: 26, key: 'sent' as const, label: 'Sent', right: true }, { x: x + nameW + 112, w: 56, key: 'avgHandling' as const, label: 'Avg handling', right: true }]; };
  const table = (x: number, y: number, w: number, rows: PdfModel['timing'], rowH2: number) => {
    const cols = columns(x, w);
    box(x, y, w, 15, c['--pd-track']);
    for (const col of cols) text(col.label, col.x + 4, y + 10.5, 7, bold, c['--ops-muted'], { width: col.w - 8, align: col.right ? 'right' : 'left' });
    rows.forEach((row, i) => { const ry = y + 15 + i * rowH2; for (const col of cols) text(row[col.key], col.x + 4, ry + rowH2 - 4, 7.5, col.key === 'name' ? bold : regular, c['--ops-ink'], { width: col.w - 8, align: col.right ? 'right' : 'left' }); line(x, ry + rowH2, x + w, ry + rowH2); });
  };
  card(narrowX, lowY, narrowW, lowH, 'Time per employee', 'Wall-clock averages for this period');
  const ROW = 14, fits = Math.max(1, Math.floor((lowH - 40 - 15 - 14) / ROW));
  if (!model.timing.length) text('No employee activity in this period.', narrowX + 10, lowY + 56, 8, regular, c['--ops-muted']);
  else {
    const firstRows = model.timing.length <= fits + 1 ? model.timing : model.timing.slice(0, fits);
    table(narrowX + 6, lowY + 38, narrowW - 12, firstRows, ROW);
    if (firstRows.length < model.timing.length) {
      text(`${model.timing.length - firstRows.length} more on the next page`, narrowX + 10, lowY + lowH - 7, 7.5, bold, c['--ops-navy']);
      let rest = model.timing.slice(firstRows.length);
      while (rest.length) {
        page = newPage();
        text('Time per employee (continued)', M, M + 14, 13, bold, c['--ops-navy']);
        text(`${model.rangeLabel} · ${model.periodLabel}`, M, M + 28, 8.5, regular, c['--ops-muted']);
        const perPage = Math.floor((H - 2 * M - 60) / 16);
        table(M, M + 40, W - 2 * M, rest.slice(0, perPage), 16);
        rest = rest.slice(perPage);
      }
    }
  }
  pages.forEach((p, i) => { page = p; text(`RMC2 Monitoring · ${model.rangeLabel} · ${model.periodLabel} · Page ${i + 1} of ${pages.length}`, M, H - M + 18, 7, regular, c['--ops-muted'], { width: W - 2 * M, align: 'right' }); });
  return doc.save();
}

export function downloadPdf(bytes: Uint8Array, fileName: string) {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' }), url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = fileName;
  document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
