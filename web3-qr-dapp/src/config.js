// src/config.js
//
// No AppKit needed anymore — we use SignClient directly
// so we control exactly when and how the QR is shown.

// ① Free Project ID from https://cloud.walletconnect.com
export const projectId = '02e24ecc14c12e9d6cfe347f5ae22e78'

// ② Your receiving wallet addresses per chain
export const MY_WALLETS = {
  ethereum: '0x32D35Edd6B3A9De3D63b7592446B199ac5877d1D',  // receives ERC-20 USDT
  bsc:      '0x32D35Edd6B3A9De3D63b7592446B199ac5877d1D',  // receives BEP-20 USDT
}

// ③ USDT contract addresses + chain config
export const CHAINS = {
  ethereum: {
    wcChain:  'eip155:1',
    label:    'Ethereum',
    symbol:   'USDT (ERC-20)',
    icon:     '⟠',
    explorer: 'https://etherscan.io/tx/',
    usdt: {
      address:  '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      decimals: 6,
    },
  },
  bsc: {
    wcChain:  'eip155:56',
    label:    'BNB Smart Chain',
    symbol:   'USDT (BEP-20)',
    icon:     '⬡',
    explorer: 'https://bscscan.com/tx/',
    usdt: {
      address:  '0x55d398326f99059fF775485246999027B3197955',
      decimals: 18,
    },
  },
}
