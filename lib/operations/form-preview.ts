import ExcelJS from 'exceljs';
import PizZip from 'pizzip';

type VisualStyle = Record<string, string | number>;
export type PreviewCell = { address: string; value: string; x: number; y: number; width: number; height: number; textWidth: number; style: VisualStyle; textStyle: VisualStyle; runs?: { text: string; style: VisualStyle }[] };
export type PreviewSheet = { name: string; width: number; height: number; cells: PreviewCell[]; images: { src: string; x: number; y: number; width: number; height: number }[]; empty: boolean };
export type WorkbookPreview = { sheets: PreviewSheet[] };

const defaultTheme = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
function themeColors(bytes: Buffer) {
  const theme = [...defaultTheme];
  const xml = new PizZip(bytes).file('xl/theme/theme1.xml')?.asText() || '';
  ['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'].forEach((name, index) => {
    const color = xml.match(new RegExp(`<a:${name}>[\\s\\S]*?(?:val|lastClr)="([0-9A-Fa-f]{6})"[\\s\\S]*?</a:${name}>`));
    if (color) theme[index] = color[1];
  });
  return theme;
}
function color(value: (Partial<ExcelJS.Color> & { tint?: number }) | undefined, theme: string[], fallback = '#000000') {
  if (!value) return fallback;
  const hex = value.argb?.slice(-6) || (value.theme !== undefined ? theme[value.theme] : undefined);
  if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return fallback;
  const tint = Math.max(-1, Math.min(1, value.tint || 0));
  return '#' + [0,2,4].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16);
    return Math.round(tint < 0 ? channel * (1 + tint) : channel + (255 - channel) * tint).toString(16).padStart(2, '0');
  }).join('');
}
function fontStyle(font: Partial<ExcelJS.Font> | undefined, theme: string[]): VisualStyle {
  return { fontFamily: font?.name || 'Calibri, Arial, sans-serif', fontSize: (font?.size || 11) * 4 / 3, fontWeight: font?.bold ? 700 : 400, fontStyle: font?.italic ? 'italic' : 'normal', color: color(font?.color, theme), textDecoration: [font?.underline ? 'underline' : '', font?.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none' };
}
function borderStyle(border: Partial<ExcelJS.Border> | undefined, theme: string[]) {
  if (!border?.style) return undefined;
  const width = border.style === 'double' || border.style === 'thick' ? 3 : border.style.startsWith('medium') ? 2 : 1;
  const style = border.style === 'double' ? 'double' : /dash/i.test(border.style) ? 'dashed' : border.style === 'dotted' ? 'dotted' : 'solid';
  return `${width}px ${style} ${color(border.color, theme)}`;
}
function displayValue(value: ExcelJS.CellValue, format: string): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    const day = value.getUTCDate(), month = value.getUTCMonth() + 1, year = value.getUTCFullYear();
    const pad = (n: number) => String(n).padStart(2, '0');
    if (!/[dmy]/i.test(format) || format === 'General') return `${year}-${pad(month)}-${pad(day)}`;
    return format.replace(/"([^"]*)"/g, '$1').replace(/yyyy|yy|mmmm|mmm|mm|m|dd|d/gi, token => ({ yyyy: String(year), yy: String(year).slice(-2), mmmm: value.toLocaleString('en', { month: 'long', timeZone: 'UTC' }), mmm: value.toLocaleString('en', { month: 'short', timeZone: 'UTC' }), mm: pad(month), m: String(month), dd: pad(day), d: String(day) })[token.toLowerCase()] || token);
  }
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map(run => run.text).join('');
    if ('result' in value) return displayValue(value.result as ExcelJS.CellValue, format);
    if ('formula' in value || 'sharedFormula' in value) return '(No saved formula result)';
    if ('text' in value) return value.text;
    if ('error' in value) return value.error;
    return '';
  }
  if (typeof value === 'number' && format !== 'General' && /[0#]/.test(format)) {
    const decimal = format.match(/\.([0#]+)/)?.[1] || '';
    const number = new Intl.NumberFormat('en-PH', { useGrouping: format.includes(','), minimumFractionDigits: Math.min(12, (decimal.match(/0/g) || []).length), maximumFractionDigits: Math.min(12, decimal.length) }).format(format.includes('%') ? value * 100 : value);
    const currency = format.match(/[₱$€£]/)?.[0] || '';
    return currency + number + (format.includes('%') ? '%' : '');
  }
  return String(value);
}
const colNumber = (letters: string) => [...letters.toUpperCase()].reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0);
function rangeBounds(range: string) {
  const match = range.replace(/\$/g, '').match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  return match ? { left: colNumber(match[1]), top: Number(match[2]), right: colNumber(match[3]), bottom: Number(match[4]) } : undefined;
}

/** Read the original bytes only. No working fields are used and no workbook is written. */
export async function previewWorkbook(bytes: Buffer): Promise<WorkbookPreview> {
  if (bytes.length > 7 * 1024 * 1024) throw new Error('The attachment is too large to preview. Download the original Excel file.');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  if (workbook.worksheets.length > 20) throw new Error('Too many sheets to preview. Download the original Excel file.');
  const theme = themeColors(bytes);
  const sheets: PreviewSheet[] = [];
  for (const sheet of workbook.worksheets.filter(sheet => sheet.state === 'visible')) {
    if (sheet.actualRowCount > 500 || sheet.actualColumnCount > 100) throw new Error('A populated sheet is too large to preview. Download the original Excel file.');
    let lastRow = 1, lastCol = 1;
    sheet.eachRow(row => row.eachCell(cell => {
      if (cell.value !== null || Object.values(cell.border || {}).some(side => side?.style) || (cell.fill?.type === 'pattern' && cell.fill.pattern !== 'none')) {
        lastRow = Math.max(lastRow, row.number); lastCol = Math.max(lastCol, Number(cell.col));
      }
    }));
    const merges = (sheet.model.merges || []).map(rangeBounds).filter((range): range is NonNullable<typeof range> => !!range);
    for (const merge of merges) { lastRow = Math.max(lastRow, merge.bottom); lastCol = Math.max(lastCol, merge.right); }
    for (const image of sheet.getImages()) {
      const range = image.range as ExcelJS.ImageRange & { ext?: { width: number; height: number } };
      lastRow = Math.max(lastRow, Math.ceil(range.br?.row ?? range.tl.row + (range.ext?.height || 100) / 20));
      lastCol = Math.max(lastCol, Math.ceil(range.br?.col ?? range.tl.col + (range.ext?.width || 100) / 64));
    }
    if (lastRow > 500 || lastCol > 100) throw new Error('The sheet layout is too large to preview. Download the original Excel file.');
    const x = [0], y = [0];
    for (let col = 1; col <= lastCol; col++) x.push(x.at(-1)! + (sheet.getColumn(col).hidden ? 0 : Math.floor((sheet.getColumn(col).width || sheet.properties.defaultColWidth || 8.43) * 7 + 5)));
    for (let row = 1; row <= lastRow; row++) y.push(y.at(-1)! + (sheet.getRow(row).hidden ? 0 : (sheet.getRow(row).height || sheet.properties.defaultRowHeight || 15) * 4 / 3));
    const cells: PreviewCell[] = [];
    for (let row = 1; row <= lastRow; row++) for (let col = 1; col <= lastCol; col++) {
      const cell = sheet.getCell(row, col);
      if (!y[row] || y[row] === y[row - 1] || x[col] === x[col - 1] || (cell.isMerged && cell.master.address !== cell.address)) continue;
      const merge = merges.find(range => range.top === row && range.left === col);
      const endCol = merge?.right || col, endRow = merge?.bottom || row;
      const value = displayValue(cell.value, cell.numFmt || 'General');
      const width = x[endCol] - x[col - 1], height = y[endRow] - y[row - 1];
      let textWidth = width;
      if (value && !cell.alignment?.wrapText && !merge && !cell.alignment?.horizontal?.includes('right') && cell.alignment?.horizontal !== 'center') {
        for (let next = col + 1; next <= lastCol; next++) {
          if (sheet.getCell(row, next).value !== null) break;
          textWidth += x[next] - x[next - 1];
        }
      }
      const style: VisualStyle = {};
      for (const side of ['Top','Right','Bottom','Left'] as const) {
        const border = borderStyle(cell.border?.[side.toLowerCase() as 'top'], theme);
        if (border) style['border' + side] = border;
      }
      if (cell.fill?.type === 'pattern' && cell.fill.pattern !== 'none') style.backgroundColor = color(cell.fill.fgColor, theme, '#ffffff');
      const horizontal = cell.alignment?.horizontal;
      const textStyle: VisualStyle = { ...fontStyle(cell.font, theme), textAlign: horizontal === 'center' || horizontal === 'centerContinuous' ? 'center' : horizontal === 'right' || (typeof cell.value === 'number' && !horizontal) ? 'right' : 'left', justifyContent: cell.alignment?.vertical === 'middle' ? 'center' : cell.alignment?.vertical === 'top' ? 'flex-start' : 'flex-end', whiteSpace: cell.alignment?.wrapText ? 'pre-wrap' : 'pre', overflowWrap: cell.alignment?.wrapText ? 'anywhere' : 'normal' };
      const runs = cell.value && typeof cell.value === 'object' && 'richText' in cell.value ? cell.value.richText.map(run => ({ text: run.text, style: fontStyle({ ...cell.font, ...run.font }, theme) })) : undefined;
      cells.push({ address: cell.address, value, x: x[col - 1], y: y[row - 1], width, height, textWidth, style, textStyle, ...(runs ? { runs } : {}) });
    }
    const coordinate = (positions: number[], position: number) => {
      const index = Math.floor(position); return (positions[index] || 0) + (position - index) * ((positions[index + 1] || positions[index]) - positions[index]);
    };
    const images: PreviewSheet['images'] = [];
    for (const drawing of sheet.getImages()) {
      const range = drawing.range as ExcelJS.ImageRange & { ext?: { width: number; height: number } };
      const image = workbook.getImage(Number(drawing.imageId));
      if (!image || !['png', 'jpeg', 'jpg', 'gif'].includes(image.extension)) continue;
      const data = image.buffer ? Buffer.from(image.buffer) : image.base64 ? Buffer.from(image.base64.replace(/^data:[^,]+,/, ''), 'base64') : undefined;
      if (!data || data.length > 5 * 1024 * 1024) continue;
      const left = coordinate(x, range.tl.col), top = coordinate(y, range.tl.row);
      const width = range.ext?.width || (range.br ? coordinate(x, range.br.col) - left : 100);
      const height = range.ext?.height || (range.br ? coordinate(y, range.br.row) - top : 100);
      images.push({ src: `data:image/${image.extension};base64,${data.toString('base64')}`, x: left, y: top, width, height });
    }
    sheets.push({ name: sheet.name, width: x.at(-1)!, height: y.at(-1)!, cells, images, empty: !cells.some(cell => cell.value) && !images.length });
  }
  return { sheets };
}
