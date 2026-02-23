import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Panel } from '@ext/components/Panel';
import { generateMnemonic24 } from '@ext/shared/crypto/mnemonic';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';

const pickVerificationIndexes = (): number[] => {
  const pool = Array.from({ length: 24 }, (_, index) => index);
  const picked: number[] = [];
  while (picked.length < 3) {
    const randomIndex = Math.floor(Math.random() * pool.length);
    const [value] = pool.splice(randomIndex, 1);
    picked.push(value);
  }
  return picked.sort((a, b) => a - b);
};

export const CreateWalletPage = () => {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [backupConfirmed, setBackupConfirmed] = useState(false);
  const [verifyIndexes, setVerifyIndexes] = useState<number[]>([]);
  const [verifyAnswers, setVerifyAnswers] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const words = useMemo(() => mnemonic.split(/\s+/).filter(Boolean), [mnemonic]);

  const nextFromStep1 = () => {
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setError(null);
    const generated = generateMnemonic24();
    setMnemonic(generated);
    setVerifyIndexes(pickVerificationIndexes());
    setStep(2);
  };

  const nextFromStep2 = () => {
    if (!backupConfirmed) {
      setError('Confirm that you backed up the recovery phrase before continuing');
      return;
    }
    setError(null);
    setStep(3);
  };

  const complete = async () => {
    try {
      setError(null);
      const currentWords = mnemonic.split(/\s+/).filter(Boolean);
      const mismatch = verifyIndexes.some((index) => (verifyAnswers[index] ?? '').trim().toLowerCase() !== currentWords[index]?.toLowerCase());
      if (mismatch) {
        setError('One or more verification words are incorrect');
        return;
      }

      setBusy(true);
      await sendRuntimeMessage({
        kind: 'VAULT_CREATE',
        password,
        mnemonic,
      });
      navigate('/balance', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create wallet');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <h2 className="dw-heading">Create Wallet</h2>
      <p className="dw-sub">Step {step} of 3</p>
      {error ? <div className="dw-error">{error}</div> : null}

      {step === 1 ? (
        <div className="dw-grid" style={{ marginTop: 10 }}>
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
              placeholder="Repeat password"
            />
          </label>

          <button className="dw-button" onClick={nextFromStep1}>
            Continue
          </button>
        </div>
      ) : null}

      {step === 2 ? (
        <>
          <div className="dw-panel" style={{ marginTop: 10 }}>
            <div className="dw-kv">
              <div className="dw-kv-label">Recovery phrase</div>
              <div className="dw-mnemonic-grid">
                {words.map((word, index) => (
                  <div key={`${word}-${index}`} className="dw-mnemonic-chip">
                    <span>{index + 1}.</span>
                    <strong>{word}</strong>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <label className="dw-check" style={{ marginTop: 10 }}>
            <input
              type="checkbox"
              checked={backupConfirmed}
              onChange={(event) => setBackupConfirmed(event.target.checked)}
            />
            <span>I have written down my 24-word recovery phrase.</span>
          </label>

          <div className="dw-inline" style={{ marginTop: 12 }}>
            <button className="dw-button" onClick={nextFromStep2}>
              Continue to verification
            </button>
            <button className="dw-button secondary" onClick={() => setStep(1)}>
              Back
            </button>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <>
          <div className="dw-grid" style={{ marginTop: 10 }}>
            {verifyIndexes.map((index) => (
              <label key={index} className="dw-field">
                <span className="dw-label">Word #{index + 1}</span>
                <input
                  className="dw-input"
                  aria-label={`Word #${index + 1}`}
                  value={verifyAnswers[index] ?? ''}
                  onChange={(event) =>
                    setVerifyAnswers((current) => ({
                      ...current,
                      [index]: event.target.value,
                    }))
                  }
                />
              </label>
            ))}
          </div>

          <div className="dw-inline" style={{ marginTop: 12 }}>
            <button className="dw-button" onClick={() => void complete()} disabled={busy}>
              {busy ? 'Creating...' : 'Create Wallet'}
            </button>
            <button className="dw-button secondary" onClick={() => setStep(2)} disabled={busy}>
              Back
            </button>
          </div>
        </>
      ) : null}

      <div className="dw-inline" style={{ marginTop: 14 }}>
        <Link to="/welcome" className="dw-link">
          Cancel
        </Link>
      </div>
    </Panel>
  );
};
