export interface AccountDiagnostics {
  checkedAt: number;
  httpStatus: number;
  returned: number;
  accepted: number;
  rejected: number;
  migration: 'complete' | 'pending' | 'failed' | 'not_applicable' | 'unavailable';
  legacyMappings: number | null;
}

/** Only counts and documented statuses: never tokens, raw payloads or historical balances. */
export function accountDiscoveryMessage(report?: AccountDiagnostics): string {
  if (!report) return 'No current Options trading account is selected. Refresh accounts to check Deriv.';
  if (report.rejected) return `Deriv returned ${report.returned} account row(s), but ${report.rejected} could not be safely read. No balance or account identity has been invented.`;
  if (report.migration === 'pending') return 'Deriv reports your Options platform migration is pending. Historical mappings do not establish live trading access. Check your upgrade status in Deriv; this app cannot complete the migration.';
  if (report.migration === 'failed') return 'Deriv reports your Options platform migration failed. Contact Deriv support about the platform upgrade; reconnecting here cannot repair it.';
  if (report.legacyMappings) return `Deriv returned ${report.accepted} current Options trading account(s), but ${report.legacyMappings} historical login mapping(s) exist. Historical mappings do not include live balances or trading access. Ask Deriv support to check your Options account migration.`;
  if (report.accepted) return `Deriv returned ${report.accepted} current Options account(s), but no Real Options account. Other Deriv products and historical accounts are separate. Check your Options account in Deriv before reconnecting.`;
  return 'Signed in to Deriv, but its current Options API returned no trading accounts. This does not prove your Deriv profile has no Real account: wallets, MT5 and historical accounts are separate. Open Deriv to check your Options account, then refresh here.';
}
