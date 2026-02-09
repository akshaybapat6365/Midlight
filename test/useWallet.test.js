import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { createElement } from 'react'
import { WalletProvider, useWallet } from '../src/hooks/useWallet'
import * as prism from '../src/lib/prism'

function mockWindow(enableImpl) {
  // Preserve the jsdom window while injecting the cardano API
  Object.defineProperty(global.window, 'cardano', {
    configurable: true,
    value: { lace: { enable: enableImpl } },
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  delete global.window.cardano
})

function Wrapper({ children }) {
  return createElement(WalletProvider, null, children)
}

describe('useWallet', () => {
  it('connects and exposes DID', async () => {
    const reward = 'addr_test1reward'
    const enable = vi.fn().mockResolvedValue({
      getRewardAddresses: vi.fn().mockResolvedValue([reward]),
      getNetworkId: vi.fn().mockResolvedValue(0),
    })
    mockWindow(enable)
    const prismSpy = vi
      .spyOn(prism, 'createOrLoadDID')
      .mockResolvedValue(`did:prism:${reward}`)

    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.connect()
    })

    expect(enable).toHaveBeenCalled()
    expect(prismSpy).toHaveBeenCalledWith(reward)
    expect(result.current.connected).toBe(true)
    expect(result.current.did).toBe(`did:prism:${reward}`)
    expect(result.current.error).toBeNull()
  })

  it('sets error when wallet missing', async () => {
    delete global.window.cardano
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.connect()
    })
    expect(result.current.connected).toBe(false)
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('errors on unsupported network', async () => {
    const enable = vi.fn().mockResolvedValue({
      getRewardAddresses: vi.fn().mockResolvedValue(['addr']),
      getNetworkId: vi.fn().mockResolvedValue(1),
    })
    mockWindow(enable)
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.connect()
    })
    expect(result.current.connected).toBe(false)
    expect(result.current.error).toBeInstanceOf(Error)
  })

  it('errors when wallet lacks capability', async () => {
    const enable = vi.fn().mockResolvedValue({
      getRewardAddresses: undefined,
      getNetworkId: vi.fn().mockResolvedValue(0),
    })
    mockWindow(enable)
    const { result } = renderHook(() => useWallet(), { wrapper: Wrapper })
    await act(async () => {
      await result.current.connect()
    })
    expect(result.current.connected).toBe(false)
    expect(result.current.error).toBeInstanceOf(Error)
  })
})
