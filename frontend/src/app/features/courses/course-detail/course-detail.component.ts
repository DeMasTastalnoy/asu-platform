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
  console.log('openModule simulation, module.id:', module.id);
  this.api.get<any>(`simulations/templates/?module_id=${module.id}`).subscribe({
    next: data => {
      console.log('templates response:', data);
      const list = Array.isArray(data) ? data : data.results ?? [];
      console.log('list:', list);
      if (list.length > 0) {
        const role = this.user()?.primary_role;
        console.log('role:', role);
        if (role === 'student') {
          console.log('navigating to play:', list[0].id);
          this.router.navigate(['/simulator', list[0].id, 'play']);
        } else {
          this.router.navigate(['/simulator', list[0].id, 'edit']);
        }
      } else {
        console.log('no template, opening constructor');
        this.router.navigate(['/simulator'], { queryParams: { module: module.id } });
      }
    },
    error: (e) => { console.log('error:', e); this.router.navigate(['/simulator']); },
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
