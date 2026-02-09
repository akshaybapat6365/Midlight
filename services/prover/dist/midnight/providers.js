import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
const DEFAULT_HTTP_TIMEOUT_MS = 60 * 60 * 1000;
const httpTimeoutMs = (() => {
    const raw = process.env.MIDLIGHT_HTTP_TIMEOUT_MS;
    if (!raw)
        return DEFAULT_HTTP_TIMEOUT_MS;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HTTP_TIMEOUT_MS;
})();
export const configureProviders = (params) => {
    const zkConfigProvider = new NodeZkConfigProvider(params.zkConfigPath);
    const walletProvider = params.walletAndMidnightProvider;
    return {
        privateStateProvider: levelPrivateStateProvider({
            privateStateStoreName: params.privateStateStoreName,
            walletProvider,
        }),
        publicDataProvider: indexerPublicDataProvider(params.indexerHttpUrl, params.indexerWsUrl),
        zkConfigProvider,
        proofProvider: httpClientProofProvider(params.proofServerHttpUrl, zkConfigProvider, { timeout: httpTimeoutMs }),
        walletProvider,
        midnightProvider: walletProvider,
    };
};
//# sourceMappingURL=providers.js.map