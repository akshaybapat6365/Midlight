import React, { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { sha256Hex } from '../lib/hash'
import { truncate } from '../lib/utils'
import { Button } from './Button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'

function Field({ label, hint, value, onChange, placeholder, mono = false }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-sm font-medium">{label}</div>
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </div>
      <input
        className={`mt-1 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          mono ? 'font-mono' : ''
        }`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="block">
      <div className="text-sm font-medium">{label}</div>
      <select
        className="mt-1 w-full rounded-md border border-input bg-background/60 px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="" disabled>
          Select…
        </option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Result({ title, value }) {
  if (!value) return null
  return (
    <div className="mt-3 rounded-md border border-border/70 bg-muted/40 p-3">
      <div className="text-xs text-muted-foreground">{title}</div>
      <pre className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

async function labelToBytes32Hex(label) {
  const hex = await sha256Hex(label)
  return hex.slice(0, 64)
}

export function PickupDemo({ onHealth }) {
  const [health, setHealth] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [job, setJob] = useState(null)

  const [contractAddress, setContractAddress] = useState('')

  const [clinic, setClinic] = useState(null)
  const [patients, setPatients] = useState([])

  const [rxId, setRxId] = useState('1')
  const [pharmacyLabel, setPharmacyLabel] = useState('acme-pharmacy-1')
  const [pharmacyIdHex, setPharmacyIdHex] = useState('')
  const [selectedPatientId, setSelectedPatientId] = useState('')

  const [lastResult, setLastResult] = useState(null)

  const patientOptions = useMemo(
    () =>
      patients.map((p) => ({
        value: p.patientId,
        label: `${p.patientId} (${truncate(p.patientPublicKeyHex, 18)})`,
      })),
    [patients]
  )

  const refreshHealth = async () => {
    const h = await api.health()
    setHealth(h)
    onHealth?.(h)
    if (h?.contractAddress && !contractAddress) {
      setContractAddress(h.contractAddress)
    }
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  const runJob = async (startJob) => {
    setBusy(true)
    setError(null)
    setLastResult(null)
    setJob(null)

    try {
      const started = await startJob()
      const jobId = started?.jobId
      if (!jobId) throw new Error('Job did not return jobId')

      // Poll until completion.
      // Keep polling even if UI takes a while; the backend job is already running.
      for (;;) {
        const out = await api.job(jobId)
        const j = out?.job
        if (!j) throw new Error('Job not found')
        setJob(j)

        if (j.status === 'running') {
          await sleep(1500)
          continue
        }

        if (j.status === 'failed') {
          const msg = j.error?.message || 'Job failed'
          const e = new Error(msg)
          e.job = j
          throw e
        }

        setLastResult(j.result)
        await refreshHealth()
        return j.result
      }
    } catch (e) {
      setError(e)
      throw e
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    refreshHealth().catch((e) => setError(e))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    labelToBytes32Hex(pharmacyLabel)
      .then((hex) => {
        if (!cancelled) setPharmacyIdHex(hex)
      })
      .catch(() => {
        if (!cancelled) setPharmacyIdHex('')
      })
    return () => {
      cancelled = true
    }
  }, [pharmacyLabel])

  const run = async (fn) => {
    setBusy(true)
    setError(null)
    setLastResult(null)
    try {
      const out = await fn()
      setLastResult(out)
      await refreshHealth()
      return out
    } catch (e) {
      setError(e)
      throw e
    } finally {
      setBusy(false)
    }
  }

  const ensureClinic = () =>
    run(async () => {
      const out = await api.clinicInit()
      setClinic(out)
      return out
    })

  const createPatient = () =>
    run(async () => {
      const out = await api.patientCreate()
      setPatients((prev) => [out, ...prev])
      if (!selectedPatientId) setSelectedPatientId(out.patientId)
      return out
    })

  const deploy = () =>
    runJob(async () => {
      const out = await api.deployJob()
      return out
    }).then((out) => {
      // job.result is the deploy response
      if (out?.contractAddress) setContractAddress(out.contractAddress)
      return out
    })

  const join = () =>
    run(async () => {
      const out = await api.join(contractAddress.trim())
      setContractAddress(out.contractAddress)
      return out
    })

  const register = () =>
    runJob(async () => {
      if (!selectedPatientId) throw new Error('Select a patient first')
      return await api.registerAuthorizationJob({ rxId, pharmacyIdHex, patientId: selectedPatientId })
    })

  const redeem = () =>
    runJob(async () => {
      if (!selectedPatientId) throw new Error('Select a patient first')
      return await api.redeemJob({ patientId: selectedPatientId, rxId, pharmacyIdHex })
    })

  const check = () =>
    run(async () => {
      if (!selectedPatientId) throw new Error('Select a patient first')
      return await api.pharmacyCheck({
        patientId: selectedPatientId,
        rxId,
        pharmacyIdHex,
      })
    })

  return (
    <main className="mx-auto max-w-5xl p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Runbook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div>
            1. Install deps: <span className="font-mono">npm install</span>
          </div>
          <div>
            2. Start Midnight local stack:{' '}
            <span className="font-mono">
              docker compose -f services/prover/standalone.yml up -d
            </span>
          </div>
          <div>
            3. Start demo: <span className="font-mono">npm run dev:demo</span>
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <div className="font-medium text-destructive">Error</div>
          <div className="mt-1 font-mono text-xs whitespace-pre-wrap break-words">
            {String(error?.message || error)}
          </div>
        </div>
      ) : null}

      {job ? (
        <div className="rounded-md border border-border/70 bg-card/60 p-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-medium">
              Job: <span className="font-mono">{job.type}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              status: <span className="font-medium">{job.status}</span>
            </div>
          </div>
          {job.logs?.length ? (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-xs">
              {job.logs.slice(-30).join('\n')}
            </pre>
          ) : (
            <div className="mt-2 text-xs text-muted-foreground">No logs yet.</div>
          )}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="md:col-span-1">
          <CardHeader>
            <CardTitle>Setup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Prover health: <span className="font-medium">{health?.ok ? 'ok' : 'unknown'}</span>
            </div>
            <div className="flex gap-2">
              <Button onClick={ensureClinic} disabled={busy}>
                Init Clinic
              </Button>
              <Button variant="secondary" onClick={createPatient} disabled={busy}>
                New Patient
              </Button>
            </div>
            <div className="flex gap-2">
              <Button onClick={deploy} disabled={busy}>
                Deploy
              </Button>
              <Button variant="outline" onClick={refreshHealth} disabled={busy}>
                Refresh
              </Button>
            </div>

            <Field
              label="Contract Address"
              hint="Paste to join an existing deployment"
              value={contractAddress}
              onChange={setContractAddress}
              placeholder="0x…"
              mono
            />
            <Button variant="outline" onClick={join} disabled={busy || !contractAddress.trim()}>
              Join
            </Button>

            <Result title="Clinic" value={clinic} />
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Actors</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field
                label="Rx ID"
                hint="uint64 (base-10)"
                value={rxId}
                onChange={setRxId}
                placeholder="1"
                mono
              />
              <Field
                label="Pharmacy Label"
                hint="Hashed to Bytes32 via SHA-256"
                value={pharmacyLabel}
                onChange={setPharmacyLabel}
                placeholder="acme-pharmacy-1"
              />
            </div>

            <div className="rounded-md border border-border/70 bg-muted/30 p-3">
              <div className="text-xs text-muted-foreground">Derived Pharmacy ID (Bytes32 hex)</div>
              <div className="mt-1 font-mono text-xs break-all">{pharmacyIdHex || '…'}</div>
            </div>

            <Select
              label="Patient"
              value={selectedPatientId}
              onChange={setSelectedPatientId}
              options={patientOptions}
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Button onClick={register} disabled={busy || !selectedPatientId}>
                Clinic: Register
              </Button>
              <Button variant="secondary" onClick={redeem} disabled={busy || !selectedPatientId}>
                Patient: Redeem
              </Button>
              <Button variant="outline" onClick={check} disabled={busy || !selectedPatientId}>
                Pharmacy: Check
              </Button>
            </div>

            <Result title="Result" value={lastResult} />

            {patients.length ? (
              <div className="rounded-md border border-border/70 bg-card/60 p-3">
                <div className="text-sm font-medium">Patients (local UI)</div>
                <div className="mt-2 space-y-2">
                  {patients.map((p) => (
                    <div key={p.patientId} className="text-xs">
                      <div className="font-mono">{p.patientId}</div>
                      <div className="mt-1 text-muted-foreground">
                        pk: <span className="font-mono">{truncate(p.patientPublicKeyHex, 32)}</span>
                      </div>
                      <div className="text-muted-foreground">
                        sk: <span className="font-mono">{truncate(p.patientSecretKeyHex, 32)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
