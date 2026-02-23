import * as CSL from '@emurgo/cardano-serialization-lib-asmjs';

import type { CardanoNetwork } from './hd-wallet';
import type { BlockfrostAmount, BlockfrostProtocolParameters, BlockfrostUtxo } from '@ext/shared/providers/blockfrost';
import type { TransactionSummary, TxBuildResult } from '@ext/shared/types/runtime';

type BuildSimpleTransferParams = {
  network: CardanoNetwork;
  utxos: BlockfrostUtxo[];
  recipientAddress: string;
  amountLovelace: bigint;
  changeAddress: string;
  protocolParameters: BlockfrostProtocolParameters;
  currentSlot?: bigint;
  ttlOffset?: bigint;
};

const hexToBytes = (hex: string): Uint8Array => {
  const clean = hex.replace(/^0x/i, '').trim();
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
    throw new Error('Expected even-length hex string');
  }
  return Uint8Array.from(
    { length: clean.length / 2 },
    (_, index) => Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16),
  );
};

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const resolveCoinsPerUtxoByte = (params: BlockfrostProtocolParameters): string =>
  params.coins_per_utxo_byte ?? params.coins_per_utxo_size ?? params.coins_per_utxo_word ?? '4310';

const parseLovelace = (amount: BlockfrostAmount[]): bigint =>
  BigInt(amount.find((entry) => entry.unit === 'lovelace')?.quantity ?? '0');

const valueFromAmounts = (amounts: BlockfrostAmount[]): CSL.Value => {
  const coin = CSL.BigNum.from_str(parseLovelace(amounts).toString());
  const value = CSL.Value.new(coin);

  const nonLovelace = amounts.filter((entry) => entry.unit !== 'lovelace');
  if (nonLovelace.length === 0) return value;

  const byPolicy = new Map<string, Array<{ assetHex: string; quantity: string }>>();
  for (const entry of nonLovelace) {
    const unit = entry.unit;
    if (unit.length < 56) continue;
    const policy = unit.slice(0, 56);
    const assetHex = unit.slice(56);
    const list = byPolicy.get(policy) ?? [];
    list.push({ assetHex, quantity: entry.quantity });
    byPolicy.set(policy, list);
  }

  const multiAsset = CSL.MultiAsset.new();
  for (const [policyHex, assetsForPolicy] of byPolicy.entries()) {
    const assets = CSL.Assets.new();
    for (const asset of assetsForPolicy) {
      assets.insert(CSL.AssetName.new(hexToBytes(asset.assetHex)), CSL.BigNum.from_str(asset.quantity));
    }
    multiAsset.insert(CSL.ScriptHash.from_hex(policyHex), assets);
  }

  value.set_multiasset(multiAsset);
  return value;
};

const toUtxo = (utxo: BlockfrostUtxo, fallbackAddress: string): CSL.TransactionUnspentOutput => {
  const input = CSL.TransactionInput.new(
    CSL.TransactionHash.from_hex(utxo.tx_hash),
    Number.isFinite(utxo.output_index) ? utxo.output_index : utxo.tx_index,
  );
  const outputAddress = utxo.address ?? fallbackAddress;
  const output = CSL.TransactionOutput.new(CSL.Address.from_bech32(outputAddress), valueFromAmounts(utxo.amount));
  return CSL.TransactionUnspentOutput.new(input, output);
};

const buildSummary = (tx: CSL.Transaction): TransactionSummary => {
  const body = tx.body();
  const outputs = body.outputs();
  const firstOutput = outputs.get(0);
  const firstAmount = firstOutput.amount().coin().to_str();
  const fee = body.fee().to_str();
  const total = (BigInt(firstAmount) + BigInt(fee)).toString();
  return {
    toAddress: firstOutput.address().to_bech32(),
    amountLovelace: firstAmount,
    feeLovelace: fee,
    totalLovelace: total,
    outputCount: outputs.len(),
  };
};

export const buildSimpleTransfer = (params: BuildSimpleTransferParams): TxBuildResult => {
  if (params.amountLovelace <= 0n) throw new Error('amountLovelace must be positive');
  if (params.utxos.length === 0) throw new Error('No UTxOs available for transfer');

  const totalAvailable = params.utxos.reduce((sum, utxo) => sum + parseLovelace(utxo.amount), 0n);
  if (totalAvailable < params.amountLovelace) {
    throw new Error(`Insufficient funds: ${totalAvailable.toString()} < ${params.amountLovelace.toString()}`);
  }

  const config = CSL.TransactionBuilderConfigBuilder.new()
    .fee_algo(
      CSL.LinearFee.new(
        CSL.BigNum.from_str(String(params.protocolParameters.min_fee_a)),
        CSL.BigNum.from_str(String(params.protocolParameters.min_fee_b)),
      ),
    )
    .coins_per_utxo_byte(CSL.BigNum.from_str(resolveCoinsPerUtxoByte(params.protocolParameters)))
    .pool_deposit(CSL.BigNum.from_str(params.protocolParameters.pool_deposit))
    .key_deposit(CSL.BigNum.from_str(params.protocolParameters.key_deposit))
    .max_value_size(Number.parseInt(params.protocolParameters.max_val_size, 10))
    .max_tx_size(params.protocolParameters.max_tx_size)
    .prefer_pure_change(true)
    .build();

  const builder = CSL.TransactionBuilder.new(config);
  builder.add_output(
    CSL.TransactionOutput.new(
      CSL.Address.from_bech32(params.recipientAddress),
      CSL.Value.new(CSL.BigNum.from_str(params.amountLovelace.toString())),
    ),
  );

  const inputCollection = CSL.TransactionUnspentOutputs.new();
  for (const utxo of params.utxos) {
    inputCollection.add(toUtxo(utxo, params.changeAddress));
  }
  builder.add_inputs_from(inputCollection, CSL.CoinSelectionStrategyCIP2.LargestFirstMultiAsset);

  if (params.currentSlot != null) {
    const ttlOffset = params.ttlOffset ?? 3_600n;
    builder.set_ttl_bignum(CSL.BigNum.from_str((params.currentSlot + ttlOffset).toString()));
  }
  builder.add_change_if_needed(CSL.Address.from_bech32(params.changeAddress));

  const tx = builder.build_tx();
  return {
    txCborHex: bytesToHex(tx.to_bytes()),
    summary: buildSummary(tx),
  };
};
