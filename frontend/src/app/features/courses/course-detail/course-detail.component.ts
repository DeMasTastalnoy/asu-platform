import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-course-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, DragDropModule],
  templateUrl: './course-detail.component.html',
  styleUrl: './course-detail.component.scss',
})
export class CourseDetailComponent implements OnInit {
  course:  any = null;
  modules: any[] = [];
  loading = true;
  error   = '';
  user:   any;
  reordering   = false;
  reorderError = '';

  constructor(
    private api:    ApiService,
    private auth:   AuthService,
    private route:  ActivatedRoute,
    private router: Router,
  ) {
    this.user = this.auth.currentUser;
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.loadCourse(id!);
  }

  loadCourse(id: string): void {
    this.api.get<any>(`courses/${id}/`).subscribe({
      next: data => {
        this.course  = data;
        this.loading = false;
        this.loadModules(id);
      },
      error: () => {
        this.error   = 'Курс не найден.';
        this.loading = false;
      },
    });
  }

  loadModules(courseId: string): void {
    this.api.get<any>(`courses/${courseId}/modules/`).subscribe({
      next: data => {
        this.modules = Array.isArray(data) ? data : data.results ?? [];
      },
    });
  }

  get canReorder(): boolean {
    return this.user()?.primary_role !== 'student';
  }

  /** Перетаскивание модуля: меняем порядок локально и сохраняем на сервере. */
  drop(event: CdkDragDrop<any[]>): void {
    if (event.previousIndex === event.currentIndex) return;
    moveItemInArray(this.modules, event.previousIndex, event.currentIndex);

    // Проставляем order_num = индексу для всех, у кого он изменился.
    this.reordering   = true;
    this.reorderError = '';
    const patches = this.modules
      .map((m, idx) => ({ m, idx }))
      .filter(({ m, idx }) => m.order_num !== idx)
      .map(({ m, idx }) => {
        m.order_num = idx;
        return this.api.patch(`modules/${m.id}/`, { order_num: idx });
      });

    if (patches.length === 0) { this.reordering = false; return; }

    forkJoin(patches).subscribe({
      next: () => { this.reordering = false; },
      error: () => {
        this.reordering   = false;
        this.reorderError = 'Не удалось сохранить порядок. Обновите страницу.';
      },
    });
  }

  getTypeLabel(type: string): string {
    const map: Record<string, string> = {
      lecture: 'Лекция', video: 'Видео',
      document: 'Документ', test: 'Тест', simulation: 'Симуляция',
    };
    return map[type] ?? type;
  }

  getTypeColor(type: string): string {
    const map: Record<string, string> = {
      lecture: 'blue', video: 'green',
      document: 'gray', test: 'amber', simulation: 'purple',
    };
    return map[type] ?? 'gray';
  }

  getProgressStatus(module: any): string {
    return module.progress?.status ?? 'not_started';
  }

  get isStudent(): boolean {
    return this.user()?.primary_role === 'student';
  }

  /** Модуль завершён? */
  private isCompleted(module: any): boolean {
    return this.getProgressStatus(module) === 'completed';
  }

  /** Модуль заблокирован для студента: задан unlock_after и предшественник не завершён. */
  isLocked(module: any): boolean {
    if (!this.isStudent || !module.unlock_after) return false;
    const prereq = this.modules.find(m => m.id === module.unlock_after);
    return !!prereq && !this.isCompleted(prereq);
  }

  /** Название предшествующего модуля (для подсказки на замке). */
  lockReason(module: any): string {
    const prereq = this.modules.find(m => m.id === module.unlock_after);
    return prereq ? prereq.title : '';
  }

  /** Прогресс курса для студента: завершено обязательных из всех обязательных. */
  get courseProgress(): number {
    const required = this.modules.filter(m => m.is_required);
    if (required.length === 0) return 100;
    const done = required.filter(m => this.isCompleted(m)).length;
    return Math.round(done / required.length * 100);
  }

  openModule(module: any): void {
    if (this.isLocked(module)) return;
    switch (module.type) {
      case 'test':
        this.router.navigate(['/testing', module.id]);
        break;
      case 'simulation':
        this.api.get<any>(`simulations/templates/?module_id=${module.id}`).subscribe({
          next: data => {
            const list = Array.isArray(data) ? data : data.results ?? [];
            if (list.length > 0) {
              // Все роли открывают плеер; кнопка редактирования — внутри плеера
              this.router.navigate(['/simulator', list[0].id, 'play']);
            } else {
              // Шаблон ещё не создан — конструктор только для инструктора/админа
              const role = this.user()?.primary_role;
              if (role === 'instructor' || role === 'admin') {
                this.router.navigate(['/simulator/new'], { queryParams: { module: module.id } });
              }
            }
          },
          error: () => this.router.navigate(['/dashboard']),
        });
        break;
      case 'lecture':
      case 'video':
      case 'document':
        this.router.navigate(['/courses', this.course.id, 'modules', module.id]);
        break;
      default:
        break;
    }
  }
}
