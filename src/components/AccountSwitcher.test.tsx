// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const fixture = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock('@/state/store', () => ({ useApp: Object.assign((select: (state: Record<string, unknown>) => unknown) => select(fixture.state), { getState: () => fixture.state }) }));
import { AccountSwitcher } from './AccountSwitcher';
const demo = { loginid: 'DOT93175071', balance: 4172.24, currency: 'USD', isVirtual: true };
const real = { loginid: 'ROT123', balance: 0, currency: 'USD', isVirtual: false };
beforeEach(() => {
  fixture.state = {
    session: demo, accounts: [demo], settings: { mode: 'deriv_demo', realTradingAcknowledged: false },
    dataSource: 'deriv_live', balanceStatus: 'stale', balanceMessage: 'Connection failed', busy: null,
    selectAccount: vi.fn(async () => ({ ok: true, message: 'Selected' })),
    refreshSession: vi.fn(async () => {}), startBalanceStream: vi.fn(), stopBalanceStream: vi.fn(),
    applyMode: vi.fn(), setSettings: vi.fn(), pushLog: vi.fn(), disconnect: vi.fn(), syncBalances: vi.fn(),
  };
});
afterEach(cleanup);
describe('Real account control', () => {
  it('refreshes stale Demo-only rows and selects the returned Real account without acknowledgement', async () => {
    fixture.state.refreshSession = vi.fn(async () => { fixture.state.accounts = [demo, real]; });
    render(<AccountSwitcher />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    const realControl = screen.getByRole('menuitemradio', { name: 'Deriv Real' }) as HTMLButtonElement;
    expect(realControl.disabled).toBe(false);
    fireEvent.click(realControl);
    await waitFor(() => expect(fixture.state.selectAccount).toHaveBeenCalledWith('ROT123'));
    expect(fixture.state.refreshSession).toHaveBeenCalledWith(false);
  });
  it('shows an inline reason when Deriv actually returns no Real account', async () => {
    render(<AccountSwitcher />); fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Deriv Real' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Deriv has not returned a Real account'));
    expect(fixture.state.selectAccount).not.toHaveBeenCalled();
  });
  it('shows backend selection failure instead of silently closing the dropdown', async () => {
    fixture.state.accounts = [demo, real];
    fixture.state.selectAccount = vi.fn(async () => ({ ok: false, message: 'Session expired. Sign in again.' }));
    render(<AccountSwitcher />); fireEvent.click(screen.getByRole('button', { expanded: false }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Deriv Real' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Session expired'));
  });
});
