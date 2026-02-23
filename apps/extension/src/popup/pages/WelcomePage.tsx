import { Link } from 'react-router-dom';

import { Panel } from '@ext/components/Panel';

export const WelcomePage = () => (
  <Panel>
    <h2 className="dw-heading">Welcome to DarkWallet</h2>
    <p className="dw-sub">Create a new vault or import an existing seed phrase to start using your extension wallet.</p>

    <div className="dw-grid" style={{ marginTop: 14 }}>
      <Link to="/create" className="dw-button-link">
        Create New Wallet
      </Link>
      <Link to="/import" className="dw-button-link secondary">
        Import Seed Phrase
      </Link>
    </div>

    <div className="dw-panel" style={{ marginTop: 14 }}>
      <div className="dw-kv">
        <div className="dw-kv-label">Security model</div>
        <div className="dw-kv-value">Your mnemonic is encrypted locally with AES-256-GCM and never leaves your device.</div>
      </div>
    </div>
  </Panel>
);
