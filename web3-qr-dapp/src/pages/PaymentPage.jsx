// src/pages/PaymentPage.jsx
//
// ── HOW THIS WORKS ────────────────────────────────────────────────────────────
// A payment QR is just a static string encoded as a QR image.
// The string follows the EIP-681 URI standard:
//   ethereum:<address>@<chainId>?value=<amount_in_wei>
//
// No wallet connection. No relay. No session.
// Anyone who scans it gets your address + amount pre-filled in their wallet.
// The QR regenerates live whenever chain or amount changes.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect } from 'react'
import QRCode from 'qrcode'
import { MY_WALLETS } from '../config.js'

// Chain config — chain ID is used in the EIP-681 URI
const CHAINS = {
  ethereum: { chainId: '1',  label: 'Ethereum',         sub: 'ERC-20 USDT', icon: '⟠' },
  bsc:      { chainId: '56', label: 'BNB Smart Chain',  sub: 'BEP-20 USDT', icon: '⬡' },
}

// Convert a USDT amount string → smallest unit string
// USDT on ETH = 6 decimals, BSC = 18 decimals
function usdtToSmallestUnit(amount, chain) {
  try {
    const val = parseFloat(amount)
    if (isNaN(val) || val <= 0) return null
    const decimals = chain === 'bsc' ? 18 : 6
    const unit = BigInt(Math.round(val * 10 ** decimals))
    return unit.toString()
  } catch { return null }
}

// EIP-681 URI — wallets parse this to pre-fill recipient + amount
function buildPaymentURI(address, amount, chain) {
  const { chainId } = CHAINS[chain]
  const units = usdtToSmallestUnit(amount, chain)
  if (!units) return `ethereum:${address}@${chainId}`
  return `ethereum:${address}@${chainId}?value=${units}`
}

export default function PaymentPage() {
  const [chain, setChain]       = useState('ethereum')
  const [amount, setAmount]     = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [copied, setCopied]     = useState(false)

  const walletAddress = MY_WALLETS[chain]
  const shortAddr     = walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4)
  const uri           = buildPaymentURI(walletAddress, amount, chain)
  const chainInfo     = CHAINS[chain]

  // Regenerate QR whenever URI changes
  useEffect(() => {
    QRCode.toDataURL(uri, {
      width: 280,
      margin: 2,
      color: { dark: '#05080f', light: '#f0f4ff' },
      errorCorrectionLevel: 'M',
    }).then(setQrDataUrl).catch(console.error)
  }, [uri])

  const copyAddress = () => {
    navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const downloadQR = () => {
    const a = document.createElement('a')
    a.href = qrDataUrl
    a.download = `payment-qr-${chain}-${amount || 'open'}-usdt.png`
    a.click()
  }

  return (
    <div className="page payment-page">

      {/* ── Page header ── */}
      <div className="page-header">
        <div className="page-tag">PAGE 01</div>
        <h1>Payment QR</h1>
        <p className="page-desc">
          Pick a chain, set an amount — QR updates live. Anyone who scans it
          gets your wallet address pre-filled in their app. No connection needed.
        </p>
      </div>

      {/* ── Chain selector ── */}
      <div className="input-group">
        <label>Chain</label>
        <div className="chain-selector">
          {Object.entries(CHAINS).map(([key, val]) => (
            <button
              key={key}
              className={`chain-btn ${chain === key ? 'active' : ''}`}
              onClick={() => setChain(key)}
            >
              <span className="chain-icon">{val.icon}</span>
              <span>{val.label}</span>
              <span className="chain-sub">{val.sub}</span>
            </button>
          ))}
        </div>
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
            step="1"
            onChange={e => setAmount(e.target.value)}
          />
          <span className="currency">USDT</span>
        </div>
      </div>

      {/* ── QR Display ── */}
      <div className="qr-card">
        <div className="qr-label">
          {amount ? `${amount} USDT` : 'Open amount'}
          <span className="qr-network">{chainInfo.label}</span>
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

      {/* ── URI breakdown ── */}
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
            <span className="part-key">chain ID</span>
            <span className="part-val">@{chainInfo.chainId}</span>
          </div>
          {amount && (
            <div className="uri-part">
              <span className="part-key">value (units)</span>
              <span className="part-val">{usdtToSmallestUnit(amount, chain) ?? '—'}</span>
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
  
