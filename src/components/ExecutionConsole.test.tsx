// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import type {TradeRecord} from '@/lib/engine/bot';
const f=vi.hoisted(()=>({state:{} as Record<string,unknown>}));
vi.mock('@/state/store',()=>({useApp:Object.assign((select:(s:Record<string,unknown>)=>unknown)=>select(f.state),{getState:()=>f.state})}));
import {ExecutionConsole} from './ExecutionConsole';
const trade:TradeRecord={id:'t1',runId:'run1',accountLoginid:'DOT_TEST',contractId:1,currency:'USD',duration:1,durationUnit:'t',idempotencyKey:'s:1:1',strategyId:'s',strategyName:'Overlord',strategyVersion:1,symbol:'R_10',contractType:'DIGITEVEN',stake:1,payout:.5,profit:-.5,won:false,openedAt:100,closedAt:300,entryPrice:9608.69,exitPrice:9608.57,mode:'deriv_demo',source:'deriv_live',balanceBefore:10,balanceAfter:9.5,riskReasons:[],gateReasons:['Actual gate trace']};
beforeEach(()=>{f.state={botState:'halted',botDetail:'Stopped by risk target',bot:{hasPendingOrder:()=>false},execution:null,botSignal:null,session:{loginid:'DOT_TEST',currency:'USD'},settings:{mode:'deriv_demo'},sessionResets:{},executionJournal:[{id:'e1',runId:'run1',at:300,accountLoginid:'DOT_TEST',mode:'deriv_demo',phase:'settled',detail:'Actual broker settlement',symbol:'R_10',contractType:'DIGITEVEN'},{id:'e2',runId:'other',at:301,accountLoginid:'OTHER',mode:'deriv_demo',phase:'error',detail:'OTHER ACCOUNT',symbol:'R_10',contractType:'DIGITEVEN'}],trades:[trade,{...trade,id:'other',accountLoginid:'OTHER',stake:999,payout:999,profit:999}],stopBot:vi.fn(),resetSessionView:vi.fn(async()=>({ok:true,message:'Reset'}))};});
afterEach(cleanup);
describe('broker session views within the approved design',()=>{
 it('summarises actual gross returns and excludes another account',()=>{render(<ExecutionConsole/>);expect(screen.getByText('Total payout').parentElement?.textContent).toContain('0.50');expect(screen.getByText('Net profit / loss').parentElement?.textContent).toContain('-0.50');expect(document.body.textContent).not.toContain('999');});
 it('shows entry/exit spots, contract id and gate trace in transaction details',()=>{render(<ExecutionConsole/>);fireEvent.click(screen.getByRole('tab',{name:'Transactions'}));expect(document.body.textContent).toContain('9608.69');expect(document.body.textContent).toContain('9608.57');fireEvent.click(screen.getByText('View detail'));expect(document.body.textContent).toContain('Actual gate trace');expect(document.body.textContent).toContain('Broker contract');});
 it('scopes the journal to this account and supports error filtering',()=>{render(<ExecutionConsole/>);fireEvent.click(screen.getByRole('tab',{name:'Journal'}));expect(document.body.textContent).toContain('Actual broker settlement');expect(document.body.textContent).not.toContain('OTHER ACCOUNT');fireEvent.change(screen.getByLabelText('Journal filter'),{target:{value:'errors'}});expect(document.body.textContent).toContain('No matching journal events');});
 it('locks Reset while a contract is pending and lets Stop block future entries',()=>{f.state.botState='running';f.state.bot={hasPendingOrder:()=>true};render(<ExecutionConsole/>);expect((screen.getByRole('button',{name:'Reset session view'}) as HTMLButtonElement).disabled).toBe(true);fireEvent.click(screen.getByRole('button',{name:'Stop bot'}));expect(f.state.stopBot).toHaveBeenCalledTimes(1);});
});

it('does not show a prior account ledger or a Demo label when no account identity was returned',()=>{
 f.state.session={loginid:'',currency:'USD'};render(<ExecutionConsole/>);expect(document.body.textContent).toContain('No trading account selected');expect(document.body.textContent).not.toContain('DOT_TEST');expect(document.body.textContent).not.toContain('999');fireEvent.click(screen.getByRole('tab',{name:'Journal'}));expect(document.body.textContent).not.toContain('Actual broker settlement');
});

it('keeps actual session totals visible on Transactions and Journal, like the reference',()=>{
 render(<ExecutionConsole/>);for(const tab of ['Transactions','Journal']){fireEvent.click(screen.getByRole('tab',{name:tab}));expect(screen.getByLabelText('Session totals').textContent).toContain('-0.50');expect(screen.getByText('Contracts lost').parentElement?.textContent).toContain('1');expect(screen.getByText('Contracts won').parentElement?.textContent).toContain('0');}
});
it('renders supplied Run control when idle and only Stop when running',()=>{
 const {rerender}=render(<ExecutionConsole runControl={<button>Start selected bot</button>}/>);expect(screen.getByText('Start selected bot')).toBeTruthy();f.state.botState='running';rerender(<ExecutionConsole runControl={<button>Start selected bot</button>}/>);expect(screen.queryByText('Start selected bot')).toBeNull();expect(screen.getByRole('button',{name:'Stop bot'})).toBeTruthy();
});
