import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';

interface MyCourse {
  enrollment_id: number;
  course_id: number;
  title: string;
  progress: number;
  status: string;
  deadline: string | null;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.scss',
})
export class DashboardComponent implements OnInit {
  user: any;
  stats = { courses: 0 };
  myCourses: MyCourse[] = [];
  loading = true;

  constructor(
    private auth: AuthService,
    private api: ApiService,
    private router: Router,
  ) {
    this.user = this.auth.currentUser;
  }

  get isStudent(): boolean {
    return this.user()?.primary_role === 'student';
  }

  ngOnInit(): void {
    if (this.isStudent) {
      this.loadMyCourses();
    } else {
      this.loadStats();
    }
  }

  loadMyCourses(): void {
    this.api.get<any>('enrollments/').subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        this.myCourses = list.map((e: any) => ({
          enrollment_id: e.id,
          course_id:     e.course,
          title:         e.course_title,
          progress:      e.progress ?? 0,
          status:        e.status,
          deadline:      e.deadline,
        }));
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  loadStats(): void {
    this.api.get<any>('courses/').subscribe({
      next: data => {
        this.stats.courses = Array.isArray(data) ? data.length : data.count ?? data.results?.length ?? 0;
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  openCourse(c: MyCourse): void {
    this.router.navigate(['/courses', c.course_id]);
  }

  /** Дедлайн просрочен и курс ещё не завершён. */
  isOverdue(c: MyCourse): boolean {
    if (!c.deadline || c.progress >= 100) return false;
    return new Date(c.deadline) < new Date();
  }

  progressClass(p: number): string {
    if (p >= 100) return 'done';
    if (p > 0) return 'mid';
    return 'zero';
  }
}
