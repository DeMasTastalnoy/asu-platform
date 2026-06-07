import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

interface TestAgg {
  module_id: number;
  title: string;
  course_id: number | null;
  course_title: string;
  attempts: number;
  best_pct: number;
  passing: number;
  passed: boolean;
  last_at: string | null;
}

interface SimAgg {
  sim_id: number;
  title: string;
  course_id: number | null;
  course_title: string;
  attempts: number;
  best_pct: number | null;
  best_ok: boolean;   // лучший проход без аварии
  last_at: string | null;
}

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './results.component.html',
  styleUrl: './results.component.scss',
})
export class ResultsComponent implements OnInit {
  tests: TestAgg[] = [];
  sims: SimAgg[] = [];
  loading = true;
  courseFilter: number | null = null;

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
              course_id: r.course_id ?? null, course_title: r.course_title ?? '—',
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
              course_id: r.course_id ?? null, course_title: r.course_title ?? '—',
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

  /** Курсы из результатов (для фильтра). */
  get courseOptions(): { id: number; title: string }[] {
    const seen = new Map<number, string>();
    for (const t of this.tests) if (t.course_id != null && !seen.has(t.course_id)) seen.set(t.course_id, t.course_title);
    for (const s of this.sims)  if (s.course_id != null && !seen.has(s.course_id)) seen.set(s.course_id, s.course_title);
    return [...seen.entries()].map(([id, title]) => ({ id, title }));
  }

  get filteredTests(): TestAgg[] {
    return this.courseFilter == null ? this.tests : this.tests.filter(t => t.course_id === this.courseFilter);
  }
  get filteredSims(): SimAgg[] {
    return this.courseFilter == null ? this.sims : this.sims.filter(s => s.course_id === this.courseFilter);
  }

  pctBadge(pct: number | null): string {
    if (pct == null) return 'badge-gray';
    if (pct >= 75) return 'badge-green';
    if (pct >= 50) return 'badge-amber';
    return 'badge-red';
  }
}
