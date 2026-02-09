import crypto from 'node:crypto';
export const strip0x = (hex) => hex.replace(/^0x/i, '');
export const isHex = (s) => /^[0-9a-fA-F]+$/.test(strip0x(s));
export const bytesToHex = (bytes) => Buffer.from(bytes).toString('hex');
export const hexToBytes = (hex) => {
    const clean = strip0x(hex);
    if (clean.length % 2 !== 0)
        throw new Error('hex must have even length');
    if (!isHex(clean))
        throw new Error('invalid hex');
    return new Uint8Array(Buffer.from(clean, 'hex'));
};
export const hexToBytesN = (hex, n) => {
    const bytes = hexToBytes(hex);
    if (bytes.length !== n)
        throw new Error(`expected ${n} bytes, got ${bytes.length}`);
    return bytes;
};
export const randomBytes = (n) => new Uint8Array(crypto.randomBytes(n));
export const randomBytes32 = () => randomBytes(32);
export const zeroBytes = (n) => new Uint8Array(n);
//# sourceMappingURL=hex.js.map