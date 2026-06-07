import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../../core/services/api.service';

interface DiplomaReq {
  id: number;
  course_title: string;
  student_name: string;
  full_name: string;
  email: string;
  status: string;
  number: string;
  final_score: number | null;
  requested_at: string;
  issued_at: string | null;
}

@Component({
  selector: 'app-admin-diplomas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-diplomas.component.html',
  styleUrl: './admin-diplomas.component.scss',
})
export class AdminDiplomasComponent implements OnInit {
  requests: DiplomaReq[] = [];
  loading = true;
  filter: 'pending' | 'all' = 'pending';
  resolvingId: number | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    const path = this.filter === 'pending'
      ? 'analytics/diploma-requests/?status=pending'
      : 'analytics/diploma-requests/';
    this.api.get<any>(path).subscribe({
      next: data => {
        this.requests = Array.isArray(data) ? data : data.results ?? [];
        this.loading = false;
      },
      error: () => { this.loading = false; },
    });
  }

  setFilter(f: 'pending' | 'all'): void {
    if (this.filter === f) return;
    this.filter = f;
    this.load();
  }

  issue(r: DiplomaReq): void {
    if (this.resolvingId) return;
    this.resolvingId = r.id;
    this.api.post<any>(`analytics/diploma-requests/${r.id}/issue/`, {}).subscribe({
      next: upd => { this.applyUpdate(r, upd); this.resolvingId = null; },
      error: () => { this.resolvingId = null; },
    });
  }

  reject(r: DiplomaReq): void {
    if (this.resolvingId) return;
    const comment = prompt('Причина отклонения (необязательно):') ?? '';
    this.resolvingId = r.id;
    this.api.post<any>(`analytics/diploma-requests/${r.id}/reject/`, { comment }).subscribe({
      next: upd => { this.applyUpdate(r, upd); this.resolvingId = null; },
      error: () => { this.resolvingId = null; },
    });
  }

  private applyUpdate(r: DiplomaReq, upd: any): void {
    if (this.filter === 'pending') {
      this.requests = this.requests.filter(x => x.id !== r.id);
    } else {
      Object.assign(r, upd);
    }
  }

  statusLabel(s: string): string {
    return s === 'issued' ? 'Оформлен' : s === 'rejected' ? 'Отклонён' : 'Новая';
  }
}
