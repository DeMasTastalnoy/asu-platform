import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';

interface Course { id: number; title: string; }

interface StudentRow {
  student_id: number;
  name: string;
  group: string;
  progress: number;
  avg_test: number | null;
  avg_sim: number | null;
  completed: boolean;
}

interface GroupRow {
  group_id: number | null;
  name: string;
  code: string;
  students: number;
  completed: number;
  completion_rate: number;
  avg_test_score: number | null;
  avg_sim_score: number | null;
}

interface ModuleRow {
  module_id: number;
  title: string;
  attempted: number;
  avg_score: number | null;
  pass_rate: number | null;
}

interface SimRow {
  module_id: number;
  title: string;
  attempted: number;
  avg_score: number | null;
  success_rate: number | null;
}

interface Summary {
  enrolled: number;
  completed: number;
  completion_rate: number;
  avg_test_score: number | null;
  avg_sim_score: number | null;
  test_modules: number;
  sim_modules: number;
}

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss',
})
export class AnalyticsComponent implements OnInit {
  courses: Course[] = [];
  selectedCourse: Course | null = null;
  loadingCourses = true;
  loadingData = false;

  summary: Summary | null = null;
  groups: GroupRow[] = [];
  modules: ModuleRow[] = [];
  sims: SimRow[] = [];
  students: StudentRow[] = [];
  groupFilter: number | null = null;

  constructor(private api: ApiService) {}

  /** Реальные группы (без «Без группы») для выпадающего фильтра. */
  get groupOptions(): { id: number; name: string }[] {
    return this.groups
      .filter(g => g.group_id != null)
      .map(g => ({ id: g.group_id as number, name: g.name }));
  }

  ngOnInit(): void {
    this.api.get<any>('courses/').subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        this.courses = list.map((c: any) => ({ id: c.id, title: c.title }));
        this.loadingCourses = false;
        if (this.courses.length > 0) this.selectCourse(this.courses[0]);
      },
      error: () => { this.loadingCourses = false; },
    });
  }

  selectCourse(course: Course): void {
    this.selectedCourse = course;
    this.groupFilter = null;
    this.loadData();
  }

  onGroupChange(): void {
    this.loadData();
  }

  loadData(): void {
    if (!this.selectedCourse) return;
    this.loadingData = true;
    this.summary = null; this.modules = []; this.sims = []; this.students = [];
    const params: Record<string, string> = this.groupFilter ? { group: String(this.groupFilter) } : {};
    this.api.get<any>(`courses/${this.selectedCourse.id}/group-analytics/`, params).subscribe({
      next: data => {
        this.summary  = data.summary;
        this.groups   = data.groups ?? [];
        this.modules  = data.modules ?? [];
        this.sims     = data.sims ?? [];
        this.students = data.students ?? [];
        this.loadingData = false;
      },
      error: () => { this.loadingData = false; },
    });
  }

  rateBadge(pct: number | null): string {
    if (pct == null) return 'badge-gray';
    if (pct >= 75) return 'badge-green';
    if (pct >= 50) return 'badge-amber';
    return 'badge-red';
  }
}
