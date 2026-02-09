import path from 'node:path';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
const requireUrl = (value, name) => {
    if (!value)
        throw new Error(`Missing required env var: ${name}`);
    return value;
};
const parseNetwork = (raw) => {
    const v = (raw ?? 'standalone').toLowerCase();
    if (v === 'standalone' || v === 'preview' || v === 'preprod')
        return v;
    throw new Error(`Invalid MIDNIGHT_NETWORK: ${raw}`);
};
export const loadConfig = (repoRoot) => {
    const network = parseNetwork(process.env.MIDNIGHT_NETWORK);
    // Align with midnight-js expectations.
    setNetworkId(network === 'standalone' ? 'undeployed' : network);
    const defaults = (() => {
        if (network === 'standalone') {
            return {
                indexerHttpUrl: 'http://127.0.0.1:8088/api/v3/graphql',
                indexerWsUrl: 'ws://127.0.0.1:8088/api/v3/graphql/ws',
                nodeHttpUrl: 'http://127.0.0.1:9944',
                proofServerHttpUrl: 'http://127.0.0.1:6300',
            };
        }
        if (network === 'preview') {
            return {
                indexerHttpUrl: 'https://indexer.preview.midnight.network/api/v3/graphql',
                indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v3/graphql/ws',
                nodeHttpUrl: 'https://rpc.preview.midnight.network',
                proofServerHttpUrl: 'http://127.0.0.1:6300',
            };
        }
        return {
            indexerHttpUrl: 'https://indexer.preprod.midnight.network/api/v3/graphql',
            indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v3/graphql/ws',
            nodeHttpUrl: 'https://rpc.preprod.midnight.network',
            proofServerHttpUrl: 'http://127.0.0.1:6300',
        };
    })();
    const zkConfigPath = process.env.MIDLIGHT_ZK_CONFIG_PATH
        ? path.resolve(process.env.MIDLIGHT_ZK_CONFIG_PATH)
        : path.resolve(repoRoot, 'midnight', 'contract', 'src', 'managed', 'pickup');
    const statePath = process.env.MIDLIGHT_STATE_PATH
        ? path.resolve(process.env.MIDLIGHT_STATE_PATH)
        : path.resolve(repoRoot, 'services', 'prover', '.data', 'state.json');
    return {
        network,
        port: process.env.PORT ? Number(process.env.PORT) : 4000,
        indexerHttpUrl: process.env.MIDNIGHT_INDEXER_HTTP ?? defaults.indexerHttpUrl,
        indexerWsUrl: process.env.MIDNIGHT_INDEXER_WS ?? defaults.indexerWsUrl,
        nodeHttpUrl: process.env.MIDNIGHT_NODE_HTTP ?? defaults.nodeHttpUrl,
        proofServerHttpUrl: process.env.MIDNIGHT_PROOF_SERVER_HTTP ?? defaults.proofServerHttpUrl,
        walletSeedHex: process.env.MIDNIGHT_WALLET_SEED,
        zkConfigPath: requireUrl(zkConfigPath, 'MIDLIGHT_ZK_CONFIG_PATH (derived default)'),
        statePath: requireUrl(statePath, 'MIDLIGHT_STATE_PATH (derived default)'),
    };
};
//# sourceMappingURL=config.js.map