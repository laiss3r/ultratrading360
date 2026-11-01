'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { useApp } from '@/state/store';
import { changeIdentity, sessionWrite } from '@/lib/deriv/sessionWrites';
import { Notice } from '@/components/ui';

function Callback(){
  const router=useRouter();const params=useSearchParams();const fired=useRef(false);
  const [failure,setFailure]=useState('');const [demoAvailable,setDemoAvailable]=useState(false);
  const code=params.get('code'),state=params.get('state'),urlError=params.get('error');
  useEffect(()=>{
    if(fired.current)return;fired.current=true;
    void (async()=>{
      try{
        // A failed NEW authorization must never be treated as an old Demo login.
        if(urlError||!code||!state)throw new Error(urlError?'Deriv did not complete authorization. Please start sign-in again.':'This sign-in link is incomplete. Start a new sign-in.');
        changeIdentity();
        const response=await sessionWrite(()=>fetch('/api/deriv/oauth/callback',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({code,state})}));
        const result=await response.json();
        if(!response.ok||!result.ok)throw new Error(result.message??'Deriv sign-in could not be completed.');
        // Consume the authenticated response directly. No extra session/account
        // revalidation, market loading or socket setup blocks entry to the app.
        const completed=await useApp.getState().finishAuthentication(result);
        if(!completed.ok){setDemoAvailable(completed.demoAvailable===true);throw new Error(completed.message);}
        window.history.replaceState({},'', '/callback');
        router.replace('/');
      }catch(error){setFailure((error as Error).message);}
    })();
  },[code,state,urlError,router]);
  if(!failure)return <p className="micro" role="status">Completing secure Deriv authorization…</p>;
  return <div className="auth-panel panel"><div className="panel-content"><ShieldCheck size={26}/><h1>Sign-in could not finish</h1><Notice tone="error">{failure}</Notice>{demoAvailable&&<Link className="button button-secondary" href="/" onClick={async(e)=>{e.preventDefault();const id=useApp.getState().session?.loginid;if(!id)return;const selected=await useApp.getState().selectAccount(id);if(selected.ok){window.history.replaceState({},'', '/callback');router.replace('/');}else setFailure(selected.message);}}>Use the returned Demo account</Link>}<Link className="button button-primary" href="/connect">Back to secure sign-in</Link></div></div>;
}
export default function CallbackPage(){return <Suspense fallback={null}><Callback/></Suspense>;}
