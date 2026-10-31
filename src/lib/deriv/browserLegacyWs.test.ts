import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverClassicAccounts, runClassicDiscovery } from './browserLegacyWs';
import { DERIV_APP_ID } from './config';
const sockets: FakeSocket[]=[];
class FakeSocket {
  onopen: (()=>void)|null=null;
  onmessage: ((event:{data:string})=>void)|null=null;
  onerror: (()=>void)|null=null;
  onclose: (()=>void)|null=null;
  close=vi.fn();
  constructor(public url:string){sockets.push(this);queueMicrotask(()=>this.onopen?.());}
  send(){if(this.url.includes('stalled'))return;queueMicrotask(()=>this.onmessage?.({data:JSON.stringify({msg_type:'authorize',authorize:{account_list:[{loginid:'CR12345',currency:'USD',balance:0,is_virtual:0}]}})}));}
}
beforeEach(()=>{sockets.length=0;vi.stubGlobal('WebSocket',FakeSocket);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('bounded read-only classic discovery',()=>{
  it('uses the configured application identifier, never a blank app_id',async()=>{
    const result=await discoverClassicAccounts('synthetic-only',['wss://working.test']);
    expect(result?.accounts[0].account_loginid).toBe('CR12345');expect(sockets[0].url).toContain(`app_id=${encodeURIComponent(DERIV_APP_ID)}`);expect(sockets[0].close).toHaveBeenCalled();
  });
  it('leaves time for a second host when the first stalls',async()=>{
    vi.useFakeTimers();const result=discoverClassicAccounts('synthetic-only',['wss://stalled.test','wss://working.test'],9000);
    await vi.advanceTimersByTimeAsync(4501);expect((await result)?.accounts[0].balance).toBe(0);expect(sockets).toHaveLength(2);expect(sockets[0].close).toHaveBeenCalled();
  });
  it('clears the handoff payload and adopts only returned accounts',async()=>{
    const handoff:{ok:boolean;token?:string;hosts:string[]}={ok:true,token:'synthetic-only',hosts:['wss://working.test']};
    const fetchMock=vi.fn(async(url:string)=>({ok:true,json:async()=>url==='/api/deriv/handoff'?handoff:{accounts:[{loginid:'CR12345',currency:'USD',balance:0,isVirtual:false}]}}));
    vi.stubGlobal('fetch',fetchMock);
    expect((await runClassicDiscovery()).ok).toBe(true);expect(handoff.token).toBeUndefined();
    const adopted=JSON.parse((fetchMock.mock.calls[1] as unknown as [string,RequestInit])[1].body as string);
    expect(adopted.accounts).toEqual([{loginid:'CR12345',currency:'USD',balance:0,isVirtual:false}]);
  });
});


describe('classic balances are never invented',()=>{
  function missingBalances(refuse=false){
    vi.spyOn(FakeSocket.prototype,'send').mockImplementation(function(this:FakeSocket,data?:string){
      const request=JSON.parse(data!);
      const frame=request.authorize?{msg_type:'authorize',authorize:{loginid:'VRTC12345',currency:'USD',balance:4171.41,is_virtual:1,account_list:[{loginid:'VRTC12345',currency:'USD',is_virtual:1},{loginid:'CR12345',currency:'USD',is_virtual:0}]}}:refuse?{error:{message:'Balance denied'}}:{msg_type:'balance',balance:{accounts:{VRTC12345:{balance:4171.41,currency:'USD'},CR12345:{balance:0,currency:'USD'}}}};
      queueMicrotask(()=>this.onmessage?.({data:JSON.stringify(frame)}));
    });
  }
  it('reads actual all-account balances when authorize lists IDs without amounts',async()=>{
    missingBalances();const result=await discoverClassicAccounts('synthetic-only',['wss://working.test']);
    expect(result?.accounts.map((a)=>[a.account_loginid,a.balance])).toEqual([['VRTC12345',4171.41],['CR12345',0]]);
  });
  it('does not turn a missing Real amount into a zero balance when balance is denied',async()=>{
    missingBalances(true);const result=await discoverClassicAccounts('synthetic-only',['wss://working.test']);
    expect(result?.accounts.map((a)=>a.account_loginid)).toEqual(['VRTC12345']);
  });
});
