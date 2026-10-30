'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from './operations-common';
import type { WorkspaceUpdate, WorkspaceView } from '@/lib/operations/types';

export function useOperationsWorkspace(query: {view:string;search:string;filter:string;division:string;sort?:string;page:number;noticePage:number;selected:string}) {
  const [data,setValue]=useState<WorkspaceView|null>(null),[loading,setLoading]=useState(true),[readyKey,setReadyKey]=useState('');
  const current=useRef<WorkspaceView|null>(null),sequence=useRef(0),pending=useRef(false);
  const queryKey=JSON.stringify(query),latestQuery=useRef(queryKey);
  const responseQuery=useRef('');
  const confirmedDetail=useRef<{id:string;revision:number}|null>(null);
  const setData=useCallback((update:WorkspaceView|null|((previous:WorkspaceView|null)=>WorkspaceView|null))=>{
    current.current=typeof update==='function'?update(current.current):update;
    if(!current.current){sequence.current++;responseQuery.current='';confirmedDetail.current=null;}
    setValue(current.current);
  },[]);
  const refresh=useCallback(async()=>{
    const key=latestQuery.current, options=JSON.parse(key), previous=current.current;
    const requestSequence=++sequence.current;pending.current=true;
    const params=new URLSearchParams(Object.entries(options).map(([name,value])=>[name,String(value)]));
    if(previous){
      params.set('metadataVersion',previous.metadataVersion);
      if(responseQuery.current===key)params.set('cursor',previous.cursor);
      if(confirmedDetail.current&&previous.current?.id===options.selected&&confirmedDetail.current.id===options.selected&&confirmedDetail.current.revision===previous.current?.revision)params.set('knownRevision',String(confirmedDetail.current.revision));
    }
    try{
      const result=await api<WorkspaceUpdate|{unchanged:true;cursor:string}>('workspace?'+params);
      if(requestSequence!==sequence.current||key!==latestQuery.current)return;
      if(!('unchanged' in result)){
        const cached=current.current;
        if(result.current)confirmedDetail.current={id:result.current.id,revision:result.current.revision};
        const selected=result.current|| (cached?.current?.id===options.selected?cached?.current:undefined);
        const next={...cached,...result,current:selected,packageRenderers:{...(cached?.current?.id===selected?.id?cached?.packageRenderers:{}),...result.packageRenderers}} as WorkspaceView;
        if(selected&&cached?.current?.id===selected.id&&cached.current.revision>selected.revision)next.current=cached.current;
        current.current=next;setValue(next);
      }
      responseQuery.current=key;setReadyKey(key);
    }catch(error){
      if(requestSequence!==sequence.current||key!==latestQuery.current)return;
      if((error as {status?:number}).status===401){current.current=null;setValue(null);responseQuery.current='';confirmedDetail.current=null;}
      else toast.error((error as Error).message);
    }finally{
      if(requestSequence===sequence.current){pending.current=false;setLoading(false);}
    }
  },[]);
  useEffect(()=>{latestQuery.current=queryKey;void refresh();},[queryKey,refresh]);
  const invalidate=useCallback(()=>{sequence.current++;pending.current=false;},[]);
  useEffect(()=>{
    const poll=()=>{if(document.visibilityState==='visible'&&current.current&&!pending.current)void refresh();};
    const timer=setInterval(poll,10000);
    document.addEventListener('visibilitychange',poll);
    window.addEventListener('focus',poll);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',poll);window.removeEventListener('focus',poll);invalidate();};
  },[refresh,invalidate]);
  return {data,setData,loading,refresh,viewLoading:readyKey!==queryKey};
}
