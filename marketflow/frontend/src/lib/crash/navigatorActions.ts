import { NavigatorStateName } from '@/lib/crash/navigatorState'

export type NavigatorActionBlock = {
  DO_NOW: string[]
  DONT_DO: string[]
  NEXT_CHECK: string[]
}

export const NAVIGATOR_ACTIONS_V1: Record<NavigatorStateName, NavigatorActionBlock> = {
  STRUCTURAL_MODE: {
    DO_NOW: [
      'Reduce discretionary risk exposure',
      'Maintain higher cash buffer',
      'Prioritize capital preservation over speed',
    ],
    DONT_DO: ['Chase short rebounds as trend reversal'],
    NEXT_CHECK: ['Wait for MA200 reclaim and higher-high confirmation'],
  },
  NORMAL: {
    DO_NOW: ['Maintain normal exposure discipline'],
    DONT_DO: ['Ignore risk shifts if acceleration appears'],
    NEXT_CHECK: ['Monitor ret_2d/ret_3d for acceleration signals'],
  },
  ACCELERATION_WATCH: {
    DO_NOW: [
      'Pause new buys',
      'Prepare stop/defense setup (user action or auto-order hint)',
    ],
    DONT_DO: ['Averaging down aggressively'],
    NEXT_CHECK: ['If tomorrow ret_2d <= -12 OR ret_3d <= -15 -> DEFENSE_MODE'],
  },
  DEFENSE_MODE: {
    DO_NOW: [
      'Sell 70% (base)',
      'If ret_3d <= -18% then Full Defense (100%)',
      'Enter LOCK for 3 days (no new buys)',
    ],
    DONT_DO: ['Re-buy immediately on 1 green day'],
    NEXT_CHECK: ['Watch for PANIC_EXTENSION or STABILIZATION conditions'],
  },
  PANIC_EXTENSION: {
    DO_NOW: ['No further sell (already defended)', 'Observe only'],
    DONT_DO: ['Chase bounce / panic actions'],
    NEXT_CHECK: ['Stabilization triggers'],
  },
  STABILIZATION: {
    DO_NOW: [
      'Probe buy 10% of pool',
      'After 1-2 days stability -> add 5%',
      'If fake bounce (new low occurs after probe) -> pause (no adds)',
      'If recovery resumes -> add 5% again',
    ],
    DONT_DO: ['Full redeploy instantly'],
    NEXT_CHECK: ['Confirm higher-low / MA reclaim (optional later)'],
  },
}
