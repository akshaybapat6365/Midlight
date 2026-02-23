import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { MetricCard } from '@ext/components/MetricCard';
import { Panel } from '@ext/components/Panel';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';
import { useVault } from '@ext/shared/hooks/useVault';

const formatAda = (lovelace: string): string => {
  const value = Number(lovelace);
  if (!Number.isFinite(value)) return '0';
  const ada = value / 1_000_000;
  return ada.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
};

export const BalancePage = () => {
  const navigate = useNavigate();
  const { status, balance, loading, error, refresh } = useVault();

  const ada = useMemo(() => formatAda(balance?.adaLovelace ?? '0'), [balance?.adaLovelace]);

  const openFullDashboard = async () => {
    const url = chrome.runtime.getURL('src/fullpage/index.html');
    await chrome.tabs.create({ url });
  };

  const lockWallet = async () => {
    await sendRuntimeMessage({ kind: 'VAULT_LOCK' });
    await refresh();
    navigate('/unlock', { replace: true });
  };

  return (
    <Panel>
      <h2 className="dw-heading">Portfolio</h2>
      <p className="dw-sub">Live account snapshot for your extension wallet.</p>

      {status?.unlocked ? <span className="dw-badge success">Wallet unlocked</span> : <span className="dw-badge warn">Wallet locked</span>}
      {error ? (
        <div className="dw-error" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}

      <div className="dw-grid dw-grid-2" style={{ marginTop: 12 }}>
        <MetricCard label="Cardano" value={`${ada} ADA`}>
          {balance ? balance.network : 'No network'}
        </MetricCard>
        <MetricCard label="Midnight" value={balance ? `${balance.midnightShielded} NIGHT` : '0 NIGHT'}>
          shielded
        </MetricCard>
      </div>

      <div className="dw-panel" style={{ marginTop: 12 }}>
        <div className="dw-kv">
          <div className="dw-kv-label">Primary Address</div>
          <div className="dw-kv-value dw-code">{status?.publicAddress ?? 'No vault address yet'}</div>
        </div>
      </div>

      <div className="dw-inline" style={{ marginTop: 12 }}>
        <button className="dw-button" disabled={loading} onClick={() => void refresh()}>
          Refresh Balance
        </button>
        <button className="dw-button secondary" onClick={() => void navigate('/send')}>
          Send
        </button>
        <button className="dw-button secondary" onClick={() => void navigate('/receive')}>
          Receive
        </button>
      </div>

      <div className="dw-inline" style={{ marginTop: 10 }}>
        <button className="dw-button secondary" onClick={() => void openFullDashboard()}>
          Open Full Dashboard
        </button>
        <button className="dw-button secondary" onClick={() => void navigate('/settings')}>
          Settings
        </button>
        <button className="dw-button secondary" onClick={() => void lockWallet()}>
          Lock
        </button>
      </div>
    </Panel>
  );
};
