import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';

interface StudentRow {
  student_id: number;
  student_name: string;
  attempts: number;
  best_pct: number | null;
  last_at: string | null;
  passed: boolean;
}

interface Summary {
  students: number;
  total_attempts: number;
  avg_score: number | null;
  avg_best: number | null;
  pass_rate: number | null;
  passing_score: number;
  question_count: number;
}

interface QuestionRow {
  question_id: number;
  question: string;
  points: number;
  answered: number;
  correct: number;
  correct_rate: number | null;
}

interface GroupCmp {
  group_id: number;
  name: string;
  code: string;
  students: number;
  avg_best: number;
  pass_rate: number;
}

@Component({
  selector: 'app-test-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './test-analytics.component.html',
  styleUrl: './test-analytics.component.scss',
})
export class TestAnalyticsComponent implements OnInit {
  moduleId = '';
  title    = '';
  summary: Summary | null = null;
  students: StudentRow[] = [];
  questions: QuestionRow[] = [];
  groups: GroupCmp[] = [];
  selectedGroup: number | null = null;
  loading = true;
  error   = '';

  constructor(
    private api:   ApiService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.moduleId = this.route.snapshot.paramMap.get('moduleId') ?? '';
    this.reload();
  }

  reload(): void {
    this.loading = true;
    const params: Record<string, string> = this.selectedGroup ? { group: String(this.selectedGroup) } : {};
    this.api.get<any>(`modules/${this.moduleId}/analytics/`, params).subscribe({
      next: data => {
        this.title     = data.title;
        this.summary   = data.summary;
        this.students  = data.students ?? [];
        this.questions = data.questions ?? [];
        this.groups    = data.groups ?? [];
        this.loading   = false;
      },
      error: () => { this.loading = false; this.error = 'Не удалось загрузить аналитику.'; },
    });
  }

  onGroupChange(): void {
    this.reload();
  }

  pctClass(pct: number | null): string {
    if (pct == null) return 'badge-gray';
    if (this.summary && pct >= this.summary.passing_score) return 'badge-green';
    return 'badge-red';
  }

  /** Цвет полосы сложности: чем ниже % верных, тем «сложнее» (краснее). */
  rateClass(rate: number | null): string {
    if (rate == null) return 'bar-gray';
    if (rate >= 75) return 'bar-green';
    if (rate >= 50) return 'bar-amber';
    return 'bar-red';
  }
}
