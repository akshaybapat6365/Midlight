import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Panel } from '@ext/components/Panel';
import { validateMnemonic } from '@ext/shared/crypto/mnemonic';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';

export const ImportWalletPage = () => {
  const navigate = useNavigate();
  const [mnemonic, setMnemonic] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    try {
      setError(null);
      const normalizedMnemonic = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ');
      if (!validateMnemonic(normalizedMnemonic)) {
        setError('Invalid seed phrase. Expected a valid 24-word mnemonic.');
        return;
      }
      if (password.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }

      setBusy(true);
      await sendRuntimeMessage({
        kind: 'VAULT_CREATE',
        password,
        mnemonic: normalizedMnemonic,
      });
      navigate('/balance', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import wallet');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <h2 className="dw-heading">Import Wallet</h2>
      <p className="dw-sub">Restore from your 24-word recovery phrase.</p>
      {error ? <div className="dw-error">{error}</div> : null}

      <div className="dw-grid" style={{ marginTop: 10 }}>
        <label className="dw-field">
          <span className="dw-label">Recovery phrase</span>
          <textarea
            className="dw-textarea"
            aria-label="Recovery phrase"
            value={mnemonic}
            onChange={(event) => setMnemonic(event.target.value)}
            placeholder="word1 word2 ... word24"
          />
        </label>

        <label className="dw-field">
          <span className="dw-label">Password</span>
          <input
            className="dw-input"
            type="password"
            aria-label="Password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Minimum 8 characters"
          />
        </label>

        <label className="dw-field">
          <span className="dw-label">Confirm password</span>
          <input
            className="dw-input"
            type="password"
            aria-label="Confirm password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>
      </div>

      <div className="dw-inline" style={{ marginTop: 12 }}>
        <button className="dw-button" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Importing...' : 'Import Wallet'}
        </button>
        <Link to="/welcome" className="dw-link">
          Cancel
        </Link>
      </div>
    </Panel>
  );
};
