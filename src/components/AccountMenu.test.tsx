// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
const f=vi.hoisted(()=>({state:{} as Record<string,unknown>}));
vi.mock('@/state/store',()=>({useApp:Object.assign((select:(state:Record<string,unknown>)=>unknown)=>select(f.state),{getState:()=>f.state})}));
import { AccountMenu } from './AccountMenu';
const demo={loginid:'DOT1',balance:10000,currency:'USD',isVirtual:true};
const real={loginid:'ROT1',balance:0,currency:'USD',isVirtual:false};
beforeEach(()=>{f.state={session:demo,accounts:[demo,real],busy:null,balanceStatus:'stale',balanceMessage:'',refreshSession:vi.fn(async()=>{}),selectAccount:vi.fn(async()=>({ok:true,message:'Selected'})),syncBalances:vi.fn(async()=>({ok:true,message:'Refreshed'})),startBalanceStream:vi.fn(),stopBalanceStream:vi.fn(),disconnect:vi.fn(async()=>{}),startOAuth:vi.fn()};});
afterEach(cleanup);
function open(){fireEvent.click(screen.getByRole('button',{expanded:false}));}
describe('rebuilt account menu',()=>{
  it('shows only actual account rows and no cosmetic mode controls',()=>{render(<AccountMenu/>);open();expect(screen.getAllByRole('menuitemradio')).toHaveLength(2);expect(screen.queryByText('Deriv Real')).toBeNull();});
  it('selects the genuine Real row with its zero balance, without trading acknowledgement',async()=>{render(<AccountMenu/>);open();fireEvent.click(screen.getByRole('menuitemradio',{name:/ROT1/}));await waitFor(()=>expect(f.state.selectAccount).toHaveBeenCalledWith('ROT1'));});
  it('never fabricates a Real option for a Demo-only listing',()=>{f.state.accounts=[demo];render(<AccountMenu/>);open();expect(screen.getAllByRole('menuitemradio')).toHaveLength(1);expect(screen.getByText(/No verified Real account is listed/)).toBeTruthy();});
  it('keeps backend errors visible when selection fails',async()=>{f.state.selectAccount=vi.fn(async()=>({ok:false,message:'Deriv rejected this account'}));render(<AccountMenu/>);open();fireEvent.click(screen.getByRole('menuitemradio',{name:/ROT1/}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Deriv rejected'));});
  it('does not open a legacy token handoff for Options-only rows',()=>{render(<AccountMenu/>);expect(f.state.startBalanceStream).not.toHaveBeenCalled();});
  it('subscribes classic rows once and cleans up on unmount',()=>{f.state.accounts=[{...demo,loginid:'VRTC1'}];const view=render(<AccountMenu/>);expect(f.state.startBalanceStream).toHaveBeenCalledTimes(1);view.unmount();expect(f.state.stopBalanceStream).toHaveBeenCalled();});
  it('shows server refresh failures inside the menu',async()=>{f.state.syncBalances=vi.fn(async()=>({ok:false,message:'Network unavailable'}));render(<AccountMenu/>);open();fireEvent.click(screen.getByRole('button',{name:/Refresh accounts/}));await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Network unavailable'));});
  it('supports Escape to close without changing accounts',()=>{render(<AccountMenu/>);open();fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('menu')).toBeNull();expect(f.state.selectAccount).not.toHaveBeenCalled();});
});

describe('automatic discovery for existing Demo-only sessions',()=>{
  it('checks additional sources once without asking the user to log in again',()=>{
    f.state.accounts=[demo];const view=render(<AccountMenu/>);expect(f.state.syncBalances).toHaveBeenCalledTimes(1);
    f.state.session={...demo,balance:9999};view.rerender(<AccountMenu/>);expect(f.state.syncBalances).toHaveBeenCalledTimes(1);expect(f.state.startOAuth).not.toHaveBeenCalled();
  });
  it('shows an honest in-progress state instead of claiming Real does not exist',()=>{
    f.state.accounts=[demo];f.state.busy='sync-balances';render(<AccountMenu/>);open();expect(screen.getByText(/Checking Deriv for additional accounts/)).toBeTruthy();
  });
});
