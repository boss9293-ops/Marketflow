import VRSimulatorDashboard from '@/components/vr-simulator/VRSimulatorDashboard'
import { getDefaultVrSymbol, listLocalVrDataSources, loadLocalVrDataMap } from '@/lib/backtest/localData'

export default async function VRSimulatorPage() {
  const sources = listLocalVrDataSources()
  const datasets = await loadLocalVrDataMap()
  const defaultSymbol = getDefaultVrSymbol()

  return (
    <VRSimulatorDashboard
      sources={sources}
      datasets={datasets}
      defaultSymbol={defaultSymbol}
    />
  )
}
