// src/pages/SignPage.jsx
//
// ── HOW THIS WORKS ────────────────────────────────────────────────────────────
// Instead of hiding the WalletConnect QR inside a modal, we:
//
//   1. Call SignClient.init() to connect to the relay
//   2. Call client.connect() → get back a wc:... URI immediately
//   3. Render THAT URI as a QR code right on screen
//   4. The other person opens their wallet → taps the scan icon → scans it
//   5. Their wallet handles the session_proposal internally
//   6. When they approve, our approval() Promise resolves
//   7. We immediately send them the sign or approve request
//   8. Their wallet shows the confirmation → they approve → done
//
// The key insight: the wc: URI IS the QR. We just render it ourselves
// instead of letting AppKit hide it in a modal.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useCallback } from 'react'
import QRCode from 'qrcode'
import { SignClient } from '@walletconnect/sign-client'
import { projectId, TOKEN_ADDRESS, TOKEN_SYMBOL } from '../config.js'

const METADATA = {
  name: 'Web3 QR dApp',
  description: 'Scan to sign or approve',
  url: window.location.origin,
  icons: ['https://avatars.githubusercontent.com/u/179229932'],
}

const ERC20_ABI = [{
  name: 'approve',
  type: 'function',
  stateMutability: 'nonpayable',
  inputs: [
    { name: 'spender', type: 'address' },
    { name: 'amount',  type: 'uint256' },
  ],
  outputs: [{ type: 'bool' }],
}]

async function buildApproveCalldata(spender, amount) {
  const { encodeFunctionData, parseUnits } = await import('viem')
  return encodeFunctionData({
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, parseUnits(amount, 6)],
  })
}

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    idle:       { color: '#5a6a8a', label: 'Ready' },
    generating: { color: '#ffc94d', label: 'Generating QR...' },
    waiting:    { color: '#4db8ff', label: 'Waiting for scan' },
    connected:  { color: '#4fffb0', label: 'Wallet connected' },
    requesting: { color: '#ffc94d', label: 'Sent to wallet...' },
    success:    { color: '#4fffb0', label: 'Approved ✓' },
    error:      { color: '#ff5c5c', label: 'Error' },
    expired:    { color: '#ff5c5c', label: 'QR expired' },
  }
  const s = map[status] || map.idle
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      background: s.color + '15',
      border: `1px solid ${s.color}44`,
      borderRadius: 20, padding: '5px 12px',
    }}>
      <div style={{
        width: 7, height: 7, borderRadius: '50%',
        background: s.color,
        boxShadow: `0 0 8px ${s.color}`,
        animation: ['waiting','requesting','generating'].includes(status)
          ? 'glow 1.2s infinite' : 'none',
      }} />
      <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: s.color }}>
        {s.label}
      </span>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SignPage() {
  const [tab, setTab]             = useState('sign')
  const [status, setStatus]       = useState('idle')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [client, setClient]       = useState(null)
  const [result, setResult]       = useState(null)
  const [error, setError]         = useState('')
  const [timeLeft, setTimeLeft]   = useState(0)

  // Sign tab
  const [message, setMessage] = useState('I authorize this action.\n\nSigned via Web3 QR dApp.')

  // Approve tab
  const [spender, setSpender] = useState('')
  const [amount, setAmount]   = useState('10')

  // ── Init SignClient once on mount ─────────────────────────────────────────
  useEffect(() => {
    SignClient.init({ projectId, metadata: METADATA })
      .then(setClient)
      .catch(err => console.error('SignClient init failed:', err))
  }, [])

  // ── Reset state ───────────────────────────────────────────────────────────
  const reset = () => {
    setStatus('idle')
    setQrDataUrl('')
    setResult(null)
    setError('')
    setTimeLeft(0)
  }

  // ── Send the actual request after wallet connects ─────────────────────────
  const sendRequest = async (c, session) => {
    setStatus('requesting')
    const accounts = session.namespaces.eip155.accounts
    const address  = accounts[0].split(':')[2]
    const chainId  = accounts[0].split(':').slice(0, 2).join(':')

    try {
      if (tab === 'sign') {
        // Hex-encode the message for personal_sign
        const hexMsg = '0x' + Array.from(new TextEncoder().encode(message))
          .map(b => b.toString(16).padStart(2, '0')).join('')

        const sig = await c.request({
          topic: session.topic,
          chainId,
          request: {
            method: 'personal_sign',
            params: [hexMsg, address],
          },
        })
        setResult({ type: 'signature', value: sig, address })

      } else {
        const data = await buildApproveCalldata(spender, amount)
        const txHash = await c.request({
          topic: session.topic,
          chainId,
          request: {
            method: 'eth_sendTransaction',
            params: [{
              from: address,
              to: TOKEN_ADDRESS,
              data,
              gas: '0x186A0',
            }],
          },
        })
        setResult({ type: 'txHash', value: txHash, address })
      }

      setStatus('success')

    } catch (err) {
      const msg = err.message ?? ''
      if (msg.includes('reject') || msg.includes('declin') || msg.includes('cancel')) {
        setError('Request rejected in wallet.')
      } else {
        setError(msg || 'Request failed.')
      }
      setStatus('error')
    }
  }

  // ── Generate QR ───────────────────────────────────────────────────────────
  const generateQR = useCallback(async () => {
    if (!client) return
    setStatus('generating')
    setResult(null)
    setError('')
    setQrDataUrl('')

    try {
      // client.connect() returns the wc: URI immediately
      // approval() is a Promise that resolves when wallet scans + approves
      const { uri, approval } = await client.connect({
        requiredNamespaces: {
          eip155: {
            methods: ['personal_sign', 'eth_sendTransaction', 'eth_signTypedData'],
            chains: ['eip155:1', 'eip155:11155111'],
            events: ['accountsChanged', 'chainChanged'],
          },
        },
      })

      if (!uri) throw new Error('No URI returned — try again.')

      // Render wc: URI as a QR image
      const dataUrl = await QRCode.toDataURL(uri, {
        width: 260,
        margin: 2,
        color: { dark: '#05080f', light: '#f0f4ff' },
        errorCorrectionLevel: 'M',
      })

      setQrDataUrl(dataUrl)
      setStatus('waiting')
      setTimeLeft(300) // 5 min timeout

      // Wait for wallet to scan and approve the session
      const session = await approval()
      setStatus('connected')

      // Immediately fire the sign/approve request
      await sendRequest(client, session)

    } catch (err) {
      const msg = err.message ?? ''
      if (msg.includes('expired')) {
        setStatus('expired')
      } else if (msg.includes('reject') || msg.includes('declin')) {
        setError('Connection rejected by wallet.')
        setStatus('error')
      } else {
        setError(msg || 'Something went wrong.')
        setStatus('error')
      }
    }
  }, [client, tab, message, spender, amount])

  // ── Countdown ─────────────────────────────────────────────────────────────
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

  const mins = String(Math.floor(timeLeft / 60)).padStart(2, '0')
  const secs = String(timeLeft % 60).padStart(2, '0')
  const isActive = ['waiting', 'connected', 'requesting'].includes(status)

  return (
    <div className="page sign-page">

      {/* ── Page Header ── */}
      <div className="page-header">
        <div className="page-tag">PAGE 02</div>
        <h1>Sign & Approve</h1>
        <p className="page-desc">
          Generate a QR. The other person opens their wallet, taps the scan icon,
          and scans it. Their wallet handles everything — no browser visit needed.
        </p>
      </div>

      {/* ── Tabs ── */}
      <div className="tabs">
        <button
          className={`tab-btn ${tab === 'sign' ? 'active' : ''}`}
          onClick={() => { setTab('sign'); reset() }}
          disabled={isActive}
        >
          ✍️ Sign Message
        </button>
        <button
          className={`tab-btn ${tab === 'approve' ? 'active' : ''}`}
          onClick={() => { setTab('approve'); reset() }}
          disabled={isActive}
        >
          🔓 Token Approve
        </button>
      </div>

      {/* ── Config form ── */}
      {tab === 'sign' && (
        <div className="input-group">
          <label>Message they will sign</label>
          <textarea
            rows={3}
            value={message}
            onChange={e => setMessage(e.target.value)}
            disabled={isActive}
            placeholder="Type any message..."
          />
        </div>
      )}

      {tab === 'approve' && (
        <>
          <div className="input-group">
            <label>Spender address <span className="label-hint">(who gets approved)</span></label>
            <input
              value={spender}
              onChange={e => setSpender(e.target.value)}
              disabled={isActive}
              placeholder="0x..."
            />
          </div>
          <div className="input-group">
            <label>Amount <span className="label-hint">({TOKEN_SYMBOL})</span></label>
            <div className="amount-row">
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                disabled={isActive}
                min="0"
              />
              <span className="currency">{TOKEN_SYMBOL}</span>
            </div>
          </div>
        </>
      )}

      {/* ── QR Card ── */}
      <div className="qr-card">
        <div className="qr-card-header">
          <StatusBadge status={status} />
          {timeLeft > 0 && status === 'waiting' && (
            <span className="countdown">{mins}:{secs}</span>
          )}
        </div>

        {/* States */}
        {status === 'idle' && (
          <div className="qr-idle">
            <div className="qr-idle-icon">⬡</div>
            <p>Set your request above<br />then tap Generate</p>
          </div>
        )}

        {status === 'generating' && (
          <div className="qr-idle">
            <div className="qr-idle-icon" style={{ animation: 'spin 1s linear infinite' }}>⟳</div>
            <p>Connecting to relay...</p>
          </div>
        )}

        {qrDataUrl && (
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img
              src={qrDataUrl}
              alt="WalletConnect QR"
              className="qr-image"
              style={{ opacity: status === 'expired' ? 0.25 : 1, transition: 'opacity 0.3s' }}
            />
            {status === 'expired' && (
              <div className="qr-expired-overlay">Expired — regenerate</div>
            )}
            {(status === 'connected' || status === 'requesting') && (
              <div className="qr-overlay-badge">✓ Scanned</div>
            )}
            {status === 'success' && (
              <div className="qr-overlay-badge" style={{ background: '#4fffb0', color: '#020810' }}>
                ✓ Done
              </div>
            )}
          </div>
        )}

        {/* Mechanic note */}
        <div className="mechanic-box" style={{ width: '100%' }}>
          <div className="mechanic-title">🔬 What's encoded in this QR</div>
          <p>
            A <code>wc:</code> URI containing a relay topic ID and a symmetric
            encryption key. When scanned from inside the wallet, the wallet
            subscribes to that topic on the relay and receives a{' '}
            {tab === 'sign'
              ? <><code>personal_sign</code> request for your message.</>
              : <><code>eth_sendTransaction</code> calling <code>approve()</code> on the {TOKEN_SYMBOL} contract.</>
            }
          </p>
        </div>
      </div>

      {/* ── Result ── */}
      {result && (
        <div className="result success">
          <div className="result-header">
            <span>{result.type === 'signature' ? '✅ Message Signed' : '✅ Approval Sent'}</span>
            <button
              className="result-copy"
              onClick={() => navigator.clipboard.writeText(result.value)}
            >
              copy
            </button>
          </div>
          <div className="result-label">From wallet</div>
          <code>{result.address}</code>
          <div className="result-label" style={{ marginTop: 8 }}>
            {result.type === 'signature' ? 'Signature' : 'Tx Hash'}
          </div>
          <code style={{ wordBreak: 'break-all' }}>{result.value}</code>
        </div>
      )}

      {error && (
        <div className="result error">
          <div className="result-label">❌ {error}</div>
        </div>
      )}

      {/* ── Action Button ── */}
      {!isActive && status !== 'success' && (
        <button
          className="btn primary full"
          onClick={generateQR}
          disabled={!client || (tab === 'approve' && !spender)}
        >
          {!client ? '⏳ Initializing...' : '⬡ Generate QR Code'}
        </button>
      )}

      {status === 'success' && (
        <button className="btn secondary full" onClick={reset}>
          ↺ Generate New QR
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
  
