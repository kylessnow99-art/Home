// src/App.jsx
import { useState } from 'react'
import PaymentPage from './pages/PaymentPage.jsx'
import SignPage from './pages/SignPage.jsx'

export default function App() {
  const [page, setPage] = useState('payment')

  return (
    <div className="app">
      {/* ── Nav ── */}
      <header>
        <div className="logo">⬡ Web3 QR</div>
        <nav>
          <button
            className={`nav-btn ${page === 'payment' ? 'active' : ''}`}
            onClick={() => setPage('payment')}
          >
            <span>01</span> Pay
          </button>
          <button
            className={`nav-btn ${page === 'sign' ? 'active' : ''}`}
            onClick={() => setPage('sign')}
          >
            <span>02</span> Sign & Approve
          </button>
        </nav>
      </header>

      <main>
        {page === 'payment' ? <PaymentPage /> : <SignPage />}
      </main>

      <footer>
        <div className="footer-note">
          {page === 'payment'
            ? 'Static QR — no wallet connection needed to generate'
            : 'WalletConnect v2 — encrypted relay session'}
        </div>
      </footer>
    </div>
  )
}
