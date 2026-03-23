import type { TopicPack } from '@/types/researchSession'

export const TOPIC_PACKS: TopicPack[] = [
  {
    id:          'credit',
    title:       'Private Credit Stress',
    description: 'Liquidity mismatch, redemption pressure, collateral risk',
    queries: [
      'What is driving private credit stress in the current environment?',
      'Are redemption pressures increasing in private credit funds?',
      'Is current credit stress systemic or contained to specific segments?',
    ],
  },
  {
    id:          'semis',
    title:       'AI Capex / Semiconductors',
    description: 'AI demand vs valuation pressure in tech hardware',
    queries: [
      'Why are semiconductors under pressure and is it structural?',
      'Is AI capex slowing or being repriced by the market?',
      'Is this a correction or structural shift in semiconductor valuations?',
    ],
  },
  {
    id:          'liquidity',
    title:       'Liquidity / Funding Stress',
    description: 'Macro liquidity and funding conditions',
    queries: [
      'Is liquidity tightening in the current market environment?',
      'What is driving funding stress in short-term credit markets?',
      'Are we seeing early signs of a liquidity shock?',
    ],
  },
  {
    id:          'rates',
    title:       'Rates & Fed Policy',
    description: 'Interest rate path, Fed communication, yield curve',
    queries: [
      'What is the current Fed policy outlook and market pricing?',
      'How is the yield curve behaving and what does it signal?',
      'Is the market correctly pricing rate cut expectations?',
    ],
  },
  {
    id:          'leverage',
    title:       'Leveraged ETF Risk (TQQQ)',
    description: 'Volatility decay, regime risk, VR engine context',
    queries: [
      'What are the key risks to holding TQQQ in the current regime?',
      'How does volatility decay affect leveraged ETF performance in bear markets?',
      'What historical precedents exist for the current VR engine state?',
    ],
  },
]
