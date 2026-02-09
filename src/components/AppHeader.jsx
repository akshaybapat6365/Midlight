import React from 'react'
import { truncate } from '../lib/utils'

export function AppHeader({ health }) {
  const contract = health?.contractAddress
  const network = health?.network

  return (
    <header className="border-b border-border/60 bg-card/60 backdrop-blur">
      <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-sm text-muted-foreground">Midlight</div>
          <h1 className="text-xl font-semibold tracking-tight">
            Prescription Pickup, No Manual ID
          </h1>
        </div>

        <div className="text-right">
          <div className="text-xs text-muted-foreground">Network</div>
          <div className="text-sm font-medium">{network || 'unknown'}</div>
          <div className="mt-1 text-xs text-muted-foreground">Contract</div>
          <div className="text-sm font-mono" title={contract || ''}>
            {contract ? truncate(contract, 18) : 'not deployed'}
          </div>
        </div>
      </div>
    </header>
  )
}

