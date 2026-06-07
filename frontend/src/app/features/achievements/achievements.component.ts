import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';

interface Diploma {
  id: number;
  status: string;
  number: string;
  requested_at: string;
  issued_at: string | null;
}
interface Certificate {
  id: number;
  number: string;
  file_url: string;
  issued_at: string;
}
interface CourseAch {
  enrollment_id: number;
  course_id: number;
  course_title: string;
  progress: number;
  completed: boolean;
  tests_done: number;
  tests_total: number;
  sims_done: number;
  sims_total: number;
  final_score: number | null;
  certificate: Certificate | null;
  diploma: Diploma | null;
  // локальные флаги
  busyCert?: boolean;
}
interface Summary {
  courses: number;
  avg_progress: number;
  tests_done: number;
  tests_total: number;
  sims_done: number;
  sims_total: number;
}

@Component({
  selector: 'app-achievements',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './achievements.component.html',
  styleUrl: './achievements.component.scss',
})
export class AchievementsComponent implements OnInit {
  /** Хост для media-файлов (без /api). */
  private readonly MEDIA_HOST = 'http://127.0.0.1:8000';

  summary: Summary | null = null;
  courses: CourseAch[] = [];
  loading = true;
  user: any;

  // Модалка заявки на диплом
  showDiploma = false;
  diplomaCourse: CourseAch | null = null;
  dName = '';
  dEmail = '';
  diplomaSending = false;
  diplomaError = '';

  constructor(private api: ApiService, private auth: AuthService) {
    this.user = this.auth.currentUser;
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.get<any>('analytics/achievements/').subscribe({
      next: data => {
        this.summary = data.summary;
        this.courses = data.courses ?? [];
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  // ── Сертификат ───────────────────────────────────────────
  downloadCert(c: CourseAch): void {
    if (c.certificate) {
      window.open(this.MEDIA_HOST + c.certificate.file_url, '_blank');
      return;
    }
    c.busyCert = true;
    this.api.post<any>('analytics/certificates/issue/', { enrollment_id: c.enrollment_id }).subscribe({
      next: cert => {
        c.certificate = cert;
        c.busyCert = false;
        window.open(this.MEDIA_HOST + cert.file_url, '_blank');
      },
      error: () => { c.busyCert = false; },
    });
  }

  // ── Диплом ───────────────────────────────────────────────
  openDiploma(c: CourseAch): void {
    this.diplomaCourse = c;
    this.dName = this.user()?.full_name || '';
    this.dEmail = this.user()?.email || '';
    this.diplomaError = '';
    this.showDiploma = true;
  }

  closeDiploma(): void { this.showDiploma = false; }

  submitDiploma(): void {
    if (!this.diplomaCourse || !this.dName.trim() || !this.dEmail.trim() || this.diplomaSending) return;
    this.diplomaSending = true;
    this.diplomaError = '';
    this.api.post<any>('analytics/diploma-requests/', {
      enrollment: this.diplomaCourse.enrollment_id,
      full_name:  this.dName.trim(),
      email:      this.dEmail.trim(),
    }).subscribe({
      next: dipl => {
        this.diplomaCourse!.diploma = dipl;
        this.diplomaSending = false;
        this.showDiploma = false;
      },
      error: () => { this.diplomaSending = false; this.diplomaError = 'Не удалось отправить заявку.'; },
    });
  }

  diplomaLabel(d: Diploma | null): string {
    if (!d) return '';
    if (d.status === 'issued')   return 'Диплом оформлен № ' + d.number;
    if (d.status === 'rejected') return 'Заявка отклонена';
    return 'Заявка на рассмотрении';
  }
}
