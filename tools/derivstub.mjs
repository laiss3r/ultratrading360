/**
 * Stub Deriv edge for integration tests (tools/derivstub.mjs).
 *
 * Emulates the two Deriv surfaces the app talks to, so the FULL authenticated
 * workflow can be exercised end-to-end in a browser without real credentials:
 *   - HTTP  http://127.0.0.1:4517  -> new-platform REST (GET/POST options/accounts)
 *   - WS    ws://127.0.0.1:4518    -> legacy v3 socket (authorize with account_list)
 *   - WS    ws://127.0.0.1:4519    -> public market socket (ping + ticks)
 * STUB_FLAKY=1 makes every 3rd REST GET answer 500, to prove transient Deriv
 * faults never log a signed-in user out.
 */
import http from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../package.json', import.meta.url));
const { WebSocketServer } = require('ws');

const FLAKY = process.env.STUB_FLAKY === '1';
const REST_ROWS = [
  { account_id: 'DOT90004580', currency: 'USD', balance: 10000, group: 'row', status: 'active', account_type: 'demo' },
  { account_id: 'ROT90004581', currency: 'USD', balance: 0, group: 'row', status: 'active', account_type: 'real' },
];
if(process.env.STUB_TRADING==='1'&&process.env.STUB_REAL_FUNDS==='1')REST_ROWS[1].balance=1000;
const CLASSIC_LIST = [
  { loginid: 'VRTC1234567', currency: 'USD', balance: 4172.24, is_virtual: 1 },
  { loginid: 'CR1234567', currency: 'USD', balance: 0, is_virtual: 0 },
];

const tradeLog = [];
const proposals = new Map();
const contracts = new Map();
const terminalContracts = new Map();
let proposalIndex = 0, contractIndex = 0;
let getCalls = 0;
http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (process.env.STUB_TRADING === '1' && url.pathname === '/__fixture/reset' && req.method === 'POST') {tradeLog.length=0;proposals.clear();contracts.clear();terminalContracts.clear();proposalIndex=0;contractIndex=0;res.writeHead(200);return res.end('{}');}
    if (process.env.STUB_TRADING === '1' && url.pathname === '/__fixture/trades') { res.writeHead(200, {'content-type':'application/json'}); return res.end(JSON.stringify(tradeLog)); }
    if (url.pathname === '/trading/v1/options/legacy/migration-status') {res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({status:process.env.STUB_MIGRATION || 'complete'}));}
    if (url.pathname === '/trading/v1/options/legacy/accounts') {if(['pending','failed'].includes(process.env.STUB_MIGRATION)){res.writeHead(409,{'content-type':'application/json'});return res.end(JSON.stringify({errors:[{status:409,code:'MigrationPending',message:'User migration is pending or has failed'}]}));}res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({loginids:{CR_FIXTURE:[{account_id:123,currency:'USD'}]}}));}
    if (url.pathname.endsWith('/otp') && req.method === 'POST') {
      const id = url.pathname.split('/').at(-2);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: { url: `ws://127.0.0.1:4519/${id}` } }));
    }
    if (url.pathname === '/trading/v1/options/accounts' && req.method === 'GET') {
      getCalls += 1;
      if (FLAKY && getCalls % 3 === 0) {
        res.writeHead(500, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ message: 'stub transient fault' }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ data: process.env.STUB_EMPTY === '1' ? [] : process.env.STUB_DEMO_ONLY === '1' ? REST_ROWS.filter((a) => a.account_type === 'demo') : REST_ROWS }));
    }
    if (url.pathname === '/trading/v1/options/accounts' && req.method === 'POST') {
      res.writeHead(201, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({ data: [{ account_id: 'DOT90004580', currency: 'USD', balance: 10000, account_type: 'demo' }] }),
      );
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'stub: unknown path' }));
  })
  .listen(4517, '127.0.0.1', () => console.log('stub REST on 4517'));

const legacy = new WebSocketServer({ port: 4518, host: '127.0.0.1' });
legacy.on('connection', (ws) => {
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.ping) return ws.send(JSON.stringify({ msg_type: 'ping', ping: m.ping }));
    if (m.authorize) {
      return ws.send(
        JSON.stringify({
          msg_type: 'authorize',
          authorize: {
            loginid: CLASSIC_LIST[0].loginid,
            balance: CLASSIC_LIST[0].balance,
            currency: 'USD',
            is_virtual: 1,
            scope: 'read trade account_manage',
            account_list: process.env.STUB_CLASSIC_NO_BALANCES === '1' ? CLASSIC_LIST.map(({balance: _balance, ...row}) => row) : CLASSIC_LIST,
          },
        }),
      );
    }
    if (m.balance) return ws.send(JSON.stringify({msg_type:'balance',req_id:m.req_id,subscription:{id:'classic-balances'},balance:{accounts:Object.fromEntries(CLASSIC_LIST.map((a)=>[a.loginid,{balance:a.balance,currency:a.currency}]))}}));
    ws.send(JSON.stringify({ msg_type: 'error', error: { code: 'UnknownMethod', message: 'stub' } }));
  });
});
console.log('stub legacy WS on 4518');

const market = new WebSocketServer({ port: 4519, host: '127.0.0.1' });
market.on('connection', (ws, req) => {
  const tickTimers = new Map();
  let balanceReq = null;
  let fixtureBalance = req.url.includes('DOT') ? 10000 : process.env.STUB_REAL_FUNDS==='1'?1000:0;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.ping) return ws.send(JSON.stringify({ msg_type: 'ping', ping: m.ping }));
    if (m.balance) { balanceReq=m; return ws.send(JSON.stringify({req_id:m.req_id, subscription:{id:'balance'}, balance:{balance:process.env.STUB_STRING_BALANCE==='1'?fixtureBalance.toFixed(2):fixtureBalance,currency:'USD'}})); }
    if (process.env.STUB_TRADING === '1' && m.proposal) {
      const id=`fixture-proposal-${++proposalIndex}`;proposals.set(id,{...m});
      return ws.send(JSON.stringify({req_id:m.req_id,msg_type:'proposal',proposal:{id,ask_price:String(m.amount),payout:String(Math.round(m.amount*1.95*100)/100),spot:100,spot_value:'100.00',date_start:Math.floor(Date.now()/1000),date_expiry:Math.floor(Date.now()/1000)+3,longcode:'Synthetic fixture only'}}));
    }
    if (process.env.STUB_TRADING === '1' && m.buy) {
      if(req.url.includes('public'))return ws.send(JSON.stringify({req_id:m.req_id,error:{code:'AuthorizationRequired',message:'Fixture requires account socket'}}));
      const proposal=proposals.get(m.buy);const id=++contractIndex;contracts.set(id,proposal);tradeLog.push({...proposal,contract_id:id,price:m.price,account_socket:req.url});
      return ws.send(JSON.stringify({req_id:m.req_id,msg_type:'buy',buy:{contract_id:id,buy_price:proposal.amount,payout:Math.round(proposal.amount*1.95*100)/100,longcode:'Synthetic fixture only',currency:proposal.currency,start_time:Math.floor(Date.now()/1000)}}));
    }
    if (process.env.STUB_TRADING === '1' && m.proposal_open_contract) {
      const proposal=contracts.get(m.contract_id);
      if(!proposal)return ws.send(JSON.stringify({req_id:m.req_id,error:{code:'ContractNotFound',message:'No such fixture contract'}}));
      const won=m.contract_id>2,profit=won?Math.round(proposal.amount*.95*100)/100:-proposal.amount;
      const open={contract_id:m.contract_id,is_sold:0,status:'open',buy_price:String(proposal.amount),profit:'0.00',bid_price:'0.00',payout:String(Math.round(proposal.amount*1.95*100)/100),entry_spot:'100.01',currency:proposal.currency};
      const current=terminalContracts.get(m.contract_id)??open;
      const frame={req_id:m.req_id,msg_type:'proposal_open_contract',...(m.subscribe?{subscription:{id:`fixture-contract-${m.contract_id}`}}:{}),proposal_open_contract:current};ws.send(JSON.stringify(frame));
      if(!m.subscribe||current.is_sold)return;
      setTimeout(()=>{const terminal={...open,is_sold:1,status:won?'won':'lost',profit:String(profit),bid_price:String(proposal.amount+profit),exit_spot:'100.08',date_settlement:Math.floor(Date.now()/1000)};terminalContracts.set(m.contract_id,terminal);fixtureBalance=Math.round((fixtureBalance+profit)*100)/100;if(ws.readyState!==1)return;ws.send(JSON.stringify({...frame,proposal_open_contract:terminal}));if(balanceReq)ws.send(JSON.stringify({req_id:balanceReq.req_id,subscription:{id:'balance'},balance:{balance:process.env.STUB_STRING_BALANCE==='1'?fixtureBalance.toFixed(2):fixtureBalance,currency:'USD'}}));},Number(process.env.STUB_SETTLE_MS||350));return;
    }
    if (process.env.STUB_TRADING === '1' && m.contracts_for) return ws.send(JSON.stringify({req_id:m.req_id,msg_type:'contracts_for',contracts_for:{available:['DIGITEVEN','DIGITODD','DIGITOVER','DIGITUNDER'].map(contract_type=>({contract_type,contract_category:'digits',min_contract_duration:'1t',max_contract_duration:'10t',...(contract_type==='DIGITOVER'?{last_digit_range:[0,1,2,3,4,5,6,7,8]}:contract_type==='DIGITUNDER'?{last_digit_range:[1,2,3,4,5,6,7,8,9]}:{})}))}}));
    if (process.env.STUB_TRADING === '1' && m.ticks_history) {
      let seed=38231;const randomDigit=()=>{seed=(seed*1664525+1013904223)>>>0;return (seed>>>16)%10;};
      const prices=Array.from({length:Math.min(m.count||300,5000)},(_,i)=>100+(process.env.STUB_PATTERNS==='1'?(m.ticks_history==='R_10'?(i%2?8:1):randomDigit()):(m.ticks_history==='R_10'?(i%10===0?2:1):i%10))/100);
      const end=m.end&&m.end!=='latest'?Number(m.end):Math.floor(Date.now()/1000);
      return ws.send(JSON.stringify({req_id:m.req_id,msg_type:'history',pip_size:2,history:{prices,times:prices.map((_,i)=>end-prices.length+i+1)}}));
    }
    if (process.env.STUB_TRADING === '1' && m.active_symbols) return ws.send(JSON.stringify({req_id:m.req_id,msg_type:'active_symbols',active_symbols:[10,25].map((n)=>({underlying_symbol:`R_${n}`,underlying_symbol_name:`Fixture Volatility ${n}`,market:'synthetic_index',submarket:'random_index',exchange_is_open:1,is_trading_suspended:0,pip_size:2,trade_count:1}))}));
    if (m.ticks_history) {const reply=()=>{if(ws.readyState===1)ws.send(JSON.stringify({ req_id: m.req_id, msg_type: 'history', pip_size: 2, history: { prices: [1234.50,1234.55,1234.60], times: [1700000000,1700000001,1700000002] } }));};if(process.env.STUB_HISTORY_DELAY_MS)setTimeout(reply,Number(process.env.STUB_HISTORY_DELAY_MS));else reply();return;}
    if (m.active_symbols) return ws.send(JSON.stringify({req_id:m.req_id,msg_type:'active_symbols',active_symbols:[]}));
    if (m.forget || m.forget_all) {if(m.forget_all){for(const timer of tickTimers.values())clearInterval(timer);tickTimers.clear();}else {clearInterval(tickTimers.get(m.forget));tickTimers.delete(m.forget);}return ws.send(JSON.stringify({req_id:m.req_id,forget:1}));}
    if (m.ticks) {
      const subId = `fixture-ticks-${m.req_id}`;
      let q = 1234.5,index=0,seed=38231;
      const tickTimer = setInterval(() => {
        if(process.env.STUB_PATTERNS==='1'){seed=(seed*1664525+1013904223)>>>0;q=100+(m.ticks==='R_10'?(index++%2?8:1):(seed>>>16)%10)/100;}else q+=.5;
        ws.send(
          JSON.stringify({
            req_id: m.req_id,
            msg_type: 'tick',
            tick: { symbol: m.ticks, quote: q, pip_size: 2, epoch: Math.floor(Date.now() / 1000), id: subId },
            subscription: { id: subId },
          }),
        );
      }, 250);
      tickTimers.set(subId, tickTimer);
    }
  });
  ws.on('close', () => {for (const timer of tickTimers.values()) clearInterval(timer);});
});
console.log('stub market WS on 4519');
