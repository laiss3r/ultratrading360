import type { AccountInfo } from './types';

/** Fresh authentication prefers a returned Real row; subsequent user choices win. */
export function selectSessionAccount(
  session: { loginid: string; initialRealAccountPending?: boolean },
  accounts: AccountInfo[],
): AccountInfo | undefined {
  const real = accounts.find((a) => a.is_virtual === 0);
  return (session.initialRealAccountPending ? real : undefined)
    ?? accounts.find((a) => a.account_loginid === session.loginid)
    ?? real
    ?? accounts[0];
}
