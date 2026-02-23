import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import * as CSL from '@emurgo/cardano-serialization-lib-asmjs';

import type { RuntimeMessage, RuntimeResponse, VaultStatus } from '../apps/extension/src/shared/types/runtime';

const extensionPath = path.resolve(process.cwd(), 'apps/extension/dist');
const dappOrigin = 'http://127.0.0.1:4173';
const defaultPassword = 'DarkWallet!123';

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const buildUnsignedTxHex = (addressBech32: string): string => {
  const inputs = CSL.TransactionInputs.new();
  const outputs = CSL.TransactionOutputs.new();
  const address = CSL.Address.from_bech32(addressBech32);
  const amount = CSL.Value.new(CSL.BigNum.from_str('1'));
  outputs.add(CSL.TransactionOutput.new(address, amount));
  const body = CSL.TransactionBody.new_tx_body(inputs, outputs, CSL.BigNum.from_str('1'));
  body.set_network_id(CSL.NetworkId.testnet());
  const tx = CSL.Transaction.new(body, CSL.TransactionWitnessSet.new());
  return bytesToHex(tx.to_bytes());
};

const launchExtension = async (): Promise<{
  context: BrowserContext;
  extensionId: string;
  userDataDir: string;
}> => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'darkwallet-extension-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker', { timeout: 20_000 });
  }
  const extensionId = serviceWorker.url().split('/')[2];
  if (!extensionId) throw new Error('Failed to resolve extension id from service worker URL');
  return { context, extensionId, userDataDir };
};

const runtimeMessage = async <T>(
  context: BrowserContext,
  extensionId: string,
  message: RuntimeMessage,
): Promise<T> => {
  const page = await openPopup(context, extensionId, '/');
  const response = await page.evaluate(async (runtimeMessageInput) => {
    return await new Promise<RuntimeResponse<T>>((resolve, reject) => {
      chrome.runtime.sendMessage(runtimeMessageInput, (payload) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(payload as RuntimeResponse<T>);
      });
    });
  }, message);
  await page.close();

  if (!response.ok) {
    throw new Error(response.error.message);
  }
  return response.data;
};

const openPopup = async (context: BrowserContext, extensionId: string, routeHash = '/'): Promise<Page> => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/src/popup/index.html#${routeHash}`);
  return page;
};

const createWalletViaPopup = async (context: BrowserContext, extensionId: string): Promise<void> => {
  const popup = await openPopup(context, extensionId, '/create');
  await popup.getByLabel('Password', { exact: true }).fill(defaultPassword);
  await popup.getByLabel('Confirm password', { exact: true }).fill(defaultPassword);
  await popup.getByRole('button', { name: 'Continue' }).click();

  await expect(popup.locator('.dw-mnemonic-chip')).toHaveCount(24);
  const words = await popup.locator('.dw-mnemonic-chip strong').allTextContents();

  await popup.locator('input[type="checkbox"]').check();
  await popup.getByRole('button', { name: 'Continue to verification' }).click();

  const fields = popup.locator('.dw-field');
  const count = await fields.count();
  for (let i = 0; i < count; i += 1) {
    const field = fields.nth(i);
    const label = (await field.locator('.dw-label').innerText()).trim();
    const match = label.match(/Word #(\d+)/i);
    if (!match) continue;
    const index = Number.parseInt(match[1], 10) - 1;
    await field.locator('input').fill(words[index]);
  }

  await popup.getByRole('button', { name: 'Create Wallet' }).click();
  await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
  await popup.close();
};

test.beforeAll(async () => {
  await fs.access(path.resolve(extensionPath, 'manifest.json'));
});

test('popup onboarding can create wallet with seed verification', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    await createWalletViaPopup(context, extensionId);

    const status = await runtimeMessage<VaultStatus>(context, extensionId, { kind: 'VAULT_STATUS' });
    expect(status.exists).toBe(true);
    expect(status.unlocked).toBe(true);
    expect(status.publicAddress?.startsWith('addr_test')).toBe(true);
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('import flow restores wallet from exported mnemonic', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    const created = await runtimeMessage<{ mnemonic: string }>(context, extensionId, {
      kind: 'VAULT_CREATE',
      password: defaultPassword,
    });
    expect(created.mnemonic.split(/\s+/)).toHaveLength(24);

    await runtimeMessage(context, extensionId, { kind: 'VAULT_RESET' });

    const popup = await openPopup(context, extensionId, '/import');
    await popup.getByLabel('Recovery phrase').fill(created.mnemonic);
    await popup.getByLabel('Password', { exact: true }).fill(defaultPassword);
    await popup.getByLabel('Confirm password', { exact: true }).fill(defaultPassword);
    await popup.getByRole('button', { name: 'Import Wallet' }).click();
    await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
    await popup.close();
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('unapproved dApp enable opens approval request and reject blocks access', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    await runtimeMessage(context, extensionId, { kind: 'VAULT_CREATE', password: defaultPassword });

    const dappPage = await context.newPage();
    await dappPage.goto(`${dappOrigin}/`);
    await dappPage.waitForFunction(() => Boolean((window as { cardano?: { darkwallet?: unknown } }).cardano?.darkwallet));

    const requestResult = dappPage.evaluate(async () => {
      try {
        const wallet = (window as { cardano?: { darkwallet?: { enable: () => Promise<unknown> } } }).cardano?.darkwallet;
        if (!wallet) throw new Error('Wallet provider missing');
        await wallet.enable();
        return { ok: true, message: 'unexpected success' };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const approvalPopup = await context.waitForEvent('page', {
      predicate: (page) => page.url().includes('/src/popup/index.html#/approval'),
      timeout: 15_000,
    });
    await approvalPopup.waitForLoadState('domcontentloaded');
    await approvalPopup.getByRole('button', { name: 'Reject' }).click();

    const result = await requestResult;
    expect(result.ok).toBe(false);
    expect(result.message.toLowerCase()).toContain('rejected');

    await approvalPopup.close();
    await dappPage.close();
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('approved dApp can enable, signData, signTx witness, and submitTx', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    await runtimeMessage(context, extensionId, { kind: 'VAULT_CREATE', password: defaultPassword });
    await runtimeMessage(context, extensionId, { kind: 'APPROVAL_GRANT', origin: dappOrigin });
    await runtimeMessage(context, extensionId, {
      kind: 'SETTINGS_UPDATE',
      patch: {
        signaturePromptEnabled: false,
      },
    });

    const page = await context.newPage();
    await page.goto(`${dappOrigin}/`);
    await page.waitForFunction(() => Boolean((window as { cardano?: { darkwallet?: unknown } }).cardano?.darkwallet));

    const result = await page.evaluate(async () => {
      const wallet = (window as { cardano?: { darkwallet?: { enable: () => Promise<any> } } }).cardano?.darkwallet;
      if (!wallet) throw new Error('Wallet provider missing');
      const api = await wallet.enable();
      const used = await api.getUsedAddresses();
      const signData = await api.signData(used[0], 'deadbeef');
      return { usedAddress: used[0], signData };
    });

    const txHex = buildUnsignedTxHex(result.usedAddress);
    const txResult = await page.evaluate(
      async ({ unsignedTxHex }) => {
        const wallet = (window as { cardano?: { darkwallet?: { enable: () => Promise<any> } } }).cardano?.darkwallet;
        if (!wallet) throw new Error('Wallet provider missing');
        const api = await wallet.enable();
        const witnessSetHex = await api.signTx(unsignedTxHex, true);
        const txHash = await api.submitTx(unsignedTxHex);
        return { witnessSetHex, txHash };
      },
      { unsignedTxHex: txHex },
    );

    expect(result.usedAddress.startsWith('addr_test')).toBe(true);
    expect(result.signData.signature).toMatch(/^[0-9a-f]+$/i);
    expect(result.signData.key).toMatch(/^[0-9a-f]+$/i);
    expect(txResult.witnessSetHex).toMatch(/^[0-9a-f]+$/i);
    expect(txResult.witnessSetHex.length).toBeGreaterThan(16);
    expect(txResult.txHash).toMatch(/^[0-9a-f]{64}$/i);

    await page.close();
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('submitTx rejects malformed transaction hex', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    await runtimeMessage(context, extensionId, { kind: 'VAULT_CREATE', password: defaultPassword });
    await runtimeMessage(context, extensionId, { kind: 'APPROVAL_GRANT', origin: dappOrigin });

    const page = await context.newPage();
    await page.goto(`${dappOrigin}/`);
    await page.waitForFunction(() => Boolean((window as { cardano?: { darkwallet?: unknown } }).cardano?.darkwallet));

    const response = await page.evaluate(async () => {
      try {
        const wallet = (window as { cardano?: { darkwallet?: { enable: () => Promise<any> } } }).cardano?.darkwallet;
        if (!wallet) throw new Error('Wallet provider missing');
        const api = await wallet.enable();
        await api.submitTx('zz');
        return { ok: true, message: 'unexpected success' };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    });

    expect(response.ok).toBe(false);
    expect(response.message.toLowerCase()).toContain('hex');

    await page.close();
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('popup send flow can build, sign, and submit transaction', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    await runtimeMessage(context, extensionId, { kind: 'VAULT_CREATE', password: defaultPassword });
    await runtimeMessage(context, extensionId, {
      kind: 'SETTINGS_UPDATE',
      patch: {
        blockfrostProjectId: 'test-project-id',
        blockfrostBaseUrl: 'http://127.0.0.1:4000',
        signaturePromptEnabled: false,
      },
    });

    const status = await runtimeMessage<VaultStatus>(context, extensionId, { kind: 'VAULT_STATUS' });
    if (!status.publicAddress) throw new Error('Missing wallet address');

    const popup = await openPopup(context, extensionId, '/send');
    await popup.getByPlaceholder('addr1...').fill(status.publicAddress);
    await popup.getByPlaceholder('0.500000').fill('1.25');
    await popup.getByRole('button', { name: 'Prepare Transfer' }).click();

    await expect(popup.getByText('Total')).toBeVisible();
    await runtimeMessage(context, extensionId, {
      kind: 'SETTINGS_UPDATE',
      patch: {
        blockfrostProjectId: '',
      },
    });
    await popup.getByRole('button', { name: 'Sign & Broadcast' }).click();
    await expect(popup.getByText('Submitted Tx Hash')).toBeVisible({ timeout: 20_000 });

    await popup.close();
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('settings can revoke approved dApp origins', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    await runtimeMessage(context, extensionId, { kind: 'VAULT_CREATE', password: defaultPassword });
    await runtimeMessage(context, extensionId, { kind: 'APPROVAL_GRANT', origin: dappOrigin });

    const popup = await openPopup(context, extensionId, '/settings');
    await expect(popup.locator('.dw-code', { hasText: dappOrigin })).toBeVisible();
    await popup.getByRole('button', { name: 'Revoke' }).first().click();
    await expect(popup.locator('.dw-code', { hasText: dappOrigin })).toHaveCount(0);
    await popup.close();
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});

test('wallet lock and unlock lifecycle works from popup', async () => {
  const { context, extensionId, userDataDir } = await launchExtension();
  try {
    await runtimeMessage(context, extensionId, { kind: 'VAULT_CREATE', password: defaultPassword });

    const popup = await openPopup(context, extensionId, '/balance');
    await popup.getByRole('button', { name: 'Lock' }).click();
    await expect(popup.getByRole('heading', { name: 'Unlock Vault' })).toBeVisible();

    await popup.getByPlaceholder('Enter wallet password').fill(defaultPassword);
    await popup.getByRole('button', { name: 'Unlock Wallet' }).click();
    await expect(popup.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
    await popup.close();
  } finally {
    await context.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
  }
});
