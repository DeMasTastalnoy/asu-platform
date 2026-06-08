import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';
import { Course } from '../../../core/models/course.model';

@Component({
  selector: 'app-courses-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './courses-list.component.html',
  styleUrl: './courses-list.component.scss',
})
export class CoursesListComponent implements OnInit {
  courses: Course[] = [];
  loading = true;
  user: any;

  constructor(private api: ApiService, private auth: AuthService) {
    this.user = this.auth.currentUser;
  }

  ngOnInit(): void {
    this.api.get<any>('courses/').subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        // По возрастанию уровня сложности (основы — первыми), затем по названию.
        this.courses = list.sort((a: Course, b: Course) =>
          (a.level ?? 0) - (b.level ?? 0) || a.title.localeCompare(b.title));
        this.loading = false;
      },
      error: () => { this.loading = false; }
    });
  }

  getStatusLabel(status: string): string {
    const map: Record<string, string> = {
      draft: 'Черновик', published: 'Опубликован', archived: 'Архив'
    };
    return map[status] ?? status;
  }
}
