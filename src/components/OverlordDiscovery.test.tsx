// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
const f=vi.hoisted(()=>({provider:{} as Record<string,unknown>}));
vi.mock('@/lib/engine/provider',()=>({DerivProvider:class {constructor(){return f.provider;}}}));
import {OverlordDiscovery} from './OverlordDiscovery';
const specs=['DIGITEVEN','DIGITODD','DIGITOVER','DIGITUNDER'].map(contract_type=>({contract_type,contract_category:'digits',min_contract_duration:'1t',max_contract_duration:'10t'}));
beforeEach(()=>{f.provider={connect:vi.fn(async()=>{}),disconnect:vi.fn(),activeSymbols:vi.fn(async()=>[{underlying_symbol:'R_10S',underlying_symbol_name:'Volatility 10 S Index',exchange_is_open:1,is_trading_suspended:0}]),contractsFor:vi.fn(async()=>specs),history:vi.fn(async(s:string)=>Array.from({length:1000},(_,i)=>({symbol:s,price:100+i%10/100,pipSize:2,source:'deriv_history',epoch:Math.floor(Date.now()/1000)-1000+i+1})))};});
afterEach(cleanup);
it('Find market produces real historical percentages and applies a setup without buying or waiting for live ticks',async()=>{
 const onSelect=vi.fn(),onMarkets=vi.fn();render(<OverlordDiscovery duration={1} disabled={false} onSelect={onSelect} onMarkets={onMarkets}/>);fireEvent.click(screen.getByRole('button',{name:'Find market'}));await screen.findByText('Analysed');expect(screen.getAllByText('Volatility 10 S Index').length).toBeGreaterThan(0);expect(screen.getAllByText('90.0%').length).toBeGreaterThan(0);expect(document.body.textContent).not.toContain('New outcomes for current pattern');expect(onMarkets).toHaveBeenCalledOnce();fireEvent.click(screen.getByRole('button',{name:'Apply highest-probability setup'}));expect(onSelect).toHaveBeenCalledWith('R_10S',expect.objectContaining({probability:.9}));expect(f.provider.stream).toBeUndefined();expect(f.provider.execute).toBeUndefined();
});
it('changing duration reanalyses cached history instead of downloading it again, and Stop discards displayed rows',async()=>{
 const onMarkets=vi.fn(),onSelect=vi.fn();const {rerender}=render(<OverlordDiscovery duration={1} disabled={false} onSelect={onSelect} onMarkets={onMarkets}/>);fireEvent.click(screen.getByRole('button',{name:'Find market'}));await screen.findByText('Analysed');rerender(<OverlordDiscovery duration={2} disabled={false} onSelect={onSelect} onMarkets={onMarkets}/>);await screen.findByText(/500 non-overlapping 2-tick/);expect(f.provider.history).toHaveBeenCalledTimes(1);expect(f.provider.disconnect).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Stop scan'}));expect(screen.queryByText('Analysed')).toBeNull();expect(screen.getByRole('button',{name:'Find market'})).toBeTruthy();
});
it('running a bot blocks applying historical results, not read-only analysis',async()=>{
 render(<OverlordDiscovery duration={1} disabled={true} onSelect={vi.fn()} onMarkets={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Find market'}));await screen.findByText('Analysed');expect((screen.getByRole('button',{name:'Apply highest-probability setup'}) as HTMLButtonElement).disabled).toBe(true);
});
it('reports discovery errors and permits an explicit retry',async()=>{
 const list=vi.mocked(f.provider.activeSymbols as ()=>Promise<unknown>);list.mockRejectedValueOnce(Error('Discovery unavailable'));render(<OverlordDiscovery duration={1} disabled={false} onSelect={vi.fn()} onMarkets={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Find market'}));await screen.findByText(/Discovery unavailable/);fireEvent.click(screen.getByRole('button',{name:'Retry discovery'}));await screen.findByText('Analysed');await waitFor(()=>expect(list).toHaveBeenCalledTimes(2));
});
it('renders Run beside each analysed market and the highlighted best result',async()=>{
 const renderRun=vi.fn((row:{symbol:string},expired:boolean)=><button disabled={expired}>Run {row.symbol}</button>);render(<OverlordDiscovery duration={1} disabled={false} onSelect={vi.fn()} onMarkets={vi.fn()} renderRun={renderRun}/>);expect(screen.queryByRole('button',{name:'Run R_10S'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Find market'}));await screen.findByText('Analysed');expect(screen.getAllByRole('button',{name:'Run R_10S'})).toHaveLength(2);expect(renderRun).toHaveBeenCalledWith(expect.objectContaining({symbol:'R_10S',phase:'ready'}),false);
});
