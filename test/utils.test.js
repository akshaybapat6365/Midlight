import { describe, it, expect } from 'vitest'
import { truncate } from '../src/lib/utils'

describe('utils', () => {
  it('truncate returns empty string for nullish', () => {
    expect(truncate(null)).toBe('')
    expect(truncate(undefined)).toBe('')
  })

  it('truncate returns original string when under max length', () => {
    expect(truncate('abc', 10)).toBe('abc')
  })

  it('truncate shortens long strings with a middle ellipsis', () => {
    const out = truncate('did:prism:abcdefghijklmnopqrstuvwxyz', 20)
    expect(out.length).toBe(20)
    expect(out).toContain('...')
  })
})

