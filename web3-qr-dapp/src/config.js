// src/config.js
import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import { mainnet, sepolia } from '@reown/appkit/networks'

// ① Get a free Project ID at https://cloud.walletconnect.com
export const projectId = '02e24ecc14c12e9d6cfe347f5ae22e78'

// ② Your wallet address — this is where payments go
//    Replace with your actual wallet address
export const MY_WALLET_ADDRESS = '0x32D35Edd6B3A9De3D63b7592446B199ac5877d1D'

// ③ ERC-20 token you want users to approve spending
//    Default: USDC on Ethereum mainnet
export const TOKEN_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
export const TOKEN_SYMBOL = 'USDC'

export const networks = [mainnet, sepolia]

export const wagmiAdapter = new WagmiAdapter({ projectId, networks })

createAppKit({
  adapters: [wagmiAdapter],
  networks,
  projectId,
  metadata: {
    name: 'Web3 QR dApp',
    description: 'Pay & Sign with your wallet',
    url: window.location.origin,
    icons: ['https://avatars.githubusercontent.com/u/179229932'],
  },
  features: { analytics: false, email: false, socials: [] },
})
        
