import { NavigatorStateName } from '@/lib/crash/navigatorState'

export type NavigatorMessageBlock = {
  evidence_line: string
  action_line: string
  psychology_line: string
}

export const NAVIGATOR_MESSAGES_V1: Record<NavigatorStateName, NavigatorMessageBlock> = {
  STRUCTURAL_MODE: {
    evidence_line:
      'MA200 아래 장기 구간과 하락 고점 패턴이 누적되어 구조적 조정 흐름입니다. 단기 반등은 추세 전환이 아닐 수 있습니다.',
    action_line: '리스크 노출은 낮추고, 반등 추격보다는 생존 중심으로 대응합니다.',
    psychology_line:
      '예측이 아니라 환경 해석입니다. 구조적 조정은 시간이 필요합니다.',
  },
  NORMAL: {
    evidence_line: '급락 신호는 아직 뚜렷하지 않습니다. 변동은 정상 범위로 해석됩니다.',
    action_line: '기본 원칙을 유지하세요. 리스크 징후가 나오면 규칙대로 대응합니다.',
    psychology_line:
      '예측이 아니라 환경 해석입니다. 현재 목표는 생존이며, 서두를 필요는 없습니다.',
  },
  ACCELERATION_WATCH: {
    evidence_line: '단기 낙폭이 가팔라지고 있습니다. 속도 신호가 켜진 상태입니다.',
    action_line: '신규 매수는 잠시 중단하고, 방어 계획을 준비하세요.',
    psychology_line:
      '예측이 아니라 환경 해석입니다. 불안한 시기일수록 규칙이 도움이 됩니다.',
  },
  DEFENSE_MODE: {
    evidence_line: '하락 속도가 더 강해졌습니다. 방어 모드 진입 기준에 해당합니다.',
    action_line: '기본 방어 비중(약 70%)을 축소하고, 3일간 신규 매수는 멈추세요.',
    psychology_line:
      '예측이 아니라 환경 해석입니다. 이 프로토콜은 자본 보호와 스트레스 완화를 위한 초기 안전장치입니다.',
  },
  PANIC_EXTENSION: {
    evidence_line: '급락이 극단 구간으로 확장되었습니다.',
    action_line: '추가 행동은 최소화하고 관망하세요. 이미 방어 상태라면 그대로 유지합니다.',
    psychology_line:
      '예측이 아니라 환경 해석입니다. 공포 행동보다 규칙이 더 안정적입니다.',
  },
  STABILIZATION: {
    evidence_line: '최근 며칠간 저점 갱신이 멈추고 단기 흐름이 완화되었습니다.',
    action_line: '소량 탐색 매수 후 1~2일 안정 시 소폭 추가하세요. 새 저점이면 중단합니다.',
    psychology_line:
      '예측이 아니라 환경 해석입니다. 천천히 복귀하는 것이 장기 생존에 유리합니다.',
  },
}
