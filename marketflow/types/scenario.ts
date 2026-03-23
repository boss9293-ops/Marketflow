export type ScenarioPath = 'REBOUND' | 'SIDEWAYS' | 'CONTINUATION';

export type ScenarioResult = {
  rebound_probability: number;
  sideways_probability: number;
  continuation_probability: number;
  dominant_path: ScenarioPath;
  path_summary: string;
};

export type ScenarioDebug = {
  rebound_raw: number;
  sideways_raw: number;
  continuation_raw: number;
  dominant_path: ScenarioPath;
};
