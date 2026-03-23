import type {
  VrActionClass,
  VrActionPolicyDebug,
  VrActionPolicyResult,
  VrActionPermission,
  VrGatedAction,
} from '../types/vrAction';
import type { VrRuntimePolicyResult } from '../types/vrRuntimePolicy';

// =============================================================================
// vrActionModel.ts  (WO-SA10)
//
// 목적: VrRuntimePolicyResult → 액션 클래스별 명시적 허용/제한/차단 권한 모델
//
// 규칙:
//   - 모드 맵 우선, 게이트 일관성 오버라이드 적용
//   - shock / structural 하드닝 오버레이 마지막 적용
//   - VR 코어 실행 로직 수정 없음
//   - 결정론적 매핑 전용
// =============================================================================

// =============================================================================
// MODE-TO-ACTION PERMISSION MAP
// =============================================================================

type PermissionsMap = {
  base_buy:        VrActionPermission;
  rebound_buy:     VrActionPermission;
  aggressive_add:  VrActionPermission;
  defensive_buy:   VrActionPermission;
  maintenance_buy: VrActionPermission;
  reduce_risk:     'ALLOW' | 'PRIORITIZE';
};

function resolveBasePermissions(mode: string): { perms: PermissionsMap; rule: string } {
  if (mode === 'LOCKDOWN') {
    return {
      rule: 'mode=LOCKDOWN',
      perms: {
        base_buy:        'BLOCK',
        rebound_buy:     'BLOCK',
        aggressive_add:  'BLOCK',
        defensive_buy:   'BLOCK',
        maintenance_buy: 'BLOCK',
        reduce_risk:     'PRIORITIZE',
      },
    };
  }
  if (mode === 'DEFENSIVE') {
    return {
      rule: 'mode=DEFENSIVE',
      perms: {
        base_buy:        'BLOCK',
        rebound_buy:     'BLOCK',
        aggressive_add:  'BLOCK',
        defensive_buy:   'LIMIT',
        maintenance_buy: 'LIMIT',
        reduce_risk:     'PRIORITIZE',
      },
    };
  }
  if (mode === 'LIMITED') {
    return {
      rule: 'mode=LIMITED',
      perms: {
        base_buy:        'LIMIT',
        rebound_buy:     'LIMIT',
        aggressive_add:  'BLOCK',
        defensive_buy:   'ALLOW',
        maintenance_buy: 'LIMIT',
        reduce_risk:     'ALLOW',
      },
    };
  }
  // NORMAL
  return {
    rule: 'mode=NORMAL',
    perms: {
      base_buy:        'ALLOW',
      rebound_buy:     'ALLOW',
      aggressive_add:  'LIMIT',
      defensive_buy:   'ALLOW',
      maintenance_buy: 'ALLOW',
      reduce_risk:     'ALLOW',
    },
  };
}

// =============================================================================
// MODE-TO-SIZING PROFILE MAP
// =============================================================================

function resolveBaseSizing(mode: string): Record<string, number> {
  if (mode === 'LOCKDOWN') {
    return { base_buy_pct: 0, rebound_buy_pct: 0, aggressive_add_pct: 0, defensive_buy_pct: 0, maintenance_buy_pct: 0 };
  }
  if (mode === 'DEFENSIVE') {
    return { base_buy_pct: 0, rebound_buy_pct: 0, aggressive_add_pct: 0, defensive_buy_pct: 35, maintenance_buy_pct: 20 };
  }
  if (mode === 'LIMITED') {
    return { base_buy_pct: 50, rebound_buy_pct: 40, aggressive_add_pct: 0, defensive_buy_pct: 70, maintenance_buy_pct: 50 };
  }
  // NORMAL
  return { base_buy_pct: 100, rebound_buy_pct: 100, aggressive_add_pct: 60, defensive_buy_pct: 100, maintenance_buy_pct: 100 };
}

// =============================================================================
// GATE CONSISTENCY OVERRIDE
// =============================================================================

type GateConsistencyResult = { perms: PermissionsMap; rule: string };

function applyGateConsistency(
  perms: PermissionsMap,
  buyGate: string,
  reboundGate: string,
  addExposureGate: string,
): GateConsistencyResult {
  const rules: string[] = [];
  const out = { ...perms };

  // buy_gate = BLOCKED → base_buy + aggressive_add must be BLOCK
  if (buyGate === 'BLOCKED') {
    if (out.base_buy !== 'BLOCK')       { out.base_buy = 'BLOCK';       rules.push('buy_gate=BLOCKED→base_buy=BLOCK'); }
    if (out.aggressive_add !== 'BLOCK') { out.aggressive_add = 'BLOCK'; rules.push('buy_gate=BLOCKED→aggressive_add=BLOCK'); }
  }

  // rebound_gate = BLOCKED → rebound_buy must be BLOCK
  if (reboundGate === 'BLOCKED') {
    if (out.rebound_buy !== 'BLOCK') { out.rebound_buy = 'BLOCK'; rules.push('rebound_gate=BLOCKED→rebound_buy=BLOCK'); }
  }

  // add_exposure_gate = BLOCKED → aggressive_add must be BLOCK
  if (addExposureGate === 'BLOCKED') {
    if (out.aggressive_add !== 'BLOCK') { out.aggressive_add = 'BLOCK'; rules.push('add_exposure_gate=BLOCKED→aggressive_add=BLOCK'); }
  }

  // add_exposure_gate = LIMITED → aggressive_add at most LIMIT
  if (addExposureGate === 'LIMITED' && out.aggressive_add === 'ALLOW') {
    out.aggressive_add = 'LIMIT';
    rules.push('add_exposure_gate=LIMITED→aggressive_add=LIMIT');
  }

  return { perms: out, rule: rules.length ? rules.join('; ') : 'no_gate_override' };
}

// =============================================================================
// SHOCK HARDENING OVERLAY
// =============================================================================

type HardeningResult = { perms: PermissionsMap; sizing: Record<string, number>; rule: string };

function applyShockHardening(
  perms: PermissionsMap,
  sizing: Record<string, number>,
  shockFlag: boolean,
): HardeningResult {
  if (!shockFlag) return { perms, sizing, rule: 'shock_flag=false' };
  const rules: string[] = [];
  const out = { ...perms };
  const sz  = { ...sizing };

  // rebound_buy cannot be ALLOW
  if (out.rebound_buy === 'ALLOW') { out.rebound_buy = 'LIMIT'; rules.push('shock→rebound_buy max=LIMIT'); }
  // aggressive_add must be BLOCK
  if (out.aggressive_add !== 'BLOCK') { out.aggressive_add = 'BLOCK'; rules.push('shock→aggressive_add=BLOCK'); }
  // cap rebound_buy_pct at 20
  if (sz.rebound_buy_pct > 20) { sz.rebound_buy_pct = 20; rules.push('shock→rebound_buy_pct cap=20'); }
  // if mode is DEFENSIVE or LOCKDOWN, rebound_buy_pct = 0
  if (sz.rebound_buy_pct > 0 && (out.rebound_buy === 'BLOCK')) {
    sz.rebound_buy_pct = 0;
    rules.push('shock+BLOCK→rebound_buy_pct=0');
  }

  return { perms: out, sizing: sz, rule: rules.join('; ') || 'shock_flag=true_no_change_needed' };
}

// =============================================================================
// STRUCTURAL HARDENING OVERLAY
// =============================================================================

function applyStructuralHardening(
  perms: PermissionsMap,
  buyGate: string,
  mode: string,
  structuralRiskFlag: boolean,
): { perms: PermissionsMap; rule: string } {
  if (!structuralRiskFlag) return { perms, rule: 'structural_risk_flag=false' };
  const rules: string[] = [];
  const out = { ...perms };

  // aggressive_add cannot be ALLOW
  if (out.aggressive_add === 'ALLOW') { out.aggressive_add = 'LIMIT'; rules.push('structural→aggressive_add max=LIMIT'); }

  // base_buy cannot be ALLOW unless NORMAL + buy_gate=OPEN
  if (out.base_buy === 'ALLOW' && !(mode === 'NORMAL' && buyGate === 'OPEN')) {
    out.base_buy = 'LIMIT';
    rules.push('structural→base_buy max=LIMIT');
  }

  // reduce_risk must be at least ALLOW
  if (out.reduce_risk !== 'PRIORITIZE') {
    // already ALLOW — no change needed
    rules.push('structural→reduce_risk>=ALLOW (already satisfied)');
  }

  return { perms: out, rule: rules.join('; ') || 'structural_flag=true_no_change_needed' };
}

// =============================================================================
// ACTION SUMMARY / REASON
// =============================================================================

function buildActionSummary(mode: string, perms: PermissionsMap): string {
  if (mode === 'LOCKDOWN')  return 'LOCKDOWN: 모든 매수·추가 진입이 차단됩니다. 감축/보유만 허용됩니다.';
  if (mode === 'DEFENSIVE') return 'DEFENSIVE: 신규 매수는 차단되고 방어적 제한 매수만 허용됩니다. 감축 우선.';
  if (mode === 'LIMITED') {
    const bFlag = perms.rebound_buy === 'BLOCK' ? ' 반등 매수는 차단.' : '';
    return `LIMITED: 기본 매수와 방어 매수는 제한 허용됩니다.${bFlag} 적극적 추가는 차단.`;
  }
  return 'NORMAL: 기본 매수·반등·방어 매수가 허용됩니다. 과도한 추가만 제한됩니다.';
}

function buildActionReason(mode: string, shockFlag: boolean, structuralRiskFlag: boolean): string {
  const parts: string[] = [];
  if (mode === 'LOCKDOWN')  parts.push('정책 상태가 LOCKDOWN 수준으로 최강 제한이 적용됩니다.');
  else if (mode === 'DEFENSIVE') parts.push('방어 모드로 리스크 감축을 우선합니다.');
  else if (mode === 'LIMITED') parts.push('제한적 참여만 허용되는 신중한 실행 상태입니다.');
  else parts.push('정상 범위 실행이 허용됩니다.');
  if (shockFlag)         parts.push('충격 플래그로 반등 추격이 추가 억제됩니다.');
  if (structuralRiskFlag) parts.push('구조적 리스크로 적극적 추가는 제한됩니다.');
  return parts.join(' ');
}

// =============================================================================
// PUBLIC API
// =============================================================================

export function buildVrActionPolicy(vr: VrRuntimePolicyResult): {
  result: VrActionPolicyResult;
  debug: VrActionPolicyDebug;
} {
  const mode         = vr.runtime_mode;
  const shockFlag    = false; // not directly available — caller should pass from vr_policy if needed
  const structuralRiskFlag = false; // same

  // Step 1: mode map
  const { perms: basePerms, rule: modeRule } = resolveBasePermissions(mode);
  const baseSizing = resolveBaseSizing(mode);

  // Step 2: gate consistency
  const { perms: gatedPerms, rule: gateRule } = applyGateConsistency(
    basePerms, vr.buy_gate, vr.rebound_gate, vr.add_exposure_gate,
  );

  // Step 3: shock hardening (shock/structural not in VrRuntimePolicyResult — derived from continuation_pressure)
  // Use continuation_pressure as proxy: >=60 implies shock-like hardening for rebound
  const derivedShock = vr.continuation_pressure >= 60 || vr.defensive_bias >= 85;
  const { perms: shockPerms, sizing: shockSizing, rule: shockRule } = applyShockHardening(
    gatedPerms, baseSizing, derivedShock,
  );

  // Step 4: structural hardening — use sizing_bias as proxy: <=20 implies structural risk
  const derivedStructural = vr.sizing_bias <= 20 && mode !== 'LOCKDOWN';
  const { perms: finalPerms, rule: structuralRule } = applyStructuralHardening(
    shockPerms, vr.buy_gate, mode, derivedStructural,
  );

  const actionSummary = buildActionSummary(mode, finalPerms);
  const actionReason  = buildActionReason(mode, derivedShock, derivedStructural);

  return {
    result: {
      runtime_mode: mode,
      permissions: {
        base_buy:        finalPerms.base_buy,
        rebound_buy:     finalPerms.rebound_buy,
        aggressive_add:  finalPerms.aggressive_add,
        defensive_buy:   finalPerms.defensive_buy,
        maintenance_buy: finalPerms.maintenance_buy,
        reduce_risk:     finalPerms.reduce_risk,
        hold:            'ALLOW',
      },
      sizing_profile: {
        base_buy_pct:        shockSizing.base_buy_pct,
        rebound_buy_pct:     shockSizing.rebound_buy_pct,
        aggressive_add_pct:  shockSizing.aggressive_add_pct,
        defensive_buy_pct:   shockSizing.defensive_buy_pct,
        maintenance_buy_pct: shockSizing.maintenance_buy_pct,
      },
      action_summary: actionSummary,
      action_reason:  actionReason,
    },
    debug: {
      mode_rule:               modeRule,
      gate_consistency_rule:   gateRule,
      shock_override_rule:     shockRule,
      structural_override_rule: structuralRule,
    },
  };
}

// =============================================================================
// CANDIDATE ACTION GATE HELPER
// =============================================================================

export function applyVrActionPolicy(
  actionClass: VrActionClass,
  policy: VrActionPolicyResult,
): VrGatedAction {
  const { permissions: p, sizing_profile: sz } = policy;

  let permission: string;
  let sizingCapPct: number;

  switch (actionClass) {
    case 'BASE_BUY':
      permission   = p.base_buy;
      sizingCapPct = sz.base_buy_pct;
      break;
    case 'REBOUND_BUY':
      permission   = p.rebound_buy;
      sizingCapPct = sz.rebound_buy_pct;
      break;
    case 'AGGRESSIVE_ADD':
      permission   = p.aggressive_add;
      sizingCapPct = sz.aggressive_add_pct;
      break;
    case 'DEFENSIVE_BUY':
      permission   = p.defensive_buy;
      sizingCapPct = sz.defensive_buy_pct;
      break;
    case 'MAINTENANCE_BUY':
      permission   = p.maintenance_buy;
      sizingCapPct = sz.maintenance_buy_pct;
      break;
    case 'REDUCE_RISK':
      permission   = p.reduce_risk;
      sizingCapPct = 100;
      break;
    case 'HOLD':
    default:
      permission   = 'ALLOW';
      sizingCapPct = 100;
      break;
  }

  const blocked = permission === 'BLOCK';
  const limited = permission === 'LIMIT';
  const note    = blocked
    ? `${actionClass} is blocked in ${policy.runtime_mode} mode`
    : limited
    ? `${actionClass} limited to ${sizingCapPct}% of candidate size`
    : permission === 'PRIORITIZE'
    ? `${actionClass} prioritized — mark preferred in runtime log`
    : `${actionClass} allowed at up to ${sizingCapPct}% size`;

  return {
    action_class:   actionClass,
    permission:     permission as VrGatedAction['permission'],
    sizing_cap_pct: sizingCapPct,
    blocked,
    limited,
    note,
  };
}
