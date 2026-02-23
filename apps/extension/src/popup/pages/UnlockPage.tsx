import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Panel } from '@ext/components/Panel';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';
import { useVault } from '@ext/shared/hooks/useVault';

export const UnlockPage = () => {
  const navigate = useNavigate();
  const { status, loading, error, refresh } = useVault();
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (status?.unlocked) {
      navigate('/balance', { replace: true });
    }
  }, [navigate, status?.unlocked]);

  const unlock = async () => {
    try {
      setBusy(true);
      setLocalError(null);
      await sendRuntimeMessage({ kind: 'VAULT_UNLOCK', password });
      await refresh();
      navigate('/balance', { replace: true });
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Unlock failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Panel>
        <span className="dw-badge warn">Checking vault status...</span>
      </Panel>
    );
  }

  if (!status?.exists) {
    return (
      <Panel>
        <h2 className="dw-heading">No Vault Found</h2>
        <p className="dw-sub">Create a new wallet or import an existing recovery phrase first.</p>
        <div className="dw-inline">
          <Link to="/welcome" className="dw-button-link">
            Continue
          </Link>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <h2 className="dw-heading">Unlock Vault</h2>
      <p className="dw-sub">Enter your wallet password to enable signing.</p>

      {error ? <div className="dw-error">{error}</div> : null}
      {localError ? <div className="dw-error">{localError}</div> : null}

      <label className="dw-field" style={{ marginTop: 10 }}>
        <span className="dw-label">Password</span>
        <div className="dw-input-row">
          <input
            ref={inputRef}
            className="dw-input"
            type={showPassword ? 'text' : 'password'}
            aria-label="Enter wallet password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter wallet password"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !busy) {
                void unlock();
              }
            }}
          />
          <button
            type="button"
            className="dw-mini-button"
            onClick={() => setShowPassword((current) => !current)}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
          >
            {showPassword ? 'Hide' : 'Show'}
          </button>
        </div>
      </label>

      <div className="dw-inline" style={{ marginTop: 12 }}>
        <button className="dw-button" disabled={busy || password.length < 8} onClick={() => void unlock()}>
          {busy ? 'Unlocking...' : 'Unlock Wallet'}
        </button>
        <Link to="/import" className="dw-link">
          Forgot password? Import seed phrase
        </Link>
      </div>
    </Panel>
  );
};
