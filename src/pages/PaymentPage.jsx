// src/pages/PaymentPage.jsx
//
// ── HOW THIS WORKS ────────────────────────────────────────────────────────────
// A payment QR is just a static string encoded as a QR image.
// The string follows the EIP-681 URI standard:
//   ethereum:<address>?value=<amount_in_wei>
//
// No wallet connection. No relay. No session.
// Anyone who scans it gets the address + amount pre-filled in their wallet.
// The QR regenerates every time the amount changes.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import { MY_WALLET_ADDRESS } from '../config.js'

// Convert ETH string → wei hex string (for EIP-681 URI)
function ethToWei(ethAmount) {
  try {
    const val = parseFloat(ethAmount)
    if (isNaN(val) || val <= 0) return null
    // 1 ETH = 1e18 wei — use BigInt to avoid float precision issues
    const wei = BigInt(Math.round(val * 1e18))
    return wei.toString()
  } catch { return null }
}

// Build the EIP-681 payment URI
// Format: ethereum:<address>@<chainId>?value=<wei>
function buildPaymentURI(address, ethAmount, chainId = 1) {
  const wei = ethToWei(ethAmount)
  if (!wei) return `ethereum:${address}`
  return `ethereum:${address}@${chainId}?value=${wei}`
}

export default function PaymentPage() {
  const [amount, setAmount] = useState('')
  const [network, setNetwork] = useState('1')        // 1=mainnet, 11155111=sepolia
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied] = useState(false)
  const canvasRef = useRef(null)

  const uri = buildPaymentURI(MY_WALLET_ADDRESS, amount, network)
  const shortAddr = MY_WALLET_ADDRESS.slice(0, 6) + '...' + MY_WALLET_ADDRESS.slice(-4)

  // Regenerate QR whenever URI changes
  useEffect(() => {
    QRCode.toDataURL(uri, {
      width: 280,
      margin: 2,
      color: { dark: '#0a0f1a', light: '#f0f4ff' },
      errorCorrectionLevel: 'M',
    }).then(setQrDataUrl).catch(console.error)
  }, [uri])

  const copyAddress = () => {
    navigator.clipboard.writeText(MY_WALLET_ADDRESS)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadQR = () => {
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `payment-qr-${amount || 'open'}eth.png`
    a.click()
  }

  return (
    <div className="page payment-page">
      {/* ── Page header ── */}
      <div className="page-header">
        <div className="page-tag">PAGE 01</div>
        <h1>Payment QR</h1>
        <p className="page-desc">
          Set an amount — the QR updates live. Anyone who scans it gets your
          wallet pre-filled in their app. No connection required on your end.
        </p>
      </div>

      {/* ── Amount input ── */}
      <div className="input-group">
        <label>Amount <span className="label-hint">(leave blank for open amount)</span></label>
        <div className="amount-row">
          <input
            type="number"
            placeholder="0.00"
            value={amount}
            min="0"
            step="0.001"
            onChange={e => setAmount(e.target.value)}
          />
          <span className="currency">ETH</span>
        </div>
      </div>

      <div className="input-group">
        <label>Network</label>
        <select value={network} onChange={e => setNetwork(e.target.value)}>
          <option value="1">Ethereum Mainnet</option>
          <option value="11155111">Sepolia Testnet</option>
          <option value="137">Polygon</option>
        </select>
      </div>

      {/* ── QR Display ── */}
      <div className="qr-card">
        <div className="qr-label">
          {amount ? `${amount} ETH` : 'Open amount'}
          <span className="qr-network">
            {network === '1' ? 'Mainnet' : network === '137' ? 'Polygon' : 'Sepolia'}
          </span>
        </div>

        {qrDataUrl ? (
          <img src={qrDataUrl} alt="Payment QR" className="qr-image" />
        ) : (
          <div className="qr-placeholder">Generating...</div>
        )}

        <div className="qr-address" onClick={copyAddress}>
          <span className="addr-text">{shortAddr}</span>
          <span className="copy-btn">{copied ? '✓ copied' : 'tap to copy'}</span>
        </div>
      </div>

      {/* ── URI breakdown (educational) ── */}
      <div className="uri-breakdown">
        <div className="uri-label">EIP-681 URI being encoded</div>
        <code className="uri-string">{uri}</code>
        <div className="uri-parts">
          <div className="uri-part">
            <span className="part-key">scheme</span>
            <span className="part-val">ethereum:</span>
          </div>
          <div className="uri-part">
            <span className="part-key">address</span>
            <span className="part-val">{shortAddr}</span>
          </div>
          <div className="uri-part">
            <span className="part-key">chain</span>
            <span className="part-val">@{network}</span>
          </div>
          {amount && (
            <div className="uri-part">
              <span className="part-key">value (wei)</span>
              <span className="part-val">{ethToWei(amount) ?? '—'}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="action-row">
        <button className="btn primary" onClick={downloadQR} disabled={!qrDataUrl}>
          ↓ Download QR
        </button>
        <button className="btn secondary" onClick={copyAddress}>
          {copied ? '✓ Copied' : '⎘ Copy Address'}
        </button>
      </div>
    </div>
  )
      }
  
