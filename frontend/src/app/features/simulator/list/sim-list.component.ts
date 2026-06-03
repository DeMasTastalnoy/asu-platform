import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';
import { AuthService } from '../../../core/services/auth.service';

interface TemplateRow {
  id: number;
  name: string;
  status: string;
  module: number | null;
  library_set: string;
  updated_at: string;
}

@Component({
  selector: 'app-sim-list',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './sim-list.component.html',
  styleUrl: './sim-list.component.scss',
})
export class SimListComponent implements OnInit {
  templates: TemplateRow[] = [];
  loading = true;
  error   = '';
  user: any;

  private readonly LIBRARY_LABELS: Record<string, string> = {
    boiler:       'Котельная',
    pump_station: 'Насосная станция',
    substation:   'Электроподстанция',
    universal:    'Универсальная',
  };

  constructor(
    private api:    ApiService,
    private auth:   AuthService,
    private router: Router,
  ) {
    this.user = this.auth.currentUser;
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading   = true;
    this.error     = '';
    this.templates = [];
    this.fetchPage(1);
  }

  /** Постранично собирает все шаблоны (на странице DRF — до 20 записей). */
  private fetchPage(page: number): void {
    this.api.get<any>('simulations/templates/', { page: String(page) }).subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        this.templates.push(...list.map((s: any) => ({
          id:          s.id,
          name:        s.name,
          status:      s.status,
          module:      s.module ?? null,
          library_set: s.library_set ?? '',
          updated_at:  s.updated_at,
        })));
        if (!Array.isArray(data) && data.next) {
          this.fetchPage(page + 1);
        } else {
          this.loading = false;
        }
      },
      error: () => {
        this.loading = false;
        this.error   = 'Не удалось загрузить список симуляций.';
      },
    });
  }

  libraryLabel(set: string): string {
    return this.LIBRARY_LABELS[set] ?? set ?? '—';
  }

  createNew(): void {
    this.router.navigate(['/simulator/new']);
  }

  open(t: TemplateRow): void {
    this.router.navigate(['/simulator', t.id, 'play'], { queryParams: { from: 'list' } });
  }

  edit(t: TemplateRow): void {
    this.router.navigate(['/simulator', t.id, 'edit']);
  }

  remove(t: TemplateRow): void {
    if (!confirm(`Удалить симуляцию «${t.name}»? Действие необратимо.`)) return;
    this.api.delete(`simulations/templates/${t.id}/`).subscribe({
      next: () => { this.templates = this.templates.filter(x => x.id !== t.id); },
      error: () => { this.error = 'Не удалось удалить симуляцию.'; },
    });
  }
}
