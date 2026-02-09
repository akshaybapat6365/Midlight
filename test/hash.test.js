import { describe, it, expect } from 'vitest'
import { sha256Hex } from '../src/lib/hash'

describe('sha256Hex', () => {
  it('returns 64 hex chars', async () => {
    const out = await sha256Hex('hello')
    expect(out).toMatch(/^[0-9a-f]{64}$/)
  })

  it('matches known value for abc', async () => {
    const out = await sha256Hex('abc')
    expect(out).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

