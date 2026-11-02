// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {DEFAULT_SETTINGS} from '@/lib/persistence/db';
import {createStrategy} from '@/lib/engine/strategies';
const f=vi.hoisted(()=>({state:{} as Record<string,unknown>}));
vi.mock('@/state/store',()=>({useApp:Object.assign((select:(s:Record<string,unknown>)=>unknown)=>select(f.state),{getState:()=>f.state})}));
import {RunButton} from './Workspace';
beforeEach(()=>{f.state={hydrated:true,settings:DEFAULT_SETTINGS,session:{loginid:'DOT_RUN',currency:'USD',isVirtual:true},strategies:[createStrategy({id:'strategy'})],authorizeConfirmedRun:vi.fn(async()=>({ok:true,message:'Verified'})),runStrategy:vi.fn(async()=>({ok:true,message:'Waiting for signal'}))};});
afterEach(cleanup);
it('starts with one explicit Run click and never opens a confirmation dialog',async()=>{
 render(<RunButton strategyId="strategy"/>);expect(f.state.authorizeConfirmedRun).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Run strategy'}));await waitFor(()=>expect(f.state.runStrategy).toHaveBeenCalledWith('strategy'));expect(f.state.authorizeConfirmedRun).toHaveBeenCalledWith('DOT_RUN',false);expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps first Real permission inline and bound to the selected account',async()=>{
 f.state.session={loginid:'ROT_RUN',currency:'USD',isVirtual:false};render(<RunButton strategyId="strategy"/>);fireEvent.click(screen.getByRole('button',{name:'Run strategy'}));await screen.findByText('Acknowledge real-money risk for this account before Run.');expect(f.state.authorizeConfirmedRun).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('switch'));fireEvent.click(screen.getByRole('button',{name:'Run strategy'}));await waitFor(()=>expect(f.state.authorizeConfirmedRun).toHaveBeenCalledWith('ROT_RUN',true));expect(screen.queryByRole('dialog')).toBeNull();
});
it('does not add another consent step for an already acknowledged Real account',async()=>{f.state.session={loginid:'ROT_RUN',isVirtual:false};f.state.settings={...DEFAULT_SETTINGS,realTradingAcknowledged:true,acknowledgedAccountLoginid:'ROT_RUN'};render(<RunButton strategyId="strategy"/>);expect(screen.queryByRole('switch')).toBeNull();fireEvent.click(screen.getByRole('button'));await waitFor(()=>expect(f.state.runStrategy).toHaveBeenCalled());});
it('never starts a bot when broker channel verification fails',async()=>{f.state.authorizeConfirmedRun=vi.fn(async()=>({ok:false,message:'Broker account was not verified'}));render(<RunButton strategyId="strategy"/>);fireEvent.click(screen.getByRole('button'));await screen.findByText('Broker account was not verified');expect(f.state.runStrategy).not.toHaveBeenCalled();});
it('blocks rapid duplicate clicks while preparation is awaiting persistence',async()=>{let resolve!:(v:string)=>void;const prepare=vi.fn(()=>new Promise<string>(r=>{resolve=r;}));render(<RunButton prepare={prepare}/>);fireEvent.click(screen.getByRole('button'));fireEvent.click(screen.getByRole('button'));expect(prepare).toHaveBeenCalledTimes(1);resolve('strategy');await waitFor(()=>expect(f.state.runStrategy).toHaveBeenCalledTimes(1));});
it('does not run before the durable store is restored',()=>{f.state.hydrated=false;render(<RunButton strategyId="strategy"/>);fireEvent.click(screen.getByRole('button'));expect(f.state.authorizeConfirmedRun).not.toHaveBeenCalled();});
it('does not transfer inline consent when the selected Real account changes',()=>{f.state.session={loginid:'ROT_RUN',isVirtual:false};const {rerender}=render(<RunButton strategyId="strategy"/>);fireEvent.click(screen.getByRole('switch'));f.state.session={loginid:'ROT_OTHER',isVirtual:false};rerender(<RunButton strategyId="strategy"/>);expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false');});
