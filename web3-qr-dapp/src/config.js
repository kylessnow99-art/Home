// src/config.js
import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, bsc, sepolia } from '@reown/appkit/networks'

// ① Free Project ID from https://cloud.walletconnect.com
export const projectId = 'YOUR_PROJECT_ID_HERE'

// ② Your wallet — USDT payments land here
export const MY_WALLET_ADDRESS = '0xYOUR_WALLET_ADDRESS_HERE'

// ③ USDT contract addresses per chain
//    USDT uses 6 decimals on ETH, 18 decimals on BSC
export const USDT = {
  ethereum: {
    address:  '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    decimals: 6,
    chainId:  1,
    label:    'Ethereum',
    symbol:   'USDT (ERC-20)',
    explorer: 'https://etherscan.io/tx/',
    wcChain:  'eip155:1',
  },
  bsc: {
    address:  '0x55d398326f99059fF775485246999027B3197955',
    decimals: 18,
    chainId:  56,
    label:    'BNB Smart Chain',
    symbol:   'USDT (BEP-20)',
    explorer: 'https://bscscan.com/tx/',
    wcChain:  'eip155:56',
  },
}

// ④ Wagmi networks — sepolia for testing
export const networks = [mainnet, bsc, sepolia]

export const wagmiAdapter = new WagmiAdapter({ projectId, networks })

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: {
    name: 'Web3 QR dApp',
    description: 'Pay & Approve with USDT',
    url: window.location.origin,
    icons: ['https://avatars.githubusercontent.com/u/179229932'],
  },
  features: { analytics: false, email: false, socials: [] },
})
