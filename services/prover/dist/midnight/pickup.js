import crypto from 'node:crypto';
import { inspect } from 'node:util';
import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { CompiledContract } from '@midnight-ntwrk/compact-js';
import { assertIsContractAddress } from '@midnight-ntwrk/midnight-js-utils';
import { Contract, ledger, pureCircuits, witnesses } from '@midlight/pickup-contract';
import { bytesToHex, hexToBytesN, randomBytes32, strip0x, zeroBytes } from '../utils/hex.js';
const CLINIC_ID = 'clinic';
const makePrivateState = (params) => ({
    issuerSecretKey: params.issuerSecretKey,
    patientSecretKey: params.patientSecretKey,
});
const compiledPickupContract = (zkConfigPath) => CompiledContract.make('pickup', Contract).pipe(CompiledContract.withWitnesses(witnesses), CompiledContract.withCompiledFileAssets(zkConfigPath));
const asBytes32 = (hex) => hexToBytesN(hex, 32);
const asBigUint64 = (v) => {
    const asStr = typeof v === 'number' ? String(v) : v;
    if (!/^[0-9]+$/.test(asStr))
        throw new Error('rxId must be a base-10 integer string');
    return BigInt(asStr);
};
const normalizeContractAddress = (s) => {
    const clean = strip0x(s);
    if (clean.length === 0)
        throw new Error('contractAddress required');
    return `0x${clean}`;
};
export class PickupService {
    #providers;
    #store;
    #compiledContract;
    #privateStateStoreName;
    constructor(params) {
        this.#providers = params.providers;
        this.#store = params.store;
        this.#compiledContract = compiledPickupContract(params.zkConfigPath);
        this.#privateStateStoreName = params.privateStateStoreName;
    }
    async getStatus() {
        const state = await this.#store.read();
        return {
            contractAddress: state.contractAddress ?? null,
            clinicInitialized: Boolean(state.clinic?.issuerSecretKeyHex),
            patientCount: Object.keys(state.patients ?? {}).length,
            privateStateStoreName: this.#privateStateStoreName,
        };
    }
    async initClinic() {
        const next = await this.#store.update((prev) => {
            if (prev.clinic?.issuerSecretKeyHex)
                return prev;
            return { ...prev, clinic: { issuerSecretKeyHex: bytesToHex(randomBytes32()) } };
        });
        const sk = asBytes32(next.clinic.issuerSecretKeyHex);
        const pk = pureCircuits.issuerPublicKey(sk);
        return { issuerSecretKeyHex: bytesToHex(sk), issuerPublicKeyHex: bytesToHex(pk) };
    }
    async createPatient() {
        const patientId = crypto.randomUUID();
        const patientSk = randomBytes32();
        const patientPk = pureCircuits.patientPublicKey(patientSk);
        await this.#store.update((prev) => ({
            ...prev,
            patients: {
                ...(prev.patients ?? {}),
                [patientId]: {
                    patientSecretKeyHex: bytesToHex(patientSk),
                    patientPublicKeyHex: bytesToHex(patientPk),
                },
            },
        }));
        return { patientId, patientSecretKeyHex: bytesToHex(patientSk), patientPublicKeyHex: bytesToHex(patientPk) };
    }
    async setContractAddress(contractAddress) {
        await this.#store.update((prev) => ({ ...prev, contractAddress: normalizeContractAddress(contractAddress) }));
        return { contractAddress: normalizeContractAddress(contractAddress) };
    }
    async deployContract() {
        try {
            const state = await this.#store.read();
            if (!state.clinic?.issuerSecretKeyHex) {
                await this.initClinic();
            }
            const latest = await this.#store.read();
            const clinicSk = asBytes32(latest.clinic.issuerSecretKeyHex);
            const initialPrivateState = makePrivateState({ issuerSecretKey: clinicSk, patientSecretKey: zeroBytes(32) });
            const deployed = await deployContract(this.#providers, {
                compiledContract: this.#compiledContract,
                privateStateId: CLINIC_ID,
                initialPrivateState,
            });
            const contractAddress = deployed.deployTxData.public.contractAddress;
            await this.setContractAddress(contractAddress);
            return {
                contractAddress,
                txId: deployed.deployTxData.public.txId,
                blockHeight: deployed.deployTxData.public.blockHeight,
            };
        }
        catch (err) {
            if (process.env.MIDLIGHT_DEBUG_ERRORS === '1') {
                // eslint-disable-next-line no-console
                console.error(`\n[midlight] deployContract failed: ${inspect(err, { depth: 12, maxArrayLength: 50 })}`);
                // eslint-disable-next-line no-console
                console.error(`[midlight] deployContract failed (cause): ${inspect(err?.cause, { depth: 12, maxArrayLength: 50 })}`);
            }
            throw err;
        }
    }
    async getLedgerState() {
        const state = await this.#store.read();
        if (!state.contractAddress)
            throw new Error('No contract deployed/joined yet');
        assertIsContractAddress(state.contractAddress);
        const contractState = await this.#providers.publicDataProvider.queryContractState(state.contractAddress);
        if (!contractState)
            return null;
        return ledger(contractState.data);
    }
    async getLedgerStateJson() {
        const state = await this.getLedgerState();
        if (!state)
            return null;
        const issuerPkMaybe = state.issuer_pk;
        const issuerPublicKeyHex = issuerPkMaybe?.is_some === true && issuerPkMaybe.value ? bytesToHex(issuerPkMaybe.value) : null;
        const toHexArray = (setLike) => {
            if (!setLike)
                return [];
            const values = Array.isArray(setLike) ? setLike : typeof setLike.values === 'function' ? Array.from(setLike.values()) : [];
            return values.map((v) => (v instanceof Uint8Array ? bytesToHex(v) : String(v)));
        };
        const authorizations = toHexArray(state.authorizations);
        const spent = toHexArray(state.spent);
        return {
            issuerPublicKeyHex,
            authorizations: {
                count: authorizations.length,
                values: authorizations.slice(0, 50),
                truncated: authorizations.length > 50,
            },
            spent: {
                count: spent.length,
                values: spent.slice(0, 50),
                truncated: spent.length > 50,
            },
        };
    }
    async registerAuthorization(params) {
        const state = await this.#store.read();
        if (!state.contractAddress)
            throw new Error('No contract deployed/joined yet');
        const clinic = await this.initClinic();
        const clinicSk = asBytes32(clinic.issuerSecretKeyHex);
        const patientPk = params.patientPublicKeyHex != null
            ? asBytes32(params.patientPublicKeyHex)
            : (() => {
                if (!params.patientId)
                    throw new Error('patientId or patientPublicKeyHex required');
                const p = state.patients?.[params.patientId];
                if (!p)
                    throw new Error('Unknown patientId');
                return asBytes32(p.patientPublicKeyHex);
            })();
        const joined = await findDeployedContract(this.#providers, {
            contractAddress: state.contractAddress,
            compiledContract: this.#compiledContract,
            privateStateId: CLINIC_ID,
            initialPrivateState: makePrivateState({ issuerSecretKey: clinicSk, patientSecretKey: zeroBytes(32) }),
        });
        const rxId = asBigUint64(params.rxId);
        const pharmacyId = asBytes32(params.pharmacyIdHex);
        const commitment = pureCircuits.authorizationCommitment(rxId, pharmacyId, patientPk);
        const tx = await joined.callTx.registerAuthorization(rxId, pharmacyId, patientPk);
        return {
            commitmentHex: bytesToHex(commitment),
            txId: tx.public.txId,
            blockHeight: tx.public.blockHeight,
            contractAddress: joined.deployTxData.public.contractAddress,
        };
    }
    async redeem(params) {
        const state = await this.#store.read();
        if (!state.contractAddress)
            throw new Error('No contract deployed/joined yet');
        const p = state.patients?.[params.patientId];
        if (!p)
            throw new Error('Unknown patientId');
        const rxId = asBigUint64(params.rxId);
        const pharmacyId = asBytes32(params.pharmacyIdHex);
        const patientSk = asBytes32(p.patientSecretKeyHex);
        const patientPk = pureCircuits.patientPublicKey(patientSk);
        const nullifier = pureCircuits.redemptionNullifier(patientPk, rxId, pharmacyId);
        const joined = await findDeployedContract(this.#providers, {
            contractAddress: state.contractAddress,
            compiledContract: this.#compiledContract,
            privateStateId: `patient:${params.patientId}`,
            initialPrivateState: makePrivateState({ issuerSecretKey: zeroBytes(32), patientSecretKey: patientSk }),
        });
        const tx = await joined.callTx.redeem(rxId, pharmacyId);
        return {
            patientPublicKeyHex: bytesToHex(patientPk),
            nullifierHex: bytesToHex(nullifier),
            txId: tx.public.txId,
            blockHeight: tx.public.blockHeight,
            contractAddress: joined.deployTxData.public.contractAddress,
        };
    }
    async check(params) {
        const state = await this.#store.read();
        if (!state.contractAddress)
            throw new Error('No contract deployed/joined yet');
        const p = state.patients?.[params.patientId];
        if (!p)
            throw new Error('Unknown patientId');
        const rxId = asBigUint64(params.rxId);
        const pharmacyId = asBytes32(params.pharmacyIdHex);
        const patientPk = asBytes32(p.patientPublicKeyHex);
        const commitment = pureCircuits.authorizationCommitment(rxId, pharmacyId, patientPk);
        const nullifier = pureCircuits.redemptionNullifier(patientPk, rxId, pharmacyId);
        const ledgerState = await this.getLedgerState();
        if (!ledgerState)
            return { authorizationFound: false, redeemed: false };
        const authSet = ledgerState.authorizations;
        const spentSet = ledgerState.spent;
        const has = (setLike, value) => {
            if (!setLike)
                return false;
            if (typeof setLike.has === 'function')
                return Boolean(setLike.has(value));
            if (typeof setLike.member === 'function')
                return Boolean(setLike.member(value));
            const arr = Array.isArray(setLike) ? setLike : typeof setLike.values === 'function' ? Array.from(setLike.values()) : [];
            const hex = bytesToHex(value);
            return arr.some((x) => bytesToHex(x) === hex);
        };
        return {
            commitmentHex: bytesToHex(commitment),
            nullifierHex: bytesToHex(nullifier),
            authorizationFound: has(authSet, commitment),
            redeemed: has(spentSet, nullifier),
            issuerPublicKeyHex: ledgerState.issuer_pk?.is_some ? bytesToHex(ledgerState.issuer_pk.value) : null,
        };
    }
}
//# sourceMappingURL=pickup.js.map