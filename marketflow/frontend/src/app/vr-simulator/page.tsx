import VRSimulatorDashboard from '@/components/vr-simulator/VRSimulatorDashboard'
import { getDefaultVrSymbol, listLocalVrDataSources } from '@/lib/backtest/localData'

export default async function VRSimulatorPage() {
  const sources = listLocalVrDataSources()
  const datasets = {} // Empty initially. VRSimulatorDashboard will fetch from /api/
  const defaultSymbol = getDefaultVrSymbol()

  return (
    <VRSimulatorDashboard
      sources={sources}
      datasets={datasets}
      defaultSymbol={defaultSymbol}
    />
  )
}
