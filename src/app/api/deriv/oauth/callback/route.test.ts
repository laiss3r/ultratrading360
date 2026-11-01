import {beforeEach,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {encryptSession,decryptSession,signValue,SESSION_COOKIE,STATE_COOKIE,VERIFIER_COOKIE,type StoredSession} from '@/lib/oauth/session';
const f=vi.hoisted(()=>({jar:new Map<string,string>(),exchange:vi.fn(),validate:vi.fn()}));
vi.mock('next/headers',()=>({cookies:async()=>({get:(name:string)=>f.jar.has(name)?{value:f.jar.get(name)}:undefined})}));
vi.mock('@/lib/deriv/auth',async(original)=>({...await original<typeof import('@/lib/deriv/auth')>(),exchangeAuthorizationCode:f.exchange,validateAccountsForToken:f.validate}));
import {POST} from './route';
import {DerivAuthError} from '@/lib/deriv/auth';
const state='synthetic-state-for-unit-test';
const request=()=>new Request('https://example.test/api/deriv/oauth/callback',{method:'POST',body:JSON.stringify({state,code:'synthetic-code'})});
const old:StoredSession={kind:'oauth',loginid:'DOT_OLD',currency:'USD',balance:42,isVirtual:true,scopes:['trade'],expiresAt:null,accessToken:'synthetic-test-only'};
beforeEach(()=>{process.env.DERIV_SESSION_SECRET='unit-test-secret-only';process.env.DERIV_OAUTH_CLIENT_ID='unit-public-id';f.jar.clear();f.exchange.mockReset();f.validate.mockReset();});
it('completes new OAuth straight onto the returned Real row, including zero balance',async()=>{
 f.jar.set(STATE_COOKIE,signValue(state));f.jar.set(VERIFIER_COOKIE,signValue('synthetic-verifier'));
 f.exchange.mockResolvedValue({accessToken:'synthetic-test-only',expiresIn:3600});
 f.validate.mockResolvedValue({accounts:[{account_loginid:'DOT1',is_virtual:1,currency:'USD',balance:100},{account_loginid:'ROT1',is_virtual:0,currency:'USD',balance:0}],scopes:['trade'],source:'options_rest'});
 const response=await POST(request());const data=await response.json();expect(response.status).toBe(200);expect(data.session).toMatchObject({loginid:'ROT1',isVirtual:false,balance:0});
 expect(decryptSession(response.cookies.get(SESSION_COOKIE)!.value)?.authAttemptId).toBe(createHash('sha256').update(state).digest('hex'));
 expect(data.session.accessToken).toBeUndefined();expect(f.exchange).toHaveBeenCalledOnce();
});
it('cannot treat an unrelated old Demo cookie as a successful new authorization',async()=>{
 f.jar.set(SESSION_COOKIE,encryptSession(old));const response=await POST(request());
 expect(response.status).toBe(400);expect((await response.json()).error).toBe('state_expired');expect(f.exchange).not.toHaveBeenCalled();
});
it('recovers only the exact completed OAuth attempt without another token exchange',async()=>{
 f.jar.set(SESSION_COOKIE,encryptSession({...old,loginid:'ROT1',isVirtual:false,authAttemptId:createHash('sha256').update(state).digest('hex')}));
 const response=await POST(request());expect((await response.json()).session.loginid).toBe('ROT1');expect(f.exchange).not.toHaveBeenCalled();expect(response.headers.get('set-cookie')).toBeNull();
});

it('preserves successful authentication and the migration diagnosis without inventing Demo or granting browser token handoff',async()=>{
 f.jar.set(STATE_COOKIE,signValue(state));f.jar.set(VERIFIER_COOKIE,signValue('synthetic-verifier'));f.exchange.mockResolvedValue({accessToken:'synthetic-test-only',expiresIn:3600});
 const diagnostics={checkedAt:1,httpStatus:200,returned:0,accepted:0,rejected:0,migration:'pending' as const,legacyMappings:1};
 f.validate.mockRejectedValue(new DerivAuthError('Migration pending','no_accounts',undefined,diagnostics));
 const response=await POST(request());const data=await response.json();expect(data.ok).toBe(true);expect(data.session.loginid).toBe('');expect(data.session.balanceKnown).toBe(false);expect(data.session.accountDiagnostics).toEqual(diagnostics);expect(data.accounts).toEqual([]);expect(response.cookies.get('ut_handoff')).toBeUndefined();expect(data.session.accessToken).toBeUndefined();expect(decryptSession(response.cookies.get(SESSION_COOKIE)!.value)?.accountDiagnostics).toEqual(diagnostics);
});
