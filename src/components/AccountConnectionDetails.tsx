'use client';
import { useApp } from '@/state/store';
import { accountDiscoveryMessage } from '@/lib/deriv/accountDiagnostics';
import { Notice, Panel } from './ui';

export function AccountConnectionDetails() {
  const session = useApp((s)=>s.session);
  if (!session || (session.loginid && !session.accountDiagnostics)) return null;
  const report = session.accountDiagnostics;
  return <Panel title="Connection details" subtitle="Read-only broker results · no tokens or authorization codes">
    <Notice tone="warning">{accountDiscoveryMessage(report)}</Notice>
    {report && <dl className="micro" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginTop:16}}>
      <dt>Options account endpoint</dt><dd>HTTP {report.httpStatus}</dd>
      <dt>Rows returned / accepted / rejected</dt><dd>{report.returned} / {report.accepted} / {report.rejected}</dd>
      <dt>Deriv migration status</dt><dd>{report.migration}</dd>
      <dt>Historical login mappings (not tradable)</dt><dd>{report.legacyMappings ?? 'Unavailable'}</dd>
      <dt>Checked</dt><dd>{new Date(report.checkedAt).toLocaleTimeString()}</dd>
    </dl>}
    <p className="micro muted" style={{marginTop:14}}>Wallet and MT5 balances are not Options balances. Historical mappings are never converted into live accounts here. If migration is pending or failed, contact Deriv support from your Deriv account. No accounts are created and no funds are moved during this check.</p>
    <a className="button button-secondary" href="https://app.deriv.com/" target="_blank" rel="noopener noreferrer">Open Deriv</a>
  </Panel>;
}
