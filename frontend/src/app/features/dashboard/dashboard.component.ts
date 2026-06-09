import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ApiService } from '../../core/services/api.service';

interface ContinueItem {
  course_id: number;
  course_title: string;
  progress: number;
  next_module: { id: number; title: string; type: string } | null;
}

interface NewsItem {
  date: string;
  title: string;
  body: string;
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
  continueItems: ContinueItem[] = [];
  loading = true;

  /** Новости платформы (статичная лента, новые — сверху). */
  news: NewsItem[] = [
    {
      date: '9 июня 2026',
      title: 'Запуск платформы дистанционного обучения операторов АСУ',
      body: 'Платформа введена в эксплуатацию: доступны курсы, тренажёры-симуляторы ' +
            'технологических процессов, тестирование и выдача документов об обучении. ' +
            'Желаем успешного освоения материала!',
    },
  ];

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
      this.loadContinue();
    } else {
      this.loadStats();
    }
  }

  loadContinue(): void {
    this.api.get<any>('analytics/continue/').subscribe({
      next: data => {
        this.continueItems = Array.isArray(data) ? data : data.results ?? [];
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

  openCourse(c: ContinueItem): void {
    this.router.navigate(['/courses', c.course_id]);
  }

  typeLabel(type: string): string {
    const m: Record<string, string> = {
      lecture: 'Лекция', video: 'Видео', document: 'Документ',
      test: 'Тест', simulation: 'Симуляция',
    };
    return m[type] ?? type;
  }
}
