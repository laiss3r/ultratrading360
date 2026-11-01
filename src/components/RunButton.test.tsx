// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {DEFAULT_SETTINGS} from '@/lib/persistence/db';
import {createStrategy} from '@/lib/engine/strategies';
const f=vi.hoisted(()=>({state:{} as Record<string,unknown>}));
vi.mock('@/state/store',()=>({useApp:Object.assign((select:(s:Record<string,unknown>)=>unknown)=>select(f.state),{getState:()=>f.state})}));
import {RunButton} from './Workspace';
beforeEach(()=>{f.state={settings:DEFAULT_SETTINGS,session:{loginid:'DOT_CONFIRM',currency:'USD',isVirtual:true},strategies:[createStrategy({id:'strategy'})],authorizeConfirmedRun:vi.fn(async()=>({ok:true,message:'Verified'})),runStrategy:vi.fn(async()=>({ok:true,message:'Waiting for signal'}))};});
afterEach(cleanup);
it('does not enable anything merely by opening a confirmation; explicit Confirm enables and runs',async()=>{
 render(<RunButton strategyId="strategy"/>);fireEvent.click(screen.getByRole('button',{name:'Run strategy'}));expect(document.body.textContent).toContain('Confirm & run will enable trading');expect(document.body.textContent).toContain('Real-money acknowledgement is not required');expect(f.state.authorizeConfirmedRun).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole('button',{name:'Confirm & run'}));await waitFor(()=>expect(f.state.runStrategy).toHaveBeenCalledWith('strategy'));expect(f.state.authorizeConfirmedRun).toHaveBeenCalledWith('DOT_CONFIRM',false);
});
it('offers account-specific Real acknowledgement instead of silently turning it on',async()=>{
 f.state.session={loginid:'ROT_CONFIRM',currency:'USD',isVirtual:false};render(<RunButton strategyId="strategy"/>);fireEvent.click(screen.getByRole('button',{name:'Run strategy'}));const toggle=screen.getByRole('switch',{name:'I acknowledge real-money risk for this selected account'});expect(toggle.getAttribute('aria-checked')).toBe('false');fireEvent.click(toggle);fireEvent.click(screen.getByRole('button',{name:'Confirm & run'}));await waitFor(()=>expect(f.state.authorizeConfirmedRun).toHaveBeenCalledWith('ROT_CONFIRM',true));
});
it('never starts a bot when the permission/channel verification fails',async()=>{
 f.state.authorizeConfirmedRun=vi.fn(async()=>({ok:false,message:'Broker account was not verified'}));render(<RunButton strategyId="strategy"/>);fireEvent.click(screen.getByRole('button',{name:'Run strategy'}));fireEvent.click(screen.getByRole('button',{name:'Confirm & run'}));await screen.findByText('Broker account was not verified');expect(f.state.runStrategy).not.toHaveBeenCalled();
});
it('dismisses confirmation immediately on entering starting, without awaiting broker history',async()=>{
 let finish!:(v:{ok:boolean;message:string})=>void;
 f.state.runStrategy=vi.fn(()=>{f.state.botState='starting';f.state.runPanelOpen=true;return new Promise(r=>{finish=r;});});
 render(<RunButton strategyId="strategy"/>);fireEvent.click(screen.getByRole('button',{name:'Run strategy'}));fireEvent.click(screen.getByRole('button',{name:'Confirm & run'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(f.state.runPanelOpen).toBe(true);finish({ok:true,message:'Started'});
});
