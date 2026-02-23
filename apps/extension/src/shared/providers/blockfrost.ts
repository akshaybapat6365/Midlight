import type { CardanoNetwork } from '@ext/shared/crypto/hd-wallet';

export type BlockfrostConfig = {
  baseUrl: string;
  projectId: string;
};

export type BlockfrostAmount = {
  unit: string;
  quantity: string;
};

export type BlockfrostAddress = {
  address: string;
  amount: BlockfrostAmount[];
  tx_count: number;
};

export type BlockfrostUtxo = {
  address?: string;
  tx_hash: string;
  tx_index: number;
  output_index: number;
  amount: BlockfrostAmount[];
  block: string;
  data_hash: string | null;
  inline_datum: string | null;
  reference_script_hash: string | null;
};

export type BlockfrostTxRef = {
  tx_hash: string;
  tx_index: number;
  block_height: number;
  block_time: number;
};

export type BlockfrostProtocolParameters = {
  min_fee_a: number;
  min_fee_b: number;
  max_tx_size: number;
  max_val_size: string;
  key_deposit: string;
  pool_deposit: string;
  coins_per_utxo_size?: string;
  coins_per_utxo_word?: string;
  coins_per_utxo_byte?: string;
};

const defaultBaseUrl = (network: CardanoNetwork): string => {
  if (network === 'preview') return 'https://cardano-preview.blockfrost.io/api/v0';
  if (network === 'preprod') return 'https://cardano-preprod.blockfrost.io/api/v0';
  return 'https://cardano-mainnet.blockfrost.io/api/v0';
};

const request = async <T>(config: BlockfrostConfig, pathname: string, init?: RequestInit): Promise<T> => {
  const url = `${config.baseUrl}${pathname}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      project_id: config.projectId,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Blockfrost ${response.status} ${pathname}: ${text}`);
  }
  if (response.headers.get('content-type')?.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
};

export const resolveBlockfrostConfig = (params: {
  network: CardanoNetwork;
  projectId: string;
  baseUrl?: string;
}): BlockfrostConfig => ({
  baseUrl: params.baseUrl?.trim() || defaultBaseUrl(params.network),
  projectId: params.projectId.trim(),
});

export const fetchAddressBalance = async (config: BlockfrostConfig, address: string): Promise<BlockfrostAddress> =>
  await request<BlockfrostAddress>(config, `/addresses/${encodeURIComponent(address)}`);

export const fetchUtxos = async (
  config: BlockfrostConfig,
  address: string,
  page = 1,
  count = 100,
): Promise<BlockfrostUtxo[]> =>
  await request<BlockfrostUtxo[]>(
    config,
    `/addresses/${encodeURIComponent(address)}/utxos?page=${page}&count=${count}`,
  );

export const fetchTransactionHistory = async (
  config: BlockfrostConfig,
  address: string,
  page = 1,
  count = 20,
): Promise<BlockfrostTxRef[]> =>
  await request<BlockfrostTxRef[]>(
    config,
    `/addresses/${encodeURIComponent(address)}/transactions?page=${page}&count=${count}&order=desc`,
  );

export const fetchProtocolParameters = async (config: BlockfrostConfig): Promise<BlockfrostProtocolParameters> =>
  await request<BlockfrostProtocolParameters>(config, '/epochs/latest/parameters');

export const submitTransaction = async (config: BlockfrostConfig, txCborHex: string): Promise<string> => {
  const clean = txCborHex.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('txCborHex must be an even-length hex string');
  }
  const body = Uint8Array.from(
    { length: clean.length / 2 },
    (_, index) => Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16),
  );
  return await request<string>(config, '/tx/submit', {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/cbor' },
  });
};
