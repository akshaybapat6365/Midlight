import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Panel } from '@ext/components/Panel';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';
import type { ApprovalsResponse, PendingApprovalRequest } from '@ext/shared/types/runtime';

type Approvals = Record<string, { grantedAt: string }>;

export const ApprovalPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get('requestId') ?? undefined;

  const [pending, setPending] = useState<PendingApprovalRequest | null>(null);
  const [approvals, setApprovals] = useState<Approvals>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setError(null);
      const [nextPending, nextApprovals] = await Promise.all([
        sendRuntimeMessage<PendingApprovalRequest | null>({ kind: 'APPROVAL_PENDING_GET', requestId }),
        sendRuntimeMessage<ApprovalsResponse>({ kind: 'APPROVAL_LIST' }),
      ]);
      setPending(nextPending);
      setApprovals(nextApprovals);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load approval state');
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
      await sendRuntimeMessage({ kind: 'APPROVAL_PENDING_RESOLVE', requestId: pending.requestId, allow });
      await refresh();
      navigate('/balance', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve approval request');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (origin: string) => {
    try {
      setError(null);
      await sendRuntimeMessage({ kind: 'APPROVAL_REVOKE', origin });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke approval');
    }
  };

  return (
    <Panel>
      <h2 className="dw-heading">Connection Approval</h2>
      <p className="dw-sub">Review and approve dApp access requests.</p>
      {error ? <div className="dw-error">{error}</div> : null}

      {pending ? (
        <div className="dw-panel" style={{ marginTop: 12 }}>
          <div className="dw-kv">
            <div className="dw-kv-label">Requesting origin</div>
            <div className="dw-kv-value dw-code">{pending.origin}</div>
            <div className="dw-kv-label">Permissions</div>
            <div className="dw-kv-value">View addresses, request signatures, and submit transactions</div>
          </div>

          <div className="dw-inline" style={{ marginTop: 12 }}>
            <button className="dw-button secondary" disabled={busy} onClick={() => void resolve(false)}>
              Reject
            </button>
            <button className="dw-button" disabled={busy} onClick={() => void resolve(true)}>
              Approve
            </button>
          </div>
        </div>
      ) : (
        <div className="dw-badge warn" style={{ marginTop: 12 }}>
          No pending connection request.
        </div>
      )}

      <div className="dw-panel" style={{ marginTop: 12 }}>
        <div className="dw-kv" style={{ gap: 8 }}>
          <div className="dw-kv-label">Approved dApps</div>
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
            <div className="dw-kv-value">No approved origins yet.</div>
          )}
        </div>
      </div>
    </Panel>
  );
};
