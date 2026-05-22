import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-course-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './course-detail.component.html',
  styleUrl: './course-detail.component.scss',
})
export class CourseDetailComponent implements OnInit {
  course:  any = null;
  modules: any[] = [];
  loading = true;
  error   = '';
  user:   any;

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

  openModule(module: any): void {
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
