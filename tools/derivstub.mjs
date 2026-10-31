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
const CLASSIC_LIST = [
  { loginid: 'VRTC1234567', currency: 'USD', balance: 4172.24, is_virtual: 1 },
  { loginid: 'CR1234567', currency: 'USD', balance: 0, is_virtual: 0 },
];

let getCalls = 0;
http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
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
      return res.end(JSON.stringify({ data: REST_ROWS }));
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
            account_list: CLASSIC_LIST,
          },
        }),
      );
    }
    ws.send(JSON.stringify({ msg_type: 'error', error: { code: 'UnknownMethod', message: 'stub' } }));
  });
});
console.log('stub legacy WS on 4518');

const market = new WebSocketServer({ port: 4519, host: '127.0.0.1' });
market.on('connection', (ws, req) => {
  let tickTimer = null;
  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.ping) return ws.send(JSON.stringify({ msg_type: 'ping', ping: m.ping }));
    if (m.balance) return ws.send(JSON.stringify({req_id:m.req_id, subscription:{id:'balance'}, balance:{balance:req.url.includes('DOT') ? 10000 : 0,currency:'USD'}}));
    if (m.ticks_history) return ws.send(JSON.stringify({ req_id: m.req_id, msg_type: 'history', pip_size: 2, history: { prices: [1234.50,1234.55,1234.60], times: [1700000000,1700000001,1700000002] } }));
    if (m.active_symbols) return ws.send(JSON.stringify({req_id:m.req_id,msg_type:'active_symbols',active_symbols:[]}));
    if (m.forget || m.forget_all) return ws.send(JSON.stringify({req_id:m.req_id,forget:1}));
    if (m.ticks && !tickTimer) {
      let q = 1234.5;
      tickTimer = setInterval(() => {
        q += 0.5;
        ws.send(
          JSON.stringify({
            req_id: m.req_id,
            msg_type: 'tick',
            tick: { symbol: m.ticks, quote: q, epoch: Math.floor(Date.now() / 1000), id: 'stub' },
            subscription: { id: 'stub-sub' },
          }),
        );
      }, 250);
    }
  });
  ws.on('close', () => tickTimer && clearInterval(tickTimer));
});
console.log('stub market WS on 4519');
