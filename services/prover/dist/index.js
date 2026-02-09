import path from 'node:path';
import { loadConfig } from './config.js';
import { StateStore } from './state/store.js';
import { buildServer } from './server.js';
import { JobStore } from './jobs.js';
import { buildWalletFromSeed, createWalletAndMidnightProvider, waitForFunds, waitForSync } from './midnight/wallet.js';
import { configureProviders } from './midnight/providers.js';
import { PickupService } from './midnight/pickup.js';
const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
const repoRoot = path.resolve(currentDir, '..', '..', '..');
const GENESIS_MINT_WALLET_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const config = loadConfig(repoRoot);
const walletConfig = {
    indexerHttpUrl: config.indexerHttpUrl,
    indexerWsUrl: config.indexerWsUrl,
    nodeHttpUrl: config.nodeHttpUrl,
    proofServerHttpUrl: config.proofServerHttpUrl,
};
const walletSeed = config.walletSeedHex ?? (config.network === 'standalone' ? GENESIS_MINT_WALLET_SEED : undefined);
if (!walletSeed) {
    throw new Error('MIDNIGHT_WALLET_SEED is required for preview/preprod networks');
}
const ctx = await buildWalletFromSeed(walletConfig, walletSeed);
await waitForSync(ctx.wallet);
await waitForFunds(ctx.wallet);
const walletAndMidnightProvider = await createWalletAndMidnightProvider(ctx);
const providers = configureProviders({
    zkConfigPath: config.zkConfigPath,
    privateStateStoreName: 'midlight-private-state',
    indexerHttpUrl: config.indexerHttpUrl,
    indexerWsUrl: config.indexerWsUrl,
    proofServerHttpUrl: config.proofServerHttpUrl,
    walletAndMidnightProvider,
});
const store = new StateStore(config.statePath);
const pickup = new PickupService({
    providers,
    store,
    zkConfigPath: config.zkConfigPath,
    privateStateStoreName: 'midlight-private-state',
});
const jobs = new JobStore();
const app = await buildServer({ config, pickup, jobs });
await app.listen({ port: config.port, host: '127.0.0.1' });
//# sourceMappingURL=index.js.map