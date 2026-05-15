import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-module-view',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './module-view.component.html',
  styleUrl: './module-view.component.scss',
})
export class ModuleViewComponent implements OnInit {
  module: any = null;
  courseId = '';
  loading = true;
  user: any;

  constructor(
    private api:    ApiService,
    private auth:   AuthService,
    private route:  ActivatedRoute,
    private router: Router,
  ) {
    this.user = this.auth.currentUser;
  }

  ngOnInit(): void {
    this.courseId = this.route.snapshot.paramMap.get('id') ?? '';
    const moduleId = this.route.snapshot.paramMap.get('moduleId') ?? '';

    this.api.get<any>(`modules/${moduleId}/`).subscribe({
      next: data => {
        this.module  = data;
        this.loading = false;
        this.markInProgress();
      },
      error: () => { this.loading = false; },
    });
  }

  markInProgress(): void {
    if (!this.module) return;
    this.api.post(`modules/${this.module.id}/complete/`, { time_spent_sec: 0 }).subscribe();
  }

  complete(): void {
  this.api.post(`modules/${this.module.id}/complete/`, { time_spent_sec: 60 }).subscribe({
    next: () => this.router.navigate(['/courses', this.courseId]),
    error: () => this.router.navigate(['/courses', this.courseId]),
  });
}

  getTypeLabel(type: string): string {
    const map: Record<string, string> = {
      lecture: 'Лекция', video: 'Видео', document: 'Документ',
    };
    return map[type] ?? type;
  }
}
