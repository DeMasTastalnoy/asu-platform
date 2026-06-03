import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';

interface TestModule {
  id: number;
  title: string;
  course: number;
  course_title: string;
  question_count: number;
}

@Component({
  selector: 'app-test-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './test-list.component.html',
  styleUrl: './test-list.component.scss',
})
export class TestListComponent implements OnInit {
  tests: TestModule[] = [];
  loading = true;
  error   = '';
  user: any;

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
  }

  edit(t: TestModule): void {
    this.router.navigate(['/testing', t.id, 'edit']);
  }

  play(t: TestModule): void {
    this.router.navigate(['/testing', t.id]);
  }
}
