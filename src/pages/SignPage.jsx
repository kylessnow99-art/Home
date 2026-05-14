// src/pages/SignPage.jsx
//
// ── HOW THIS WORKS ────────────────────────────────────────────────────────────
// Unlike the Payment page, this page needs the OTHER person to connect
// their wallet to YOUR dApp. The flow:
//
//   1. They click Connect (appkit-button) → AppKit generates a WalletConnect URI
//   2. AppKit shows a QR code inside the modal
//   3. They scan it with their wallet app
//   4. Their wallet sends a session_proposal through the relay
//   5. They approve → session is live
//   6. NOW you can send them requests:
//      - personal_sign  → they sign a message, you get the signature
//      - eth_sendTransaction with approve() data → they approve token spend
//
// Both requests go encrypted through the relay to their wallet.
// Their wallet shows a confirmation screen for each one.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from 'react'
import { useAccount, useSignMessage, useWriteContract, useDisconnect } from 'wagmi'
import { parseUnits, encodeFunctionData } from 'viem'
import { TOKEN_ADDRESS, TOKEN_SYMBOL } from '../config.js'

// Minimal ERC-20 ABI — only the approve function
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount',  type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
]

// ── Tab: Sign Message ─────────────────────────────────────────────────────────
function SignTab() {
  const [message, setMessage] = useState('I authorize this action.\n\nSigned via Web3 QR dApp.')
  const { signMessage, data: signature, isPending, error, reset } = useSignMessage()

  // personal_sign encodes the message as:
  // "\x19Ethereum Signed Message:\n" + len(message) + message
  // This prevents signing actual transactions accidentally.

  return (
    <div className="tab-content">
      <div className="mechanic-box">
        <div className="mechanic-title">🔬 What happens when they sign</div>
        <p>
          Your dApp sends a <code>personal_sign</code> request through the relay.
          Their wallet displays the message and asks for approval.
          The signature proves they own the wallet — no gas, no on-chain action.
          You can verify it server-side with <code>ecrecover</code>.
        </p>
      </div>

      <div className="input-group">
        <label>Message to sign</label>
        <textarea
          rows={4}
          value={message}
          onChange={e => { setMessage(e.target.value); reset?.() }}
          placeholder="Type any message..."
        />
      </div>

      <button
        className="btn primary full"
        disabled={isPending || !message}
        onClick={() => signMessage({ message })}
      >
        {isPending ? '⏳ Waiting for wallet approval...' : '✍️ Request Signature'}
      </button>

      {signature && (
        <div className="result success">
          <div className="result-header">
            <span>✅ Signed successfully</span>
            <button className="result-copy" onClick={() => navigator.clipboard.writeText(signature)}>
              copy
            </button>
          </div>
          <div className="result-label">Signature (ECDSA)</div>
          <code>{signature.slice(0, 42)}...{signature.slice(-8)}</code>
          <div className="result-label" style={{marginTop:8}}>Full length</div>
          <code>{signature.length} chars / 65 bytes</code>
          <div className="verify-hint">
            Verify server-side with: <code>viem.verifyMessage(&#123; address, message, signature &#125;)</code>
          </div>
        </div>
      )}

      {error && (
        <div className="result error">
          <div className="result-label">❌ {error.shortMessage ?? error.message}</div>
        </div>
      )}
    </div>
  )
}

// ── Tab: ERC-20 Approve ───────────────────────────────────────────────────────
function ApproveTab() {
  const { address } = useAccount()
  const [spender, setSpender] = useState('')
  const [amount, setAmount] = useState('100')
  const { writeContract, data: txHash, isPending, error, reset } = useWriteContract()

  // ERC-20 approve(spender, amount) lets `spender` pull up to `amount`
  // of tokens FROM the connected wallet. Common in DeFi:
  // "Approve Uniswap to spend my USDC before I swap"

  const handleApprove = () => {
    if (!spender || !amount) return
    writeContract({
      address: TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spender, parseUnits(amount, 6)], // USDC has 6 decimals
    })
  }

  return (
    <div className="tab-content">
      <div className="mechanic-box">
        <div className="mechanic-title">🔬 What happens when they approve</div>
        <p>
          Your dApp calls <code>approve(spender, amount)</code> on the {TOKEN_SYMBOL} contract.
          This is an on-chain transaction — it costs a small gas fee.
          Their wallet shows: contract address, spender, and amount to approve.
          After approval, the spender address can pull up to that amount of
          {' '}{TOKEN_SYMBOL} from their wallet without further prompts.
        </p>
      </div>

      <div className="input-group">
        <label>Spender address <span className="label-hint">(who gets approved to spend)</span></label>
        <input
          value={spender}
          onChange={e => { setSpender(e.target.value); reset?.() }}
          placeholder="0x... (your contract or your address)"
        />
      </div>

      <div className="input-group">
        <label>Amount <span className="label-hint">({TOKEN_SYMBOL})</span></label>
        <div className="amount-row">
          <input
            type="number"
            value={amount}
            min="0"
            onChange={e => { setAmount(e.target.value); reset?.() }}
          />
          <span className="currency">{TOKEN_SYMBOL}</span>
        </div>
      </div>

      <div className="token-info">
        <div className="token-row">
          <span>Token contract</span>
          <code>{TOKEN_ADDRESS.slice(0,6)}...{TOKEN_ADDRESS.slice(-4)}</code>
        </div>
        <div className="token-row">
          <span>Function call</span>
          <code>approve({spender ? spender.slice(0,6)+'...' : '0x...'}, {amount || '0'} {TOKEN_SYMBOL})</code>
        </div>
        <div className="token-row">
          <span>Network action</span>
          <code>On-chain tx — costs gas</code>
        </div>
      </div>

      <button
        className="btn primary full"
        disabled={isPending || !spender || !amount}
        onClick={handleApprove}
      >
        {isPending ? '⏳ Waiting for wallet approval...' : `🔓 Request ${TOKEN_SYMBOL} Approval`}
      </button>

      {txHash && (
        <div className="result success">
          <div className="result-header">
            <span>✅ Approved on-chain</span>
            <a
              href={`https://etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="result-copy"
            >
              etherscan ↗
            </a>
          </div>
          <div className="result-label">Transaction Hash</div>
          <code>{txHash}</code>
        </div>
      )}

      {error && (
        <div className="result error">
          <div className="result-label">❌ {error.shortMessage ?? error.message}</div>
        </div>
      )}
    </div>
  )
}

// ── Main Sign Page ────────────────────────────────────────────────────────────
export default function SignPage() {
  const { isConnected, address } = useAccount()
  const { disconnect } = useDisconnect()
  const [tab, setTab] = useState('sign')

  const shortAddr = address
    ? address.slice(0, 6) + '...' + address.slice(-4)
    : ''

  return (
    <div className="page sign-page">
      <div className="page-header">
        <div className="page-tag">PAGE 02</div>
        <h1>Sign & Approve</h1>
        <p className="page-desc">
          The other person connects their wallet by scanning a WalletConnect QR.
          Once connected, you can request a signature or a token approval — 
          their wallet handles the confirmation.
        </p>
      </div>

      {!isConnected ? (
        /* ── NOT CONNECTED ── */
        <div className="connect-section">
          <div className="connect-steps">
            <div className="c-step">
              <div className="c-step-num">1</div>
              <div>Click Connect below → WalletConnect modal opens with a QR</div>
            </div>
            <div className="c-step">
              <div className="c-step-num">2</div>
              <div>The other person scans it with MetaMask / Trust / any wallet</div>
            </div>
            <div className="c-step">
              <div className="c-step-num">3</div>
              <div>They tap Approve → session is live, requests appear below</div>
            </div>
          </div>

          {/* appkit-button opens the modal with the WalletConnect QR inside */}
          <div className="connect-btn-wrap">
            <appkit-button label="Connect Wallet to Continue" />
          </div>
        </div>
      ) : (
        /* ── CONNECTED ── */
        <>
          <div className="connected-bar">
            <div className="connected-dot" />
            <span className="connected-addr">{shortAddr}</span>
            <span className="connected-label">connected</span>
            <button className="disconnect-btn" onClick={() => disconnect()}>
              disconnect
            </button>
          </div>

          {/* Tab switcher */}
          <div className="tabs">
            <button
              className={`tab-btn ${tab === 'sign' ? 'active' : ''}`}
              onClick={() => setTab('sign')}
            >
              ✍️ Sign Message
            </button>
            <button
              className={`tab-btn ${tab === 'approve' ? 'active' : ''}`}
              onClick={() => setTab('approve')}
            >
              🔓 Token Approve
            </button>
          </div>

          {tab === 'sign' ? <SignTab /> : <ApproveTab />}
        </>
      )}
    </div>
  )
  }
  
