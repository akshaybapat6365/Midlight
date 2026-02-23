import { EXTENSION_STORAGE_KEYS, RUNTIME_CONFIG } from '../config';
import type { CardanoNetwork } from '../crypto/hd-wallet';

export type ApprovalMap = Record<string, { grantedAt: string }>;

export type ExtensionTheme = 'system' | 'dark' | 'light';

export type ExtensionSettings = {
  network: CardanoNetwork;
  autoLockMinutes: number;
  theme: ExtensionTheme;
  backendBaseUrl: string;
  blockfrostProjectId: string;
  blockfrostBaseUrl?: string;
  signaturePromptEnabled: boolean;
};

const defaultSettings: ExtensionSettings = {
  network: RUNTIME_CONFIG.network,
  autoLockMinutes: Number.isFinite(RUNTIME_CONFIG.autoLockMinutes) ? RUNTIME_CONFIG.autoLockMinutes : 10,
  theme: 'system',
  backendBaseUrl: RUNTIME_CONFIG.backendBaseUrl,
  blockfrostProjectId: RUNTIME_CONFIG.blockfrostProjectId.trim(),
  blockfrostBaseUrl: RUNTIME_CONFIG.blockfrostBaseUrl.trim() || undefined,
  signaturePromptEnabled: true,
};

const clampAutoLock = (value: number): number => {
  if (!Number.isFinite(value)) return defaultSettings.autoLockMinutes;
  return Math.min(240, Math.max(5, Math.round(value)));
};

const normalizeSettings = (raw: Partial<ExtensionSettings> | null | undefined): ExtensionSettings => ({
  network: raw?.network ?? defaultSettings.network,
  autoLockMinutes: clampAutoLock(raw?.autoLockMinutes ?? defaultSettings.autoLockMinutes),
  theme: raw?.theme ?? defaultSettings.theme,
  backendBaseUrl: raw?.backendBaseUrl?.trim() || defaultSettings.backendBaseUrl,
  blockfrostProjectId: raw?.blockfrostProjectId?.trim() ?? '',
  blockfrostBaseUrl: raw?.blockfrostBaseUrl?.trim() || undefined,
  signaturePromptEnabled:
    raw?.signaturePromptEnabled == null ? defaultSettings.signaturePromptEnabled : Boolean(raw.signaturePromptEnabled),
});

export const getApprovals = async (): Promise<ApprovalMap> => {
  const raw = await chrome.storage.local.get(EXTENSION_STORAGE_KEYS.approvals);
  return (raw[EXTENSION_STORAGE_KEYS.approvals] as ApprovalMap | undefined) ?? {};
};

export const grantApproval = async (origin: string): Promise<void> => {
  const approvals = await getApprovals();
  approvals[origin] = { grantedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [EXTENSION_STORAGE_KEYS.approvals]: approvals });
};

export const revokeApproval = async (origin: string): Promise<void> => {
  const approvals = await getApprovals();
  delete approvals[origin];
  await chrome.storage.local.set({ [EXTENSION_STORAGE_KEYS.approvals]: approvals });
};

export const clearApprovals = async (): Promise<void> => {
  await chrome.storage.local.set({ [EXTENSION_STORAGE_KEYS.approvals]: {} });
};

export const getSettings = async (): Promise<ExtensionSettings> => {
  const raw = await chrome.storage.local.get(EXTENSION_STORAGE_KEYS.settings);
  return normalizeSettings(raw[EXTENSION_STORAGE_KEYS.settings] as Partial<ExtensionSettings> | undefined);
};

export const updateSettings = async (patch: Partial<ExtensionSettings>): Promise<ExtensionSettings> => {
  const current = await getSettings();
  const next = normalizeSettings({ ...current, ...patch });
  await chrome.storage.local.set({ [EXTENSION_STORAGE_KEYS.settings]: next });
  return next;
};

export const resetSettings = async (): Promise<ExtensionSettings> => {
  await chrome.storage.local.set({ [EXTENSION_STORAGE_KEYS.settings]: defaultSettings });
  return defaultSettings;
};
