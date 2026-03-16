export interface SimulationElement {
  id: string;
  type: string;
  x: number;
  y: number;
  props: Record<string, any>;
  variable: string;
}

export interface SimulationTemplate {
  id: number;
  name: string;
  description: string;
  author_name: string;
  canvas_w: number;
  canvas_h: number;
  elements: SimulationElement[];
  rules: any[];
  reference_scenario: any[];
  status: 'draft' | 'published';
}

export interface SimulationResult {
  id: number;
  simulation: number;
  simulation_name: string;
  attempt_num: number;
  score: number;
  max_score: number;
  score_percent: number;
  actions_log: any[];
  completed_at: string;
}
