import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
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
  /** Хост media-файлов (без /api). */
  private readonly MEDIA_HOST = 'http://127.0.0.1:8000';

  module: any = null;
  courseId = '';
  loading = true;
  completed = false;
  user: any;

  constructor(
    private api:    ApiService,
    private auth:   AuthService,
    private route:  ActivatedRoute,
    private router: Router,
    private sanitizer: DomSanitizer,
  ) {
    this.user = this.auth.currentUser;
  }

  ngOnInit(): void {
    this.courseId = this.route.snapshot.paramMap.get('id') ?? '';
    const moduleId = this.route.snapshot.paramMap.get('moduleId') ?? '';

    this.api.get<any>(`modules/${moduleId}/`).subscribe({
      next: data => {
        this.module  = data;
        this.completed = data.progress?.status === 'completed';
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  /** Абсолютный URL media-файла. */
  fileUrl(): string {
    const u = this.module?.file_url ?? '';
    return u.startsWith('http') ? u : this.MEDIA_HOST + u;
  }

  get isStudent(): boolean {
    return this.user()?.primary_role === 'student';
  }

  get isPdf(): boolean {
    return /\.pdf($|\?)/i.test(this.module?.file_url ?? '');
  }

  /** Безопасный URL для встраивания PDF в iframe. */
  get safeDocUrl(): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.fileUrl());
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
