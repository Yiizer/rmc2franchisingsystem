'use client';
import {useEffect,useId,useRef,useState} from 'react';
// "+N agents" control: a real button that opens a small popover listing every agent, primary first.
export function orderedAgents(agents:string[],primary:string){const list=[...new Set([primary,...agents].filter(Boolean))];return list;}
export function AgentMore({agents,primary}:{agents:string[];primary:string}){
 const all=orderedAgents(agents,primary),extra=all.length-1,id=useId(),pop=useRef<HTMLDivElement>(null),wrap=useRef<HTMLSpanElement>(null),button=useRef<HTMLButtonElement>(null),[open,setOpen]=useState(false),[pos,setPos]=useState({top:0,left:0,max:240});
 useEffect(()=>{if(!open)return;const outside=(e:PointerEvent)=>{if(!wrap.current?.contains(e.target as Node))setOpen(false);};const close=()=>setOpen(false);document.addEventListener('pointerdown',outside);window.addEventListener('resize',close);const scroll=(e:Event)=>{if(!wrap.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('scroll',scroll,true);return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',close);document.removeEventListener('scroll',scroll,true);};},[open]);
 useEffect(()=>{if(open)pop.current?.focus({preventScroll:true});},[open]);
 if(extra<1)return null;
 function toggle(e:React.MouseEvent){e.stopPropagation();if(!open&&button.current){const r=button.current.getBoundingClientRect();setPos({top:r.bottom+4,left:Math.max(8,Math.min(r.left,window.innerWidth-248)),max:Math.max(120,window.innerHeight-r.bottom-16)});}setOpen(!open);}
 return <span ref={wrap} className="dir-agent-wrap" onClick={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'&&open){e.stopPropagation();setOpen(false);button.current?.focus();}}} onBlur={e=>{if(open&&!wrap.current?.contains(e.relatedTarget as Node|null))setOpen(false);}}>
 <button ref={button} type="button" className="dir-agent-more" aria-expanded={open} aria-controls={id} aria-label={'Show all '+all.length+' agents'} onClick={toggle}>+{extra} agent{extra>1?'s':''}</button>
 {open&&<div ref={pop} id={id} className="dir-agent-popover" role="group" aria-label="All agents for this client" tabIndex={-1} style={{top:pos.top,left:pos.left,maxHeight:pos.max}}><ul>{all.map((a,i)=><li key={a}>{a}{i===0&&primary&&<span className="dir-agent-current">Current</span>}</li>)}</ul></div>}
 </span>;
}
