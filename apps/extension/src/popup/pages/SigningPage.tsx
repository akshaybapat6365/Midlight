import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Panel } from '@ext/components/Panel';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';
import type { PendingSignRequest } from '@ext/shared/types/runtime';

const lovelaceToAda = (value: string): string => (Number(value) / 1_000_000).toFixed(6);

export const SigningPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('requestId') ?? undefined;

  const [pending, setPending] = useState<PendingSignRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setError(null);
      const next = await sendRuntimeMessage<PendingSignRequest | null>({ kind: 'SIGN_PENDING_GET', requestId });
      setPending(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load signing request');
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  const resolve = async (allow: boolean) => {
    if (!pending) return;
    try {
      setBusy(true);
      setError(null);
      await sendRuntimeMessage({ kind: 'SIGN_PENDING_RESOLVE', requestId: pending.requestId, allow });
      navigate('/balance', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve signing request');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <h2 className="dw-heading">Sign Transaction</h2>
      <p className="dw-sub">Review the transaction details before approving wallet signature.</p>

      {error ? <div className="dw-error">{error}</div> : null}

      {pending ? (
        <>
          <div className="dw-panel" style={{ marginTop: 12 }}>
            <div className="dw-kv">
              <div className="dw-kv-label">Origin</div>
              <div className="dw-kv-value dw-code">{pending.origin}</div>
              <div className="dw-kv-label">Recipient</div>
              <div className="dw-kv-value dw-code">{pending.summary.toAddress}</div>
              <div className="dw-kv-label">Amount</div>
              <div className="dw-kv-value">{lovelaceToAda(pending.summary.amountLovelace)} ADA</div>
              <div className="dw-kv-label">Fee</div>
              <div className="dw-kv-value">{lovelaceToAda(pending.summary.feeLovelace)} ADA</div>
            </div>
          </div>

          <div className="dw-inline" style={{ marginTop: 12 }}>
            <button className="dw-button secondary" disabled={busy} onClick={() => void resolve(false)}>
              Reject
            </button>
            <button className="dw-button" disabled={busy} onClick={() => void resolve(true)}>
              Sign
            </button>
          </div>
        </>
      ) : (
        <div className="dw-badge warn" style={{ marginTop: 12 }}>
          No pending signing request.
        </div>
      )}
    </Panel>
  );
};
