import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';

interface TestModule {
  id: number;
  title: string;
  course: number;
  course_title: string;
  question_count: number;
}

interface CourseOption {
  id: number;
  title: string;
}

interface CourseModuleRow {
  id: number;
  title: string;
  type: string;
  order_num: number;
}

interface AttemptRequestRow {
  id: number;
  student_name: string;
  module_title: string;
  course_title: string;
  attempts_used: number;
  created_at: string;
}

@Component({
  selector: 'app-test-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './test-list.component.html',
  styleUrl: './test-list.component.scss',
})
export class TestListComponent implements OnInit {
  tests: TestModule[] = [];
  loading = true;
  error   = '';
  user: any;

  // Модалка «Создать тест»
  showCreate    = false;
  courses:        CourseOption[] = [];
  newCourseId:    number | null  = null;
  newTitle        = '';
  creating        = false;
  createError     = '';

  // Позиция нового теста среди модулей выбранного курса
  courseModules:  CourseModuleRow[] = [];
  modulesLoading  = false;
  insertPos       = 0;   // вставить перед модулем с этим индексом (== длине → в конец)

  // Заявки студентов на доп. попытки (для преподавателя)
  requests: AttemptRequestRow[] = [];
  resolvingId: number | null = null;

  constructor(
    private api:    ApiService,
    private auth:   AuthService,
    private router: Router,
  ) {
    this.user = this.auth.currentUser;
  }

  get isInstructor(): boolean {
    const role = this.user()?.primary_role;
    return role === 'instructor' || role === 'admin';
  }

  ngOnInit(): void {
    this.api.get<any>('modules/?type=test').subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        this.tests = list.map((m: any) => ({
          id:             m.id,
          title:          m.title,
          course:         m.course,
          course_title:   m.course_title,
          question_count: m.question_count ?? 0,
        }));
        this.loading = false;
      },
      error: () => { this.loading = false; this.error = 'Не удалось загрузить тесты.'; },
    });
    if (this.isInstructor) this.loadRequests();
  }

  /** Заявки студентов на дополнительные попытки (ожидающие). */
  loadRequests(): void {
    this.api.get<any>('attempt-requests/?status=pending').subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        this.requests = list.map((r: any) => ({
          id:            r.id,
          student_name:  r.student_name,
          module_title:  r.module_title,
          course_title:  r.course_title,
          attempts_used: r.attempts_used,
          created_at:    r.created_at,
        }));
      },
    });
  }

  approveRequest(r: AttemptRequestRow): void {
    if (this.resolvingId) return;
    this.resolvingId = r.id;
    this.api.post(`attempt-requests/${r.id}/approve/`, { granted_attempts: 1 }).subscribe({
      next: () => { this.requests = this.requests.filter(x => x.id !== r.id); this.resolvingId = null; },
      error: () => { this.resolvingId = null; },
    });
  }

  rejectRequest(r: AttemptRequestRow): void {
    if (this.resolvingId) return;
    this.resolvingId = r.id;
    this.api.post(`attempt-requests/${r.id}/reject/`, {}).subscribe({
      next: () => { this.requests = this.requests.filter(x => x.id !== r.id); this.resolvingId = null; },
      error: () => { this.resolvingId = null; },
    });
  }

  edit(t: TestModule): void {
    this.router.navigate(['/testing', t.id, 'edit']);
  }

  play(t: TestModule): void {
    this.router.navigate(['/testing', t.id]);
  }

  // ── Создание теста ───────────────────────────────────────────────
  openCreate(): void {
    this.showCreate    = true;
    this.createError   = '';
    this.newTitle      = '';
    this.newCourseId   = null;
    this.courseModules = [];
    this.insertPos     = 0;
    if (this.courses.length === 0) {
      this.api.get<any>('courses/').subscribe({
        next: data => {
          const list = Array.isArray(data) ? data : data.results ?? [];
          this.courses = list.map((c: any) => ({ id: c.id, title: c.title }));
          if (this.courses.length === 1) {
            this.newCourseId = this.courses[0].id;
            this.onCourseChange();
          }
        },
        error: () => { this.createError = 'Не удалось загрузить список курсов.'; },
      });
    }
  }

  /** При выборе курса — подгружаем его модули, чтобы показать позиции вставки. */
  onCourseChange(): void {
    this.courseModules = [];
    this.insertPos     = 0;
    if (!this.newCourseId) return;
    this.modulesLoading = true;
    this.api.get<any>(`courses/${this.newCourseId}/modules/`).subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        this.courseModules = list.map((m: any) => ({
          id: m.id, title: m.title, type: m.type, order_num: m.order_num ?? 0,
        }));
        this.insertPos      = this.courseModules.length;  // по умолчанию — в конец
        this.modulesLoading = false;
      },
      error: () => { this.modulesLoading = false; },
    });
  }

  closeCreate(): void {
    this.showCreate = false;
  }

  typeLabel(type: string): string {
    const labels: Record<string, string> = {
      lecture: 'Лекция', video: 'Видео', document: 'Документ',
      test: 'Тест', simulation: 'Симуляция',
    };
    return labels[type] ?? type;
  }

  submitCreate(): void {
    const title = this.newTitle.trim();
    if (!this.newCourseId || !title || this.creating) return;
    this.creating    = true;
    this.createError = '';

    // Создаём тест на выбранной позиции и пере-нумеровываем модули курса
    // по их текущему порядку, чтобы вставка была чёткой (а не среди нулей).
    const create$ = this.api.post<any>('modules/', {
      course:    this.newCourseId,
      title,
      type:      'test',
      order_num: this.insertPos,
    });

    // Существующим модулям проставляем 0..N-1, сдвигая на +1 всех от позиции вставки.
    const patches$ = this.courseModules.map((m, idx) => {
      const target = idx < this.insertPos ? idx : idx + 1;
      return m.order_num === target
        ? of(null)
        : this.api.patch(`modules/${m.id}/`, { order_num: target });
    });

    forkJoin([create$, ...patches$]).subscribe({
      next: ([module]) => {
        this.creating   = false;
        this.showCreate = false;
        this.router.navigate(['/testing', (module as any).id, 'edit']);
      },
      error: err => {
        this.creating    = false;
        this.createError = err.error?.title?.[0] || 'Не удалось создать тест.';
      },
    });
  }
}
