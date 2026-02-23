import type { CardanoNetwork } from '@ext/shared/crypto/hd-wallet';
import type { ApprovalMap, ExtensionSettings } from '@ext/shared/storage/preferences';

export type RuntimeMessageKind =
  | 'VAULT_CREATE'
  | 'VAULT_UNLOCK'
  | 'VAULT_LOCK'
  | 'VAULT_EXPORT_MNEMONIC'
  | 'VAULT_RESET'
  | 'VAULT_STATUS'
  | 'BALANCE_FETCH'
  | 'APPROVAL_LIST'
  | 'APPROVAL_GRANT'
  | 'APPROVAL_REVOKE'
  | 'APPROVAL_PENDING_GET'
  | 'APPROVAL_PENDING_RESOLVE'
  | 'SIGN_PENDING_GET'
  | 'SIGN_PENDING_RESOLVE'
  | 'SETTINGS_GET'
  | 'SETTINGS_UPDATE'
  | 'SETTINGS_RESET'
  | 'TX_BUILD'
  | 'TX_SIGN_AND_SUBMIT'
  | 'CIP30_REQUEST';

export type RuntimeMessage =
  | { kind: 'VAULT_CREATE'; password: string; mnemonic?: string }
  | { kind: 'VAULT_UNLOCK'; password: string }
  | { kind: 'VAULT_LOCK' }
  | { kind: 'VAULT_EXPORT_MNEMONIC'; password: string }
  | { kind: 'VAULT_RESET' }
  | { kind: 'VAULT_STATUS' }
  | { kind: 'BALANCE_FETCH' }
  | { kind: 'APPROVAL_LIST' }
  | { kind: 'APPROVAL_GRANT'; origin: string }
  | { kind: 'APPROVAL_REVOKE'; origin: string }
  | { kind: 'APPROVAL_PENDING_GET'; requestId?: string }
  | { kind: 'APPROVAL_PENDING_RESOLVE'; requestId: string; allow: boolean }
  | { kind: 'SIGN_PENDING_GET'; requestId?: string }
  | { kind: 'SIGN_PENDING_RESOLVE'; requestId: string; allow: boolean }
  | { kind: 'SETTINGS_GET' }
  | { kind: 'SETTINGS_UPDATE'; patch: Partial<ExtensionSettings> }
  | { kind: 'SETTINGS_RESET' }
  | { kind: 'TX_BUILD'; toAddress: string; amountAda: string }
  | { kind: 'TX_SIGN_AND_SUBMIT'; txCborHex: string; partialSign?: boolean }
  | {
      kind: 'CIP30_REQUEST';
      origin: string;
      method: string;
      params?: unknown[];
    };

export type RuntimeError = {
  code: string;
  message: string;
};

export type RuntimeResponse<T = unknown> =
  | {
      ok: true;
      data: T;
      requestId: string;
    }
  | {
      ok: false;
      error: RuntimeError;
      requestId: string;
    };

export type VaultStatus = {
  exists: boolean;
  unlocked: boolean;
  autoLockAt: number | null;
  publicAddress: string | null;
  changeAddress: string | null;
  rewardAddress: string | null;
  network: CardanoNetwork;
};

export type WalletBalanceSnapshot = {
  network: 'standalone' | 'preview' | 'preprod' | 'mainnet';
  adaLovelace: string;
  midnightShielded: string;
  fetchedAt: string;
};

export type PendingApprovalRequest = {
  requestId: string;
  origin: string;
  createdAt: number;
  expiresAt: number;
};

export type TransactionSummary = {
  toAddress: string;
  amountLovelace: string;
  feeLovelace: string;
  totalLovelace: string;
  outputCount: number;
};

export type PendingSignRequest = {
  requestId: string;
  origin: string;
  txCborHex: string;
  partialSign: boolean;
  summary: TransactionSummary;
  createdAt: number;
  expiresAt: number;
};

export type TxBuildResult = {
  txCborHex: string;
  summary: TransactionSummary;
};

export type TxSignSubmitResult = {
  txHash: string;
  witnessSetHex: string;
};

export type ApprovalsResponse = ApprovalMap;
