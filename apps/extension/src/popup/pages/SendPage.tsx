import { useState } from 'react';

import { Panel } from '@ext/components/Panel';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';
import type { TxBuildResult, TxSignSubmitResult } from '@ext/shared/types/runtime';
import { useVault } from '@ext/shared/hooks/useVault';

const lovelaceToAda = (value: string): string => (Number(value) / 1_000_000).toFixed(6);

export const SendPage = () => {
  const { status } = useVault();
  const [toAddress, setToAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [prepared, setPrepared] = useState<TxBuildResult | null>(null);
  const [submitted, setSubmitted] = useState<TxSignSubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prepareTransfer = async () => {
    try {
      setBusy(true);
      setError(null);
      setSubmitted(null);
      const built = await sendRuntimeMessage<TxBuildResult>({
        kind: 'TX_BUILD',
        toAddress: toAddress.trim(),
        amountAda: amount.trim(),
      });
      setPrepared(built);
    } catch (err) {
      setPrepared(null);
      setError(err instanceof Error ? err.message : 'Failed to build transaction');
    } finally {
      setBusy(false);
    }
  };

  const signAndSubmit = async () => {
    if (!prepared) return;
    try {
      setBusy(true);
      setError(null);
      const result = await sendRuntimeMessage<TxSignSubmitResult>({
        kind: 'TX_SIGN_AND_SUBMIT',
        txCborHex: prepared.txCborHex,
      });
      setSubmitted(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign and submit transaction');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <h2 className="dw-heading">Send ADA</h2>
      <p className="dw-sub">Build, sign, and submit Cardano transfers from your extension wallet.</p>

      {!status?.unlocked ? <div className="dw-error">Unlock wallet before preparing a transfer.</div> : null}
      {error ? <div className="dw-error">{error}</div> : null}

      <div className="dw-grid" style={{ marginTop: 12 }}>
        <label className="dw-field">
          <span className="dw-label">Recipient address</span>
          <input
            className="dw-input dw-code"
            value={toAddress}
            onChange={(event) => setToAddress(event.target.value)}
            placeholder="addr1..."
          />
        </label>

        <label className="dw-field">
          <span className="dw-label">Amount (ADA)</span>
          <input
            className="dw-input"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.500000"
          />
        </label>
      </div>

      <div className="dw-inline" style={{ marginTop: 12 }}>
        <button className="dw-button" disabled={!status?.unlocked || !toAddress || !amount || busy} onClick={() => void prepareTransfer()}>
          {busy ? 'Preparing...' : 'Prepare Transfer'}
        </button>
        <button className="dw-button secondary" disabled={!prepared || busy} onClick={() => void signAndSubmit()}>
          {busy ? 'Submitting...' : 'Sign & Broadcast'}
        </button>
      </div>

      {prepared ? (
        <div className="dw-panel" style={{ marginTop: 12 }}>
          <div className="dw-kv">
            <div className="dw-kv-label">Recipient</div>
            <div className="dw-kv-value dw-code">{prepared.summary.toAddress}</div>
            <div className="dw-kv-label">Amount</div>
            <div className="dw-kv-value">{lovelaceToAda(prepared.summary.amountLovelace)} ADA</div>
            <div className="dw-kv-label">Fee</div>
            <div className="dw-kv-value">{lovelaceToAda(prepared.summary.feeLovelace)} ADA</div>
            <div className="dw-kv-label">Total</div>
            <div className="dw-kv-value">{lovelaceToAda(prepared.summary.totalLovelace)} ADA</div>
          </div>
        </div>
      ) : null}

      {submitted ? (
        <div className="dw-panel" style={{ marginTop: 12 }}>
          <div className="dw-kv">
            <div className="dw-kv-label">Submitted Tx Hash</div>
            <div className="dw-kv-value dw-code">{submitted.txHash}</div>
          </div>
        </div>
      ) : null}
    </Panel>
  );
};
