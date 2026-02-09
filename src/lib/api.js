async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = (data && data.message) || `${res.status} ${res.statusText}`
    const err = new Error(msg)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

export const api = {
  health: () => request('/api/health'),
  clinicInit: () => request('/api/clinic/init', { method: 'POST' }),
  patientCreate: () => request('/api/patient', { method: 'POST' }),
  deploy: () => request('/api/contract/deploy', { method: 'POST' }),
  deployJob: () => request('/api/jobs/deploy', { method: 'POST' }),
  join: (contractAddress) => request('/api/contract/join', { method: 'POST', body: { contractAddress } }),
  contractState: () => request('/api/contract/state'),
  registerAuthorization: (body) => request('/api/clinic/register', { method: 'POST', body }),
  registerAuthorizationJob: (body) => request('/api/jobs/register', { method: 'POST', body }),
  redeem: (body) => request('/api/patient/redeem', { method: 'POST', body }),
  redeemJob: (body) => request('/api/jobs/redeem', { method: 'POST', body }),
  pharmacyCheck: (body) => request('/api/pharmacy/check', { method: 'POST', body }),
  job: (jobId) => request(`/api/jobs/${jobId}`),
}
