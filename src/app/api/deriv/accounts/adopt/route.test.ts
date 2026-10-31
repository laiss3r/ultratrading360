import {beforeEach, describe, expect, it, vi} from 'vitest';
import {decryptSession, encryptSession, SESSION_COOKIE, type StoredSession} from '@/lib/oauth/session';
const edge=vi.hoisted(()=>({cookie:''}));
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:edge.cookie})})}));
import {POST} from './route';
const demo={account_loginid:'DOT1',currency:'USD',balance:10000,is_virtual:1 as const};
const session:StoredSession={kind:'oauth',accessToken:'test-only-credential',loginid:'DOT1',currency:'USD',balance:10000,isVirtual:true,scopes:['trade'],expiresAt:null,accountRows:[demo],initialRealAccountPending:true};
const request=(rows=[{loginid:'CR1',currency:'USD',balance:0,isVirtual:false}])=>new Request('https://example.test/api/deriv/accounts/adopt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accounts:rows})});
beforeEach(()=>{process.env.DERIV_SESSION_SECRET='unit-test-secret-only';edge.cookie=encryptSession(session);});
describe('initial discovery Real default',()=>{
 it('selects newly discovered Real instead of sticking to the initial Demo row',async()=>{
  const response=await POST(request());const data=await response.json();expect(data.session).toMatchObject({loginid:'CR1',balance:0,isVirtual:false});expect(data.accounts).toHaveLength(2);
  const saved=decryptSession(response.cookies.get(SESSION_COOKIE)!.value)!;expect(saved.initialRealAccountPending).toBe(false);expect(data.session.accessToken).toBeUndefined();
 });
 it('never overrides an explicit subsequent Demo selection',async()=>{
  edge.cookie=encryptSession({...session,initialRealAccountPending:false});
  const data=await (await POST(request())).json();expect(data.session.loginid).toBe('DOT1');expect(data.accounts).toHaveLength(2);
 });
 it('preserves existing-session choice when the initial-login flag is absent',async()=>{
  edge.cookie=encryptSession({...session,initialRealAccountPending:undefined});
  expect((await (await POST(request())).json()).session.loginid).toBe('DOT1');
 });
 it('does not invent Real when discovery only returns Demo',async()=>{
  const response=await POST(request([{loginid:'VRTC1',currency:'USD',balance:50,isVirtual:true}]));
  expect((await response.json()).session.loginid).toBe('DOT1');expect(decryptSession(response.cookies.get(SESSION_COOKIE)!.value)!.initialRealAccountPending).toBe(true);
 });
});
