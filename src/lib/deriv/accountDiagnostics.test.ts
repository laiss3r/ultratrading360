import {afterEach,expect,it,vi} from 'vitest';
import {validateAccountsForToken,DerivAuthError} from './auth';
import {accountDiscoveryMessage} from './accountDiagnostics';
import {parseOptionsAccounts} from './accountList';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it.each(['pending','failed','complete','not_applicable'])('reads official top-level migration=%s and historical mapping without inventing a live account',async(status)=>{
 const fetch=vi.fn(async(url:string,_init?:RequestInit)=>{
  if(url.endsWith('migration-status'))return new Response(JSON.stringify({status}));
  if(url.endsWith('legacy/accounts'))return ['pending','failed'].includes(status)?new Response('{"errors":[{"code":"MigrationPending"}]}',{status:409}):status==='not_applicable'?new Response('{}',{status:404}):new Response('{"loginids":{"CR_FIXTURE":[{"account_id":123,"currency":"USD"}]}}');
  return new Response('{"data":[]}');
 });
 vi.stubGlobal('fetch',fetch);const err=await validateAccountsForToken('synthetic-test-only','oauth').catch(e=>e) as DerivAuthError;
 expect(err.code).toBe('no_accounts');expect(err.diagnostics).toMatchObject({returned:0,accepted:0,migration:status,legacyMappings:status==='complete'?1:status==='not_applicable'?0:null});expect(fetch).toHaveBeenCalledTimes(3);
 expect(JSON.stringify(err.diagnostics)).not.toContain('synthetic-test-only');expect(JSON.stringify(err.diagnostics)).not.toContain('CR_FIXTURE');
 expect(fetch.mock.calls.every(([,init])=>(init as RequestInit | undefined)?.method!=='POST')).toBe(true);
});
it('reports rejected Real rows rather than incorrectly proving that none exist',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>new Response(JSON.stringify(url.includes('/legacy/')?{}:{data:[{account_id:'DOT1',currency:'USD',balance:1,account_type:'demo'},{account_id:'ROT1',currency:'USD',balance:null,account_type:'real'}]}))));
 const result=await validateAccountsForToken('synthetic-test-only','oauth');expect(result.accounts).toHaveLength(1);expect(result.diagnostics).toMatchObject({returned:2,accepted:1,rejected:1});expect(accountDiscoveryMessage(result.diagnostics)).toContain('could not be safely read');
});
it('accepts canonical decimal money without dropping the Real account; rejects coercible non-money',()=>{
 for(const balance of ['0','12.34',0,12.34])expect(parseOptionsAccounts({data:[{account_id:'ROT1',account_type:'real',currency:'USD',balance}]})).toHaveLength(1);
 for(const balance of [null,'',true,' ','Infinity',{},'1e3'])expect(parseOptionsAccounts({data:[{account_id:'ROT1',account_type:'real',currency:'USD',balance}]})).toHaveLength(0);
});
it('returns an explicit bounded network error when account response stalls',async()=>{
 vi.useFakeTimers();vi.stubGlobal('fetch',vi.fn(()=>new Promise(()=>{})));
 const result=validateAccountsForToken('synthetic-test-only','oauth').catch(e=>e);await vi.advanceTimersByTimeAsync(5001);expect((await result).code).toBe('network');
});
