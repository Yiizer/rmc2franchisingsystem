'use client';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Download, FileSpreadsheet, RefreshCw, FileText, ExternalLink } from 'lucide-react';
import type { InquiryRecord } from '@/lib/operations/types';
import type { WorkbookPreview } from '@/lib/operations/form-preview';
import { FORM_GROUPS, isSampleForm, manilaTime } from '@/lib/operations/types';
import { api, endpoint } from './operations-common';
import './operations-form.css';

export default function SubmittedFormViewer({ record }: { record: InquiryRecord }) {
  const sample=isSampleForm(record.source),hasWorkbook=!!record.source.storage||sample;
  const sourcePdf=record.source.format==='pdf'||record.source.filename.toLowerCase().endsWith('.pdf');
  const [preview, setPreview] = useState<WorkbookPreview | null>(null), [error, setError] = useState(''), [sheetName, setSheetName] = useState(record.source.sheet), [zoom, setZoom] = useState<number | null>(() => typeof window !== 'undefined' && window.innerWidth < 760 ? 1 : null), [availableWidth, setAvailableWidth] = useState(800);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasWorkbook||sourcePdf) return;
    let active = true;
    api<WorkbookPreview>('form-preview/' + record.id).then(value => { if (active) setPreview(value); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [record.id, record.source.storage,sourcePdf,hasWorkbook]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => setAvailableWidth(Math.max(180, entry.contentRect.width - 40)));
    observer.observe(viewport.current); return () => observer.disconnect();
  }, []);
  const sheet = preview?.sheets.find(sheet => sheet.name === sheetName) || preview?.sheets[0];
  const scale = zoom || (sheet ? Math.min(1, availableWidth / sheet.width) : 1);
  if(sourcePdf&&record.source.storage){const source=endpoint+'/file/'+record.id+'/source';return <div className="ops-submitted-form"><div className="ops-form-file"><FileText size={23}/><div><b>{record.source.filename}</b><small>Agent’s original PDF · Received {manilaTime(record.source.receivedAt)}</small></div><a className="ops-btn" href={source} target="_blank" rel="noreferrer"><ExternalLink size={15}/>Open PDF</a><a className="ops-btn" href={source+'?download=1'}><Download size={15}/>Download original</a></div><iframe title="Agent submitted PDF" src={source+'#view=FitH'} className="ops-submitted-pdf"/><div className="ops-form-view-footer">The exact submitted attachment. Workspace edits do not change this file.</div></div>;}
  return <div className="ops-submitted-form">
    <div className="ops-form-file"><FileSpreadsheet size={23}/><div><b>{record.source.filename}</b><small>{sample?'Sample workbook · Built from sample intake data':<>Received {manilaTime(record.source.receivedAt)} · Original attachment</>}</small></div>{hasWorkbook && <a className="ops-btn" href={endpoint + '/file/' + record.id + '/source'}><Download size={15}/>{sample?'Download sample Excel':'Download Excel'}</a>}</div>
    {hasWorkbook ? <>
      <div className="ops-form-view-controls"><span className={'ops-badge '+(sample?'blue':'slate')}>{sample?'Sample':'Read only'}</span><p>{sample?'Sample data shown in the franchise form template. This was not received from an agent.':'The submitted workbook. Corrections in the workspace do not change this file.'}</p><label>Zoom<select aria-label="Form preview zoom" value={zoom || 'fit'} onChange={event => setZoom(event.target.value === 'fit' ? null : Number(event.target.value))}><option value="fit">Fit width</option><option value="0.75">75%</option><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option></select></label></div>
      {preview && preview.sheets.length > 1 && <div className="ops-sheet-tabs" role="tablist" aria-label="Workbook sheets">{preview.sheets.map(item => <button key={item.name} role="tab" aria-selected={sheet?.name === item.name} onClick={() => setSheetName(item.name)}>{item.name}</button>)}</div>}
      <div className="ops-sheet-viewport" ref={viewport} tabIndex={0} role="region" aria-label={sample?'Sample Excel worksheet':'Submitted Excel worksheet'}>
        {error ? <div className="ops-form-preview-state" role="alert"><b>Preview unavailable</b><p>{error}</p><p>You can download the unchanged Excel attachment above.</p></div> : !sheet ? <div className="ops-form-preview-state"><RefreshCw className="ops-spin" size={20}/><p>Opening submitted workbook…</p></div> : sheet.empty ? <div className="ops-form-preview-state">This worksheet is empty.</div> : <div className="ops-sheet-scale" style={{ width: sheet.width * scale, height: sheet.height * scale }}><div className="ops-sheet-canvas" style={{ width: sheet.width, height: sheet.height, transform: `scale(${scale})` }}>
          {sheet.cells.map(cell => <div key={cell.address} className="ops-sheet-cell" style={{ ...cell.style, left: cell.x, top: cell.y, width: cell.width, height: cell.height }}/>) }
          {sheet.cells.filter(cell => cell.value).map(cell => <div key={cell.address} className="ops-sheet-text" title={cell.address + ': ' + cell.value} data-cell={cell.address} style={{ ...cell.textStyle, left: cell.x, top: cell.y, width: cell.textWidth, height: cell.height } as CSSProperties}><span>{cell.runs ? cell.runs.map((run, index) => <span key={index} style={run.style as CSSProperties}>{run.text}</span>) : cell.value}</span></div>)}
          {/* Original embedded workbook drawings, never external image URLs. */}
          {sheet.images.map((image, index) => <img key={index} src={image.src} alt="Embedded worksheet image" className="ops-sheet-image" style={{ left: image.x, top: image.y, width: image.width, height: image.height }}/>) }
        </div></div>}
      </div><div className="ops-form-view-footer">{sheet?.name || record.source.sheet} · {sheet ? Math.round(scale * 100) + '% · ' : ''}{sample?'Download sample Excel for the workbook view.':'Download Excel for the native workbook view.'}</div>
    </> : <div className="ops-pad"><div className="ops-message slate"><div><b>This starting example has no submitted attachment.</b><p>Import the agent’s original PDF or Excel form to view it here. The values below are sample intake data.</p></div></div>{FORM_GROUPS.map(group => <section className="ops-original-group" key={group.title}><h3>{group.title}</h3><dl>{group.fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{record.source.fields[key] || <span className="ops-muted">Not supplied</span>}</dd></div>)}</dl></section>)}</div>}
  </div>;
}
