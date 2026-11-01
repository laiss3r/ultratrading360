import {beforeEach,expect,it,vi} from 'vitest';
import {encryptSession,type StoredSession} from '@/lib/oauth/session';
const f=vi.hoisted(()=>({cookie:'',validate:vi.fn()}));
vi.mock('next/headers',()=>({cookies:async()=>({get:()=>({value:f.cookie})})}));
vi.mock('@/lib/deriv/auth',async(original)=>({...await original<typeof import('@/lib/deriv/auth')>(),validateAccountsForToken:f.validate}));
import {GET} from './route';
const demo={account_loginid:'DOT1',currency:'USD',balance:100,is_virtual:1 as const};
const session:StoredSession={kind:'oauth',loginid:'DOT1',currency:'USD',balance:100,isVirtual:true,scopes:['trade'],expiresAt:null,accessToken:'synthetic-only',accountRows:[demo]};
beforeEach(()=>{process.env.DERIV_SESSION_SECRET='unit-test-secret-only';f.cookie=encryptSession(session);f.validate.mockReset();});
it('returns fresh account metadata without writing an old identity cookie',async()=>{
 f.validate.mockResolvedValue({accounts:[demo,{account_loginid:'ROT1',currency:'USD',balance:0,is_virtual:0}]});
 const response=await GET(new Request('https://example.test/api/deriv/accounts'));
 expect((await response.json()).accounts).toHaveLength(2);expect(response.headers.get('set-cookie')).toBeNull();
});
it('serves the dropdown snapshot without network calls or cookie writes',async()=>{
 const response=await GET(new Request('https://example.test/api/deriv/accounts?cached=1'));
 expect((await response.json()).accounts[0].loginid).toBe('DOT1');expect(response.headers.get('set-cookie')).toBeNull();expect(f.validate).not.toHaveBeenCalled();
});
