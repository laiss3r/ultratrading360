'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { useApp } from '@/state/store';
import { Notice } from '@/components/ui';

function Callback(){
  const router=useRouter();const params=useSearchParams();const fired=useRef(false);
  const [message,setMessage]=useState('Completing your secure Deriv connection…');const [failure,setFailure]=useState(false);
  const code=params.get('code'),state=params.get('state'),urlError=params.get('error');
  useEffect(()=>{
    if(fired.current)return;fired.current=true;
    void (async()=>{
      try{
        if(urlError||!code||!state){
          await useApp.getState().refreshSession(false,{revalidate:false});
          if(useApp.getState().session){router.replace('/');return;}
          throw new Error(urlError?'Deriv did not complete authorization. Please start sign-in again.':'This sign-in link is incomplete or has already been used. Start a new sign-in.');
        }
        const response=await fetch('/api/deriv/oauth/callback',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({code,state})});
        const result=await response.json();
        if(!response.ok||!result.ok){await useApp.getState().refreshSession(false,{revalidate:false});if(useApp.getState().session){router.replace('/');return;}throw new Error(result.message??'Deriv sign-in could not be completed.');}
        await useApp.getState().refreshSession(false);
        const current=useApp.getState();
        if(!current.session)throw new Error('The session could not be restored. Please reconnect.');
        const active=current.accounts.find((a)=>a.loginid===current.session?.loginid);
        const mode=active?.isVirtual===false?'deriv_real':'deriv_demo';
        // Do not block navigation on slow market history. Auth already succeeded.
        void current.applyMode(mode).catch(()=>{});
        // A Demo Options row does not establish that a profile has no classic Real account.
        // Continue read-only discovery in the background without delaying navigation.
        if(!current.accounts.some((a)=>a.isVirtual)||!current.accounts.some((a)=>!a.isVirtual)) void current.syncBalances();
        window.history.replaceState({},'', '/callback');
        setMessage(`Connected as ${current.session.loginid}. Opening your workspace…`);
        router.replace('/');
      }catch(error){setFailure(true);setMessage((error as Error).message);}
    })();
  },[code,state,urlError,router]);
  return <div className="auth-panel panel"><div className="panel-content"><div className="auth-brand">{failure?<ShieldCheck size={26}/>:<LoaderCircle size={26} className="spin"/>}</div><span className="eyebrow">DERIV AUTHORIZATION</span><h1 style={{marginTop:10}}>{failure?'Let’s reconnect':'Connecting your account'}</h1><Notice tone={failure?'error':'info'}>{message}</Notice>{failure&&<Link className="button button-primary" href="/connect">Back to secure sign-in</Link>}</div></div>;
}
export default function CallbackPage(){return <Suspense fallback={<p role="status">Reading secure callback…</p>}><Callback/></Suspense>;}
