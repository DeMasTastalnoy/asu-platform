import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../core/services/api.service';

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './analytics.component.html',
  styleUrl: './analytics.component.scss',
})
export class AnalyticsComponent implements OnInit {
  courses: any[] = [];
  analytics: any[] = [];
  testResults: any[] = [];
  simResults: any[] = [];
  loading = true;
  selectedCourse: any = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadData();
  }

  loadData(): void {
    this.api.get<any>('courses/').subscribe({
      next: data => {
        this.courses = Array.isArray(data) ? data : data.results ?? [];
        this.loading = false;
        if (this.courses.length > 0) {
          this.selectCourse(this.courses[0]);
        }
      },
    });

    this.api.get<any>('test-results/').subscribe({
      next: data => {
        this.testResults = Array.isArray(data) ? data : data.results ?? [];
      },
    });

    this.api.get<any>('simulations/results/').subscribe({
      next: data => {
        this.simResults = Array.isArray(data) ? data : data.results ?? [];
      },
    });
  }

  selectCourse(course: any): void {
    this.selectedCourse = course;
  }

  getCourseTestResults(courseId: number): any[] {
    return this.testResults.filter(r => r.module?.toString().includes(courseId.toString()));
  }

  get avgTestScore(): string {
    if (!this.testResults.length) return '—';
    const scores = this.testResults
      .filter(r => r.score !== null && r.max_score > 0)
      .map(r => r.score / r.max_score * 100);
    if (!scores.length) return '—';
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) + '%';
  }

  get avgSimScore(): string {
    if (!this.simResults.length) return '—';
    const scores = this.simResults
      .filter(r => r.score !== null && r.max_score > 0)
      .map(r => r.score / r.max_score * 100);
    if (!scores.length) return '—';
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) + '%';
  }

  getScoreBadgeClass(score: number, maxScore: number): string {
    if (!maxScore) return 'badge-gray';
    const pct = score / maxScore * 100;
    if (pct >= 80) return 'badge-green';
    if (pct >= 60) return 'badge-amber';
    return 'badge-red';
  }

  formatScore(score: number, maxScore: number): string {
    if (maxScore === 0) return '—';
    return `${Math.round(score / maxScore * 100)}%`;
  }
}
