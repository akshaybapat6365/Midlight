import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react'
import { createOrLoadDID } from '../lib/prism'

const EXPECTED_NETWORK_ID = parseInt(
  import.meta.env.VITE_EXPECTED_NETWORK_ID || '0',
  10
)

const WalletContext = createContext(null)

export function WalletProvider({ children }) {
  const wallet = useWalletState()
  return React.createElement(
    WalletContext.Provider,
    { value: wallet },
    children
  )
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) {
    throw new Error('useWallet must be used within a WalletProvider')
  }
  return ctx
}

function useWalletState() {
  const [connected, setConnected] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [did, setDid] = useState(null)
  const [api, setApi] = useState(null)

  const connect = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (!window?.cardano?.lace) {
        throw new Error('Lace wallet not found')
      }
      const walletApi = await window.cardano.lace.enable()
      setApi(walletApi)
      if (!walletApi.getRewardAddresses || !walletApi.getNetworkId) {
        throw new Error('Wallet missing required capabilities')
      }
      const networkId = await walletApi.getNetworkId()
      if (networkId !== EXPECTED_NETWORK_ID) {
        throw new Error(
          `Unsupported network: expected ${EXPECTED_NETWORK_ID}, got ${networkId}`
        )
      }
      const rewards = await walletApi.getRewardAddresses()
      if (rewards && rewards[0]) {
        const prismDid = await createOrLoadDID(rewards[0])
        setDid(prismDid)
      }
      setConnected(true)
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      setConnected(false)
      setApi(null)
      setDid(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setConnected(false)
    setApi(null)
    setDid(null)
  }, [])

  return useMemo(
    () => ({ connect, disconnect, connected, loading, error, did, api }),
    [connect, disconnect, connected, loading, error, did, api]
  )
}
