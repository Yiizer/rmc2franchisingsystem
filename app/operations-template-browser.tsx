'use client';
import { useState } from 'react';
import { Check, ChevronDown, Eye, Files, Pencil } from 'lucide-react';
import type { CatalogTemplate, CustomizedProposal } from '@/lib/operations/types';

export default function TemplateBrowser({templates,selectedId,customization,editable,busy,onChoose,onPreview,onCustomize}:{
  templates:CatalogTemplate[];selectedId:string;customization?:CustomizedProposal;editable:boolean;busy:boolean;
  onChoose:(id:string)=>void;onPreview:(template:CatalogTemplate)=>void;onCustomize:(id:string)=>void;
}){
  const [open,setOpen]=useState(false);
  const families=[...new Set(templates.map(template=>template.family))];
  const [family,setFamily]=useState(()=>templates.find(template=>template.id===selectedId)?.family||families[0]||'');
  const visible=templates.filter(template=>template.family===family);
  function toggle(){if(!open)setFamily(templates.find(template=>template.id===selectedId)?.family||family);setOpen(!open);}
  return <section className="ops-template-browser" aria-label="All proposal templates">
    <button className="ops-template-browser-trigger" aria-expanded={open} aria-controls="ops-template-browser-list" onClick={toggle}>
      <Files size={20}/><span><b>Browse templates</b><small>{templates.length} supplied plans · Preview before choosing</small></span><ChevronDown size={18} className={open?'open':''}/>
    </button>
    {open&&<div id="ops-template-browser-list" className="ops-template-browser-body">
      <div className="ops-template-families" role="group" aria-label="Filter by plan family">{families.map(value=><button key={value} aria-pressed={family===value} onClick={()=>setFamily(value)}>{value}<span>{templates.filter(template=>template.family===value).length}</span></button>)}</div>
      <div className="ops-template-browser-grid">{visible.map(template=>{
        const selected=template.id===selectedId,customized=customization?.templateId===template.id;
        return <article className={'ops-template-browser-card'+(selected?' selected':'')} key={template.id} aria-label={template.name}>
          <div className="ops-template-browser-card-heading"><h3>{template.name}</h3>{selected&&<span className="ops-template-selected-mark"><Check size={16}/>Selected</span>}</div>
          <div className="ops-template-tags"><span>{template.variant}</span>{customized&&<span className="ops-badge customized">Customized</span>}</div>
          <small className="ops-template-browser-source">Proposal source · {template.sourceId}</small>
          <div className="ops-template-browser-actions">
            <button className="ops-btn" onClick={()=>onPreview(template)}><Eye size={15}/>Preview template</button>
            <button className="ops-btn ops-template-select" disabled={!editable||busy||(selected&&!customized)} onClick={()=>onChoose(template.id)}>{customized?'Use standard':selected?<><Check size={15}/>Selected</>:'Use this template'}</button>
          </div>
          {editable&&<button className="ops-link ops-template-browser-customize" disabled={busy} onClick={()=>onCustomize(template.id)}><Pencil size={13}/>{customized?'Edit customized':'Customize'}</button>}
        </article>;
      })}</div>
    </div>}
  </section>;
}
