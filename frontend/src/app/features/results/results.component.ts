import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';

interface TestRow {
  module_title: string;
  attempt_num: number;
  score: number;
  max_score: number;
  pct: number;
  completed_at: string | null;
}

interface SimRow {
  simulation_name: string;
  attempt_num: number;
  pct: number | null;
  completed: boolean;
  safety_tripped: boolean;
  completed_at: string | null;
}

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './results.component.html',
  styleUrl: './results.component.scss',
})
export class ResultsComponent implements OnInit {
  tests: TestRow[] = [];
  sims: SimRow[] = [];
  loading = true;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    forkJoin({
      tests: this.api.get<any>('test-results/'),
      sims:  this.api.get<any>('simulations/results/'),
    }).subscribe({
      next: ({ tests, sims }) => {
        const tl = Array.isArray(tests) ? tests : tests.results ?? [];
        const sl = Array.isArray(sims) ? sims : sims.results ?? [];
        this.tests = tl.map((r: any) => ({
          module_title: r.module_title ?? ('Тест ' + r.module),
          attempt_num:  r.attempt_num,
          score:        r.score,
          max_score:    r.max_score,
          pct:          r.max_score ? Math.round(r.score / r.max_score * 100) : 0,
          completed_at: r.completed_at,
        })).sort((a: TestRow, b: TestRow) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
        this.sims = sl.map((r: any) => ({
          simulation_name: r.simulation_name ?? ('Симуляция ' + r.simulation),
          attempt_num:     r.attempt_num,
          pct:             r.score_percent ?? null,
          completed:       r.completed,
          safety_tripped:  r.safety_tripped,
          completed_at:    r.completed_at,
        })).sort((a: SimRow, b: SimRow) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''));
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  pctBadge(pct: number | null): string {
    if (pct == null) return 'badge-gray';
    if (pct >= 75) return 'badge-green';
    if (pct >= 50) return 'badge-amber';
    return 'badge-red';
  }
}
