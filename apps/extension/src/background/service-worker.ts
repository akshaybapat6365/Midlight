import { RUNTIME_CONFIG, EXTENSION_STORAGE_KEYS } from '@ext/shared/config';
import { buildSimpleTransfer } from '@ext/shared/crypto/tx-builder';
import { deriveCardanoWallet } from '@ext/shared/crypto/hd-wallet';
import {
  fetchAddressBalance,
  fetchProtocolParameters,
  fetchUtxos,
  resolveBlockfrostConfig,
  submitTransaction,
  type BlockfrostAmount,
  type BlockfrostUtxo,
} from '@ext/shared/providers/blockfrost';
import {
  clearApprovals,
  getApprovals,
  getSettings,
  grantApproval,
  resetSettings,
  revokeApproval,
  updateSettings,
  type ExtensionSettings,
} from '@ext/shared/storage/preferences';
import { createVault, readVaultHints, resetVault, unlockVault, vaultExists, type VaultSession } from '@ext/shared/storage/vault';
import type {
  PendingApprovalRequest,
  PendingSignRequest,
  RuntimeMessage,
  RuntimeResponse,
  TransactionSummary,
  TxBuildResult,
  TxSignSubmitResult,
  VaultStatus,
  WalletBalanceSnapshot,
} from '@ext/shared/types/runtime';
import * as CSL from '@emurgo/cardano-serialization-lib-asmjs';

const networkIdMap: Record<string, number> = {
  mainnet: 1,
  preprod: 0,
  preview: 0,
  standalone: 0,
};

const BALANCE_CACHE_TTL_MS = 30_000;
const PENDING_REQUEST_TTL_MS = 5 * 60_000;
const BALANCE_REFRESH_ALARM = 'darkwallet.balance-refresh';

type BalanceCacheRecord = {
  address: string;
  cachedAt: number;
  snapshot: WalletBalanceSnapshot;
};

type PendingApprovalState = PendingApprovalRequest & {
  resolve: (allow: boolean) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type PendingSignState = PendingSignRequest & {
  resolve: (allow: boolean) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

let session: VaultSession | null = null;

const pendingApprovals = new Map<string, PendingApprovalState>();
const pendingSigns = new Map<string, PendingSignState>();

const createRequestId = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const makeOk = <T>(requestId: string, data: T): RuntimeResponse<T> => ({ ok: true, data, requestId });

const makeErr = (requestId: string, code: string, message: string): RuntimeResponse<never> => ({
  ok: false,
  error: { code, message },
  requestId,
});

const ensureSessionFresh = () => {
  if (!session) return;
  if (Date.now() >= session.autoLockAt) {
    session = null;
    void setBadgeText('');
  }
};

const requireSession = (): VaultSession => {
  ensureSessionFresh();
  if (!session) throw new Error('Wallet is locked');
  return session;
};

const isInternalOrigin = (origin: string): boolean => origin.startsWith('chrome-extension://');

const strip0x = (value: string): string => value.trim().replace(/^0x/i, '');

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const hexToBytes = (hex: string): Uint8Array => {
  const clean = strip0x(hex);
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Expected even-length hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    out[i / 2] = Number.parseInt(clean.slice(i, i + 2), 16);
  }
  return out;
};

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const encodeMajorTypeLength = (majorType: number, value: number): Uint8Array => {
  if (!Number.isInteger(value) || value < 0) throw new Error('Invalid CBOR length');
  if (value < 24) return Uint8Array.of((majorType << 5) | value);
  if (value < 256) return Uint8Array.of((majorType << 5) | 24, value);
  if (value < 65_536) return Uint8Array.of((majorType << 5) | 25, value >> 8, value & 0xff);
  if (value < 4_294_967_296) {
    return Uint8Array.of(
      (majorType << 5) | 26,
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    );
  }
  throw new Error('CBOR length exceeds 32-bit boundary');
};

type CborScalar = number | string | Uint8Array;
type CborValue = CborScalar | CborValue[] | Map<number, CborValue>;

const encodeCbor = (value: CborValue): Uint8Array => {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('CBOR only supports integer numbers in this encoder');
    if (value >= 0) return encodeMajorTypeLength(0, value);
    return encodeMajorTypeLength(1, -1 - value);
  }

  if (typeof value === 'string') {
    const bytes = new TextEncoder().encode(value);
    return concatBytes(encodeMajorTypeLength(3, bytes.length), bytes);
  }

  if (value instanceof Uint8Array) {
    return concatBytes(encodeMajorTypeLength(2, value.length), value);
  }

  if (Array.isArray(value)) {
    const encodedItems = value.map((item) => encodeCbor(item));
    return concatBytes(encodeMajorTypeLength(4, encodedItems.length), ...encodedItems);
  }

  if (value instanceof Map) {
    const encodedEntries: Uint8Array[] = [];
    for (const [key, item] of value.entries()) {
      encodedEntries.push(encodeCbor(key), encodeCbor(item));
    }
    return concatBytes(encodeMajorTypeLength(5, value.size), ...encodedEntries);
  }

  throw new Error('Unsupported CBOR value');
};

const setBadgeText = async (text: string): Promise<void> => {
  await Promise.allSettled([
    chrome.action.setBadgeBackgroundColor({ color: '#111827' }),
    chrome.action.setBadgeText({ text }),
  ]);
};

const formatBadgeFromLovelace = (lovelace: string): string => {
  const ada = Number.parseFloat(lovelace) / 1_000_000;
  if (!Number.isFinite(ada) || ada <= 0) return '';
  if (ada >= 1000) return `${(ada / 1000).toFixed(1)}k`;
  if (ada >= 10) return `${Math.round(ada)}`;
  return ada.toFixed(1);
};

const parseAdaToLovelace = (value: string): bigint => {
  const clean = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(clean)) {
    throw new Error('Amount must be a positive ADA value with up to 6 decimals');
  }
  const [whole, fraction = ''] = clean.split('.');
  const frac = `${fraction}000000`.slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(frac);
};

const backendRequest = async <T>(
  settings: ExtensionSettings,
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const headers = new Headers(init?.headers);
  if (RUNTIME_CONFIG.apiSecret.trim()) {
    headers.set('authorization', `Bearer ${RUNTIME_CONFIG.apiSecret.trim()}`);
  }
  const response = await fetch(`${settings.backendBaseUrl}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload && 'message' in payload
        ? String((payload as Record<string, unknown>).message)
        : `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
};

const readBalanceCache = async (): Promise<BalanceCacheRecord | null> => {
  const raw = await chrome.storage.local.get(EXTENSION_STORAGE_KEYS.balanceCache);
  return (raw[EXTENSION_STORAGE_KEYS.balanceCache] as BalanceCacheRecord | undefined) ?? null;
};

const writeBalanceCache = async (address: string, snapshot: WalletBalanceSnapshot): Promise<void> => {
  const cacheRecord: BalanceCacheRecord = {
    address,
    cachedAt: Date.now(),
    snapshot,
  };
  await chrome.storage.local.set({ [EXTENSION_STORAGE_KEYS.balanceCache]: cacheRecord });
  await setBadgeText(formatBadgeFromLovelace(snapshot.adaLovelace));
};

const getLovelace = (amounts: BlockfrostAmount[]): string =>
  amounts.find((entry) => entry.unit === 'lovelace')?.quantity ?? '0';

const resolveSessionKeys = async (activeSession: VaultSession) => {
  const derived = await deriveCardanoWallet({
    mnemonic: activeSession.mnemonic,
    network: activeSession.cardanoNetwork,
    accountIndex: activeSession.cardanoAccountIndex,
    externalIndex: activeSession.cardanoExternalIndex,
    stakeIndex: activeSession.cardanoStakeIndex,
    changeIndex: 0,
  });

  if (derived.paymentAddress !== activeSession.cardanoAddress) {
    throw new Error('Derived payment address mismatch');
  }

  return derived;
};

const resolveBlockfrost = (settings: ExtensionSettings) => {
  const projectId = settings.blockfrostProjectId.trim();
  if (!projectId) {
    throw new Error('Blockfrost Project ID is required. Configure it in extension settings.');
  }
  return resolveBlockfrostConfig({
    network: settings.network,
    projectId,
    baseUrl: settings.blockfrostBaseUrl,
  });
};

const fetchBalanceViaBlockfrost = async (
  activeSession: VaultSession,
  settings: ExtensionSettings,
): Promise<WalletBalanceSnapshot> => {
  const blockfrost = resolveBlockfrost(settings);
  const balance = await fetchAddressBalance(blockfrost, activeSession.cardanoAddress);
  return {
    network: activeSession.cardanoNetwork,
    adaLovelace: getLovelace(balance.amount),
    midnightShielded: '0',
    fetchedAt: new Date().toISOString(),
  };
};

const fetchBalanceViaBackendFallback = async (activeSession: VaultSession): Promise<WalletBalanceSnapshot> => {
  const settings = await getSettings();
  const health = (await backendRequest<{ network?: WalletBalanceSnapshot['network'] }>(
    settings,
    '/api/health',
  )) as { network?: WalletBalanceSnapshot['network'] };
  return {
    network: health.network ?? activeSession.cardanoNetwork,
    adaLovelace: '0',
    midnightShielded: '0',
    fetchedAt: new Date().toISOString(),
  };
};

const fetchBalanceSnapshot = async (forceRefresh = false): Promise<WalletBalanceSnapshot> => {
  const activeSession = requireSession();

  if (!forceRefresh) {
    const cache = await readBalanceCache();
    if (cache && cache.address === activeSession.cardanoAddress && Date.now() - cache.cachedAt < BALANCE_CACHE_TTL_MS) {
      return cache.snapshot;
    }
  }

  const settings = await getSettings();
  const snapshot = settings.blockfrostProjectId.trim()
    ? await fetchBalanceViaBlockfrost(activeSession, settings)
    : await fetchBalanceViaBackendFallback(activeSession);

  await writeBalanceCache(activeSession.cardanoAddress, snapshot);
  return snapshot;
};

const updateSessionFromSettings = async (settings: ExtensionSettings): Promise<void> => {
  if (!session) return;
  const derived = await deriveCardanoWallet({
    mnemonic: session.mnemonic,
    network: settings.network,
    accountIndex: session.cardanoAccountIndex,
    externalIndex: session.cardanoExternalIndex,
    changeIndex: 0,
    stakeIndex: session.cardanoStakeIndex,
  });

  session = {
    ...session,
    cardanoAddress: derived.paymentAddress,
    cardanoChangeAddress: derived.changeAddress,
    cardanoRewardAddress: derived.rewardAddress,
    cardanoNetwork: derived.network,
    cardanoPaymentKeyHashHex: derived.paymentKeyHashHex,
    cardanoStakeKeyHashHex: derived.stakeKeyHashHex,
    autoLockAt: Date.now() + settings.autoLockMinutes * 60_000,
  };

  await chrome.storage.local.remove(EXTENSION_STORAGE_KEYS.balanceCache);
  await setBadgeText('');
};

const signDataCose = async (address: string, payloadHex: string): Promise<{ signature: string; key: string }> => {
  const activeSession = requireSession();
  const supportedAddresses = new Set([
    activeSession.cardanoAddress,
    activeSession.cardanoChangeAddress,
    activeSession.cardanoRewardAddress,
  ]);
  if (!supportedAddresses.has(address)) {
    throw new Error('Address is not controlled by the active wallet account');
  }

  const payloadBytes = hexToBytes(payloadHex);
  const derived = await resolveSessionKeys(activeSession);
  const signerPrivateKeyHex =
    address === activeSession.cardanoRewardAddress ? derived.stakePrivateKeyHex : derived.paymentPrivateKeyHex;
  const signerPublicKeyHex =
    address === activeSession.cardanoRewardAddress ? derived.stakePublicKeyHex : derived.paymentPublicKeyHex;
  const signerPrivateKey = CSL.PrivateKey.from_hex(signerPrivateKeyHex);
  const signerPublicKey = hexToBytes(signerPublicKeyHex);

  const protectedHeaders = encodeCbor(new Map<number, CborValue>([[1, -8]]));
  const sigStructure = encodeCbor(['Signature1', protectedHeaders, new Uint8Array(), payloadBytes]);
  const signatureBytes = signerPrivateKey.sign(sigStructure).to_bytes();

  const coseSign1 = encodeCbor([
    protectedHeaders,
    new Map<number, CborValue>(),
    payloadBytes,
    signatureBytes,
  ]);
  const coseKey = encodeCbor(
    new Map<number, CborValue>([
      [1, 1],
      [3, -8],
      [-1, 6],
      [-2, signerPublicKey],
    ]),
  );

  return {
    signature: bytesToHex(coseSign1),
    key: bytesToHex(coseKey),
  };
};

const buildTransactionHash = (tx: CSL.Transaction): CSL.TransactionHash => {
  const bodyBytes = tx.body().to_bytes();
  const witnessBytes = tx.witness_set().to_bytes();
  const auxiliary = tx.auxiliary_data();
  if (auxiliary) {
    return CSL.FixedTransaction.new_with_auxiliary(bodyBytes, witnessBytes, auxiliary.to_bytes(), tx.is_valid()).transaction_hash();
  }
  return CSL.FixedTransaction.new(bodyBytes, witnessBytes, tx.is_valid()).transaction_hash();
};

const summarizeTx = (txCborHex: string): TransactionSummary => {
  const tx = CSL.Transaction.from_bytes(hexToBytes(txCborHex));
  const body = tx.body();
  const outputs = body.outputs();
  if (outputs.len() === 0) {
    throw new Error('Transaction has no outputs');
  }
  const firstOutput = outputs.get(0);
  const fee = body.fee().to_str();
  const amount = firstOutput.amount().coin().to_str();
  const total = (BigInt(amount) + BigInt(fee)).toString();
  return {
    toAddress: firstOutput.address().to_bech32(),
    amountLovelace: amount,
    feeLovelace: fee,
    totalLovelace: total,
    outputCount: outputs.len(),
  };
};

const openPopupRoute = async (route: string): Promise<void> => {
  const popupUrl = chrome.runtime.getURL(`src/popup/index.html#${route}`);
  await new Promise<void>((resolve) => {
    chrome.windows.create(
      {
        url: popupUrl,
        type: 'popup',
        width: 420,
        height: 680,
      },
      () => {
        resolve();
      },
    );
  });
};

const requestOriginApproval = async (origin: string): Promise<boolean> => {
  const requestId = createRequestId();
  return await new Promise<boolean>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingApprovals.delete(requestId);
      reject(new Error('Approval request timed out'));
    }, PENDING_REQUEST_TTL_MS);

    pendingApprovals.set(requestId, {
      requestId,
      origin,
      createdAt: Date.now(),
      expiresAt: Date.now() + PENDING_REQUEST_TTL_MS,
      resolve: (allow) => {
        clearTimeout(timeoutId);
        pendingApprovals.delete(requestId);
        resolve(allow);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        pendingApprovals.delete(requestId);
        reject(error);
      },
      timeoutId,
    });

    void openPopupRoute(`/approval?requestId=${encodeURIComponent(requestId)}`);
  });
};

const requestSignatureApproval = async (
  origin: string,
  txCborHex: string,
  partialSign: boolean,
  summary: TransactionSummary,
): Promise<boolean> => {
  const requestId = createRequestId();
  return await new Promise<boolean>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingSigns.delete(requestId);
      reject(new Error('Signing request timed out'));
    }, PENDING_REQUEST_TTL_MS);

    pendingSigns.set(requestId, {
      requestId,
      origin,
      txCborHex,
      partialSign,
      summary,
      createdAt: Date.now(),
      expiresAt: Date.now() + PENDING_REQUEST_TTL_MS,
      resolve: (allow) => {
        clearTimeout(timeoutId);
        pendingSigns.delete(requestId);
        resolve(allow);
      },
      reject: (error) => {
        clearTimeout(timeoutId);
        pendingSigns.delete(requestId);
        reject(error);
      },
      timeoutId,
    });

    void openPopupRoute(`/sign?requestId=${encodeURIComponent(requestId)}`);
  });
};

const signTransactionWitnesses = async (
  txHex: string,
  partialSign: boolean,
  opts?: {
    origin?: string;
    prompt?: boolean;
  },
): Promise<string> => {
  const activeSession = requireSession();
  const txBytes = hexToBytes(txHex);
  const tx = CSL.Transaction.from_bytes(txBytes);

  const txNetwork = tx.body().network_id();
  const expectedNetworkId = networkIdMap[activeSession.cardanoNetwork] ?? networkIdMap[RUNTIME_CONFIG.network] ?? 0;
  if (txNetwork && Number(txNetwork.kind()) !== expectedNetworkId) {
    throw new Error(`Transaction network mismatch. Expected ${expectedNetworkId}, got ${Number(txNetwork.kind())}`);
  }

  if (opts?.prompt && opts.origin && !isInternalOrigin(opts.origin)) {
    const approved = await requestSignatureApproval(opts.origin, txHex, partialSign, summarizeTx(txHex));
    if (!approved) throw new Error('Transaction signing rejected by user');
  }

  const derived = await resolveSessionKeys(activeSession);
  const signerMap = new Map<string, { privateKeyHex: string }>([
    [derived.paymentKeyHashHex, { privateKeyHex: derived.paymentPrivateKeyHex }],
    [derived.stakeKeyHashHex, { privateKeyHex: derived.stakePrivateKeyHex }],
  ]);

  const requiredSigners = tx.body().required_signers();
  const requiredHashes: string[] = [];
  if (requiredSigners) {
    for (let i = 0; i < requiredSigners.len(); i += 1) {
      requiredHashes.push(bytesToHex(requiredSigners.get(i).to_bytes()));
    }
  }

  const selected = new Map<string, { privateKeyHex: string }>();
  if (requiredHashes.length > 0) {
    for (const hash of requiredHashes) {
      const signer = signerMap.get(hash);
      if (signer) selected.set(hash, signer);
    }
    if (!partialSign && selected.size !== requiredHashes.length) {
      throw new Error('Transaction requires signers not controlled by this wallet account');
    }
    if (selected.size === 0) {
      throw new Error('No matching signing key found for required signers');
    }
  } else {
    selected.set(derived.paymentKeyHashHex, {
      privateKeyHex: derived.paymentPrivateKeyHex,
    });
  }

  const txHash = buildTransactionHash(tx);
  const witnessCollection = CSL.Vkeywitnesses.new();
  for (const signer of selected.values()) {
    const privateKey = CSL.PrivateKey.from_hex(signer.privateKeyHex);
    const witness = CSL.make_vkey_witness(txHash, privateKey);
    witnessCollection.add(witness);
  }

  const out = CSL.TransactionWitnessSet.new();
  out.set_vkeys(witnessCollection);
  return bytesToHex(out.to_bytes());
};

const mergeWitnessSet = (txCborHex: string, witnessSetHex: string): string => {
  const tx = CSL.Transaction.from_bytes(hexToBytes(txCborHex));
  const added = CSL.TransactionWitnessSet.from_bytes(hexToBytes(witnessSetHex));
  const merged = tx.witness_set();

  const addedVkeys = added.vkeys();
  if (addedVkeys) {
    const existing = merged.vkeys() ?? CSL.Vkeywitnesses.new();
    const seen = new Set<string>();
    for (let i = 0; i < existing.len(); i += 1) {
      seen.add(bytesToHex(existing.get(i).vkey().public_key().as_bytes()));
    }
    for (let i = 0; i < addedVkeys.len(); i += 1) {
      const witness = addedVkeys.get(i);
      const keyHex = bytesToHex(witness.vkey().public_key().as_bytes());
      if (!seen.has(keyHex)) {
        existing.add(witness);
        seen.add(keyHex);
      }
    }
    merged.set_vkeys(existing);
  }

  const auxiliary = tx.auxiliary_data();
  const signed = auxiliary ? CSL.Transaction.new(tx.body(), merged, auxiliary) : CSL.Transaction.new(tx.body(), merged);
  return bytesToHex(signed.to_bytes());
};

const toCborUtxoHex = (utxo: BlockfrostUtxo, fallbackAddress: string): string => {
  const input = CSL.TransactionInput.new(
    CSL.TransactionHash.from_hex(utxo.tx_hash),
    Number.isFinite(utxo.output_index) ? utxo.output_index : utxo.tx_index,
  );
  const address = CSL.Address.from_bech32(utxo.address ?? fallbackAddress);
  const lovelace = getLovelace(utxo.amount);
  const value = CSL.Value.new(CSL.BigNum.from_str(lovelace));
  const output = CSL.TransactionOutput.new(address, value);
  const out = CSL.TransactionUnspentOutput.new(input, output);
  return bytesToHex(out.to_bytes());
};

const submitTransactionRelay = async (txCborHex: string): Promise<string> => {
  const settings = await getSettings();
  if (settings.blockfrostProjectId.trim()) {
    const blockfrost = resolveBlockfrost(settings);
    const txHash = await submitTransaction(blockfrost, txCborHex);
    return txHash.toLowerCase();
  }
  const submitted = await backendRequest<{ txHash: string }>(settings, '/api/v1/cardano/submit-tx', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ txCborHex }),
  });
  if (!submitted.txHash || typeof submitted.txHash !== 'string') {
    throw new Error('Cardano relay response did not include txHash');
  }
  return submitted.txHash.toLowerCase();
};

const vaultStatus = async (): Promise<VaultStatus> => {
  ensureSessionFresh();
  const exists = await vaultExists();
  const hints = await readVaultHints();
  const settings = await getSettings();
  return {
    exists,
    unlocked: Boolean(session),
    autoLockAt: session?.autoLockAt ?? null,
    publicAddress: session?.cardanoAddress ?? hints?.cardanoAddress ?? null,
    changeAddress: session?.cardanoChangeAddress ?? null,
    rewardAddress: session?.cardanoRewardAddress ?? null,
    network: session?.cardanoNetwork ?? settings.network,
  };
};

const ensureApprovedOrigin = async (origin: string): Promise<void> => {
  if (isInternalOrigin(origin)) return;
  const approvals = await getApprovals();
  if (approvals[origin]) return;

  const allowed = await requestOriginApproval(origin);
  if (!allowed) {
    throw new Error('Connection request rejected');
  }
  await grantApproval(origin);
};

const handleCip30Request = async (
  origin: string,
  method: string,
  params: unknown[] | undefined,
): Promise<unknown> => {
  if (method === 'enable') {
    await ensureApprovedOrigin(origin);
    return { enabled: true, origin };
  }

  if (!isInternalOrigin(origin)) {
    const approvals = await getApprovals();
    if (!approvals[origin]) {
      throw new Error('Origin is not approved for DarkWallet access');
    }
  }

  if (method === 'getNetworkId') return networkIdMap[requireSession().cardanoNetwork] ?? 0;
  if (method === 'getUsedAddresses') return [requireSession().cardanoAddress];
  if (method === 'getUnusedAddresses') return [requireSession().cardanoChangeAddress];
  if (method === 'getChangeAddress') return requireSession().cardanoChangeAddress;
  if (method === 'getRewardAddresses') return [requireSession().cardanoRewardAddress];

  if (method === 'getUtxos') {
    const activeSession = requireSession();
    const settings = await getSettings();
    if (!settings.blockfrostProjectId.trim()) return [];
    const blockfrost = resolveBlockfrost(settings);
    const utxos = await fetchUtxos(blockfrost, activeSession.cardanoAddress, 1, 100);
    return utxos.map((utxo) => toCborUtxoHex(utxo, activeSession.cardanoAddress));
  }

  if (method === 'getBalance') {
    const snapshot = await fetchBalanceSnapshot();
    const value = CSL.Value.new(CSL.BigNum.from_str(snapshot.adaLovelace));
    return bytesToHex(value.to_bytes());
  }

  if (method === 'signData') {
    const address = String(params?.[0] ?? '');
    const payload = String(params?.[1] ?? '');
    return await signDataCose(address, payload);
  }

  if (method === 'signTx') {
    const txCborHex = String(params?.[0] ?? '');
    const partialSign = Boolean(params?.[1] ?? false);
    const settings = await getSettings();
    const shouldPrompt = settings.signaturePromptEnabled && !isInternalOrigin(origin);
    return await signTransactionWitnesses(txCborHex, partialSign, {
      origin,
      prompt: shouldPrompt,
    });
  }

  if (method === 'submitTx') {
    const txCborHex = strip0x(String(params?.[0] ?? ''));
    CSL.Transaction.from_bytes(hexToBytes(txCborHex));
    return await submitTransactionRelay(txCborHex);
  }

  throw new Error(`Unsupported CIP-30 method: ${method}`);
};

const getPendingApproval = (requestId?: string): PendingApprovalRequest | null => {
  if (requestId) {
    const found = pendingApprovals.get(requestId);
    if (!found) return null;
    return {
      requestId: found.requestId,
      origin: found.origin,
      createdAt: found.createdAt,
      expiresAt: found.expiresAt,
    };
  }
  const first = pendingApprovals.values().next().value as PendingApprovalState | undefined;
  if (!first) return null;
  return {
    requestId: first.requestId,
    origin: first.origin,
    createdAt: first.createdAt,
    expiresAt: first.expiresAt,
  };
};

const getPendingSign = (requestId?: string): PendingSignRequest | null => {
  if (requestId) {
    const found = pendingSigns.get(requestId);
    if (!found) return null;
    return {
      requestId: found.requestId,
      origin: found.origin,
      txCborHex: found.txCborHex,
      partialSign: found.partialSign,
      summary: found.summary,
      createdAt: found.createdAt,
      expiresAt: found.expiresAt,
    };
  }
  const first = pendingSigns.values().next().value as PendingSignState | undefined;
  if (!first) return null;
  return {
    requestId: first.requestId,
    origin: first.origin,
    txCborHex: first.txCborHex,
    partialSign: first.partialSign,
    summary: first.summary,
    createdAt: first.createdAt,
    expiresAt: first.expiresAt,
  };
};

const handleMessage = async (message: RuntimeMessage): Promise<RuntimeResponse> => {
  const requestId = createRequestId();
  try {
    if (message.kind === 'VAULT_CREATE') {
      const settings = await getSettings();
      const { mnemonic, record } = await createVault(message.password, message.mnemonic);
      session = await unlockVault(message.password, { autoLockMinutes: settings.autoLockMinutes });
      await fetchBalanceSnapshot(true);
      return makeOk(requestId, {
        createdAt: record.createdAt,
        cardanoAddress: session.cardanoAddress,
        midnightAddress: session.midnightAddress,
        mnemonic,
      });
    }

    if (message.kind === 'VAULT_UNLOCK') {
      const settings = await getSettings();
      session = await unlockVault(message.password, { autoLockMinutes: settings.autoLockMinutes });
      await fetchBalanceSnapshot(true);
      return makeOk(requestId, {
        unlocked: true,
        cardanoAddress: session.cardanoAddress,
        midnightAddress: session.midnightAddress,
        autoLockAt: session.autoLockAt,
      });
    }

    if (message.kind === 'VAULT_LOCK') {
      session = null;
      await setBadgeText('');
      return makeOk(requestId, { unlocked: false });
    }

    if (message.kind === 'VAULT_EXPORT_MNEMONIC') {
      const exported = await unlockVault(message.password, { autoLockMinutes: 1 });
      return makeOk(requestId, { mnemonic: exported.mnemonic });
    }

    if (message.kind === 'VAULT_RESET') {
      session = null;
      for (const pending of pendingApprovals.values()) {
        clearTimeout(pending.timeoutId);
        pending.reject(new Error('Approval request cancelled: vault reset'));
      }
      pendingApprovals.clear();
      for (const pending of pendingSigns.values()) {
        clearTimeout(pending.timeoutId);
        pending.reject(new Error('Signing request cancelled: vault reset'));
      }
      pendingSigns.clear();
      await Promise.all([
        resetVault(),
        clearApprovals(),
        resetSettings(),
        chrome.storage.local.remove(EXTENSION_STORAGE_KEYS.balanceCache),
      ]);
      await setBadgeText('');
      return makeOk(requestId, { reset: true });
    }

    if (message.kind === 'VAULT_STATUS') {
      return makeOk(requestId, await vaultStatus());
    }

    if (message.kind === 'BALANCE_FETCH') {
      return makeOk(requestId, await fetchBalanceSnapshot());
    }

    if (message.kind === 'APPROVAL_LIST') {
      return makeOk(requestId, await getApprovals());
    }

    if (message.kind === 'APPROVAL_GRANT') {
      await grantApproval(message.origin);
      return makeOk(requestId, { origin: message.origin, granted: true });
    }

    if (message.kind === 'APPROVAL_REVOKE') {
      await revokeApproval(message.origin);
      return makeOk(requestId, { origin: message.origin, revoked: true });
    }

    if (message.kind === 'APPROVAL_PENDING_GET') {
      return makeOk(requestId, getPendingApproval(message.requestId));
    }

    if (message.kind === 'APPROVAL_PENDING_RESOLVE') {
      const pending = pendingApprovals.get(message.requestId);
      if (!pending) {
        throw new Error(`Pending approval request not found: ${message.requestId}`);
      }
      if (message.allow) {
        await grantApproval(pending.origin);
      }
      pending.resolve(message.allow);
      return makeOk(requestId, { requestId: message.requestId, allow: message.allow });
    }

    if (message.kind === 'SIGN_PENDING_GET') {
      return makeOk(requestId, getPendingSign(message.requestId));
    }

    if (message.kind === 'SIGN_PENDING_RESOLVE') {
      const pending = pendingSigns.get(message.requestId);
      if (!pending) {
        throw new Error(`Pending sign request not found: ${message.requestId}`);
      }
      pending.resolve(message.allow);
      return makeOk(requestId, { requestId: message.requestId, allow: message.allow });
    }

    if (message.kind === 'SETTINGS_GET') {
      return makeOk(requestId, await getSettings());
    }

    if (message.kind === 'SETTINGS_UPDATE') {
      const next = await updateSettings(message.patch);
      await updateSessionFromSettings(next);
      return makeOk(requestId, next);
    }

    if (message.kind === 'SETTINGS_RESET') {
      const next = await resetSettings();
      await updateSessionFromSettings(next);
      return makeOk(requestId, next);
    }

    if (message.kind === 'TX_BUILD') {
      const activeSession = requireSession();
      const settings = await getSettings();
      const blockfrost = resolveBlockfrost(settings);

      const amountLovelace = parseAdaToLovelace(message.amountAda);
      if (amountLovelace <= 0n) throw new Error('Amount must be greater than zero');

      const utxos: BlockfrostUtxo[] = [];
      for (let page = 1; page <= 3; page += 1) {
        const chunk = await fetchUtxos(blockfrost, activeSession.cardanoAddress, page, 100);
        utxos.push(...chunk);
        if (chunk.length < 100) break;
      }
      if (!utxos.length) {
        throw new Error('No UTxOs available for this wallet address');
      }

      const protocolParameters = await fetchProtocolParameters(blockfrost);
      const built: TxBuildResult = buildSimpleTransfer({
        network: activeSession.cardanoNetwork,
        utxos,
        recipientAddress: message.toAddress,
        amountLovelace,
        changeAddress: activeSession.cardanoChangeAddress,
        protocolParameters,
      });

      return makeOk(requestId, built);
    }

    if (message.kind === 'TX_SIGN_AND_SUBMIT') {
      const witnessSetHex = await signTransactionWitnesses(message.txCborHex, Boolean(message.partialSign), {
        origin: 'chrome-extension://darkwallet-popup',
        prompt: false,
      });
      const signedTxHex = mergeWitnessSet(message.txCborHex, witnessSetHex);
      const txHash = await submitTransactionRelay(signedTxHex);
      const payload: TxSignSubmitResult = { txHash, witnessSetHex };
      return makeOk(requestId, payload);
    }

    if (message.kind === 'CIP30_REQUEST') {
      const data = await handleCip30Request(message.origin, message.method, message.params);
      return makeOk(requestId, data);
    }

    return makeErr(requestId, 'UNSUPPORTED_MESSAGE', `Unsupported message kind: ${(message as RuntimeMessage).kind}`);
  } catch (error) {
    return makeErr(
      requestId,
      'RUNTIME_ERROR',
      error instanceof Error ? error.message : 'Unknown runtime error',
    );
  }
};

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  void handleMessage(message).then(sendResponse);
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(BALANCE_REFRESH_ALARM, { periodInMinutes: 1 });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(BALANCE_REFRESH_ALARM, { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== BALANCE_REFRESH_ALARM) return;
  if (!session) return;
  void fetchBalanceSnapshot(true).catch(() => {
    // Ignore background refresh failures; popup and pages show explicit errors.
  });
});
