import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { Panel } from '@ext/components/Panel';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';
import type { ApprovalsResponse } from '@ext/shared/types/runtime';
import type { ExtensionSettings } from '@ext/shared/storage/preferences';

export const SettingsPage = () => {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<ExtensionSettings | null>(null);
  const [approvals, setApprovals] = useState<ApprovalsResponse>({});
  const [seedPassword, setSeedPassword] = useState('');
  const [seedPhrase, setSeedPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    try {
      setError(null);
      const [nextSettings, nextApprovals] = await Promise.all([
        sendRuntimeMessage<ExtensionSettings>({ kind: 'SETTINGS_GET' }),
        sendRuntimeMessage<ApprovalsResponse>({ kind: 'APPROVAL_LIST' }),
      ]);
      setSettings(nextSettings);
      setApprovals(nextApprovals);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const patchSettings = async (patch: Partial<ExtensionSettings>) => {
    try {
      setBusy(true);
      setError(null);
      const next = await sendRuntimeMessage<ExtensionSettings>({ kind: 'SETTINGS_UPDATE', patch });
      setSettings(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (origin: string) => {
    await sendRuntimeMessage({ kind: 'APPROVAL_REVOKE', origin });
    await refresh();
  };

  const showSeedPhrase = async () => {
    try {
      setError(null);
      const response = await sendRuntimeMessage<{ mnemonic: string }>({ kind: 'VAULT_EXPORT_MNEMONIC', password: seedPassword });
      setSeedPhrase(response.mnemonic);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export seed phrase');
    }
  };

  const resetWallet = async () => {
    if (!window.confirm('Reset wallet and clear all local extension data? This cannot be undone.')) return;
    try {
      setBusy(true);
      await sendRuntimeMessage({ kind: 'VAULT_RESET' });
      navigate('/welcome', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset wallet');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <h2 className="dw-heading">Settings</h2>
      <p className="dw-sub">Manage network, security, and dApp permissions.</p>
      {error ? <div className="dw-error">{error}</div> : null}

      {settings ? (
        <div className="dw-grid" style={{ marginTop: 10 }}>
          <label className="dw-field">
            <span className="dw-label">Network</span>
            <select
              className="dw-input"
              value={settings.network}
              disabled={busy}
              onChange={(event) => void patchSettings({ network: event.target.value as ExtensionSettings['network'] })}
            >
              <option value="preview">Preview</option>
              <option value="preprod">Preprod</option>
              <option value="mainnet">Mainnet</option>
              <option value="standalone">Standalone</option>
            </select>
          </label>

          <label className="dw-field">
            <span className="dw-label">Auto-lock</span>
            <select
              className="dw-input"
              value={String(settings.autoLockMinutes)}
              disabled={busy}
              onChange={(event) => void patchSettings({ autoLockMinutes: Number(event.target.value) })}
            >
              <option value="5">5 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="240">4 hours</option>
            </select>
          </label>

          <label className="dw-field">
            <span className="dw-label">Theme</span>
            <select
              className="dw-input"
              value={settings.theme}
              disabled={busy}
              onChange={(event) => void patchSettings({ theme: event.target.value as ExtensionSettings['theme'] })}
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </label>

          <label className="dw-field">
            <span className="dw-label">Backend URL</span>
            <input
              className="dw-input"
              value={settings.backendBaseUrl}
              onChange={(event) => setSettings((current) => (current ? { ...current, backendBaseUrl: event.target.value } : current))}
              onBlur={(event) => void patchSettings({ backendBaseUrl: event.target.value })}
            />
          </label>

          <label className="dw-field">
            <span className="dw-label">Blockfrost Project ID</span>
            <input
              className="dw-input"
              value={settings.blockfrostProjectId}
              onChange={(event) => setSettings((current) => (current ? { ...current, blockfrostProjectId: event.target.value } : current))}
              onBlur={(event) => void patchSettings({ blockfrostProjectId: event.target.value })}
              placeholder="Required for on-chain tx building"
            />
          </label>

          <label className="dw-field">
            <span className="dw-label">Blockfrost Base URL (optional)</span>
            <input
              className="dw-input"
              value={settings.blockfrostBaseUrl ?? ''}
              onChange={(event) => setSettings((current) => (current ? { ...current, blockfrostBaseUrl: event.target.value } : current))}
              onBlur={(event) => void patchSettings({ blockfrostBaseUrl: event.target.value })}
              placeholder="https://cardano-preview.blockfrost.io/api/v0"
            />
          </label>

          <label className="dw-check">
            <input
              type="checkbox"
              checked={settings.signaturePromptEnabled}
              onChange={(event) => void patchSettings({ signaturePromptEnabled: event.target.checked })}
            />
            <span>Prompt before every dApp signature request</span>
          </label>
        </div>
      ) : (
        <div className="dw-badge warn">Loading settings...</div>
      )}

      <div className="dw-panel" style={{ marginTop: 12 }}>
        <div className="dw-kv" style={{ gap: 8 }}>
          <div className="dw-kv-label">Connected dApps</div>
          {Object.keys(approvals).length ? (
            Object.entries(approvals).map(([origin, details]) => (
              <div key={origin} className="dw-row">
                <div>
                  <div className="dw-code">{origin}</div>
                  <div className="dw-kv-label">Granted {new Date(details.grantedAt).toLocaleString()}</div>
                </div>
                <button className="dw-mini-button" onClick={() => void revoke(origin)}>
                  Revoke
                </button>
              </div>
            ))
          ) : (
            <div className="dw-kv-value">No dApps connected.</div>
          )}
        </div>
      </div>

      <div className="dw-panel" style={{ marginTop: 12 }}>
        <div className="dw-kv">
          <div className="dw-kv-label">Danger zone</div>
        </div>
        <label className="dw-field" style={{ marginTop: 8 }}>
          <span className="dw-label">Password to reveal seed phrase</span>
          <input
            className="dw-input"
            type="password"
            value={seedPassword}
            onChange={(event) => setSeedPassword(event.target.value)}
          />
        </label>
        <div className="dw-inline" style={{ marginTop: 10 }}>
          <button className="dw-button secondary" disabled={!seedPassword} onClick={() => void showSeedPhrase()}>
            Show Seed Phrase
          </button>
          <button className="dw-button secondary" disabled={busy} onClick={() => void resetWallet()}>
            Reset Wallet
          </button>
        </div>
        {seedPhrase ? (
          <div className="dw-panel" style={{ marginTop: 10 }}>
            <div className="dw-kv">
              <div className="dw-kv-label">Recovery phrase</div>
              <div className="dw-kv-value dw-code">{seedPhrase}</div>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
};
