import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

interface TestAgg {
  module_id: number;
  title: string;
  attempts: number;
  best_pct: number;
  passing: number;
  passed: boolean;
  last_at: string | null;
}

interface SimAgg {
  sim_id: number;
  title: string;
  attempts: number;
  best_pct: number | null;
  best_ok: boolean;   // лучший проход без аварии
  last_at: string | null;
}

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './results.component.html',
  styleUrl: './results.component.scss',
})
export class ResultsComponent implements OnInit {
  tests: TestAgg[] = [];
  sims: SimAgg[] = [];
  loading = true;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    forkJoin({
      tests: this.api.get<any>('test-results/'),
      sims:  this.api.get<any>('simulations/results/'),
    }).subscribe({
      next: ({ tests, sims }) => {
        this.tests = this.aggregateTests(Array.isArray(tests) ? tests : tests.results ?? []);
        this.sims  = this.aggregateSims(Array.isArray(sims) ? sims : sims.results ?? []);
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  private aggregateTests(rows: any[]): TestAgg[] {
    const map = new Map<number, TestAgg>();
    for (const r of rows) {
      const pct = r.max_score ? Math.round(r.score / r.max_score * 100) : 0;
      const passing = r.passing_score ?? 60;
      let a = map.get(r.module);
      if (!a) {
        a = { module_id: r.module, title: r.module_title ?? ('Тест ' + r.module),
              attempts: 0, best_pct: 0, passing, passed: false, last_at: null };
        map.set(r.module, a);
      }
      a.attempts++;
      if (pct > a.best_pct) a.best_pct = pct;
      a.passed = a.best_pct >= a.passing;
      if (!a.last_at || (r.completed_at ?? '') > a.last_at) a.last_at = r.completed_at ?? null;
    }
    return [...map.values()].sort((x, y) => Number(x.passed) - Number(y.passed) || y.best_pct - x.best_pct);
  }

  private aggregateSims(rows: any[]): SimAgg[] {
    const map = new Map<number, SimAgg>();
    for (const r of rows) {
      const pct = r.score_percent ?? null;
      let a = map.get(r.simulation);
      if (!a) {
        a = { sim_id: r.simulation, title: r.simulation_name ?? ('Симуляция ' + r.simulation),
              attempts: 0, best_pct: null, best_ok: false, last_at: null };
        map.set(r.simulation, a);
      }
      a.attempts++;
      if (pct != null && (a.best_pct == null || pct > a.best_pct)) {
        a.best_pct = pct;
        a.best_ok  = !!r.completed && !r.safety_tripped;
      }
      if (!a.last_at || (r.completed_at ?? '') > a.last_at) a.last_at = r.completed_at ?? null;
    }
    return [...map.values()].sort((x, y) => (y.best_pct ?? -1) - (x.best_pct ?? -1));
  }

  pctBadge(pct: number | null): string {
    if (pct == null) return 'badge-gray';
    if (pct >= 75) return 'badge-green';
    if (pct >= 50) return 'badge-amber';
    return 'badge-red';
  }
}
