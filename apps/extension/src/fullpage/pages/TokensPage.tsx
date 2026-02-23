import { useEffect, useMemo, useState } from 'react';

import { Panel } from '@ext/components/Panel';
import { resolveBlockfrostConfig, fetchAddressBalance, type BlockfrostAmount } from '@ext/shared/providers/blockfrost';
import { sendRuntimeMessage } from '@ext/shared/services/runtime-client';
import { useVault } from '@ext/shared/hooks/useVault';
import type { ExtensionSettings } from '@ext/shared/storage/preferences';

type TokenRow = {
  unit: string;
  quantity: string;
};

const shortenUnit = (unit: string): string => (unit.length > 26 ? `${unit.slice(0, 12)}…${unit.slice(-12)}` : unit);

export const TokensPage = () => {
  const { status } = useVault();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [adaLovelace, setAdaLovelace] = useState('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        if (!status?.publicAddress) return;
        setLoading(true);
        setError(null);

        const settings = await sendRuntimeMessage<ExtensionSettings>({ kind: 'SETTINGS_GET' });
        if (!settings.blockfrostProjectId.trim()) {
          setTokens([]);
          setAdaLovelace('0');
          setError('Configure Blockfrost Project ID in Settings to load token and NFT metadata.');
          return;
        }

        const blockfrost = resolveBlockfrostConfig({
          network: settings.network,
          projectId: settings.blockfrostProjectId,
          baseUrl: settings.blockfrostBaseUrl,
        });
        const balance = await fetchAddressBalance(blockfrost, status.publicAddress);
        const lovelace = balance.amount.find((entry) => entry.unit === 'lovelace')?.quantity ?? '0';
        const nonLovelace = balance.amount.filter((entry) => entry.unit !== 'lovelace');
        setAdaLovelace(lovelace);
        setTokens(nonLovelace.map((entry: BlockfrostAmount) => ({ unit: entry.unit, quantity: entry.quantity })));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load token balances');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [status?.publicAddress]);

  const ada = useMemo(() => (Number(adaLovelace) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 }), [adaLovelace]);

  return (
    <Panel>
      <h2 className="dw-heading">Tokens & NFTs</h2>
      <p className="dw-sub">Cardano native assets detected for your extension account.</p>

      {error ? <div className="dw-error">{error}</div> : null}
      {loading ? <div className="dw-badge warn">Loading token inventory...</div> : null}

      <div className="dw-panel" style={{ marginTop: 12 }}>
        <div className="dw-kv">
          <div className="dw-kv-label">ADA Balance</div>
          <div className="dw-kv-value">{ada} ADA</div>
        </div>
      </div>

      <div className="dw-panel" style={{ marginTop: 12 }}>
        <div className="dw-kv" style={{ gap: 8 }}>
          <div className="dw-kv-label">Assets</div>
          {tokens.length ? (
            tokens.map((asset) => (
              <div key={`${asset.unit}-${asset.quantity}`} className="dw-row">
                <div>
                  <div className="dw-code">{shortenUnit(asset.unit)}</div>
                  <div className="dw-kv-label">Asset unit</div>
                </div>
                <div className="dw-kv-value">{asset.quantity}</div>
              </div>
            ))
          ) : (
            <div className="dw-kv-value">No native assets on this address.</div>
          )}
        </div>
      </div>
    </Panel>
  );
};
