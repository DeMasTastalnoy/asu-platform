import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';

interface Group {
  id: number;
  name: string;
  code: string;
  description: string;
  curator_name: string;
  status: string;
  members_count: number;
  created_at: string;
}

@Component({
  selector: 'app-group-list',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './group-list.component.html',
  styleUrl: './group-list.component.scss',
})
export class GroupListComponent implements OnInit {
  groups: Group[] = [];
  loading = true;
  error   = '';

  // Модалка создания
  showCreate  = false;
  newName     = '';
  newCode     = '';
  newDesc     = '';
  creating    = false;
  createError = '';

  constructor(private api: ApiService, private router: Router) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.get<any>('groups/').subscribe({
      next: data => {
        this.groups = Array.isArray(data) ? data : data.results ?? [];
        this.loading = false;
      },
      error: () => { this.loading = false; this.error = 'Не удалось загрузить группы.'; },
    });
  }

  openCreate(): void {
    this.showCreate = true;
    this.createError = '';
    this.newName = ''; this.newCode = ''; this.newDesc = '';
  }

  closeCreate(): void { this.showCreate = false; }

  submitCreate(): void {
    const name = this.newName.trim();
    if (!name || this.creating) return;
    this.creating = true;
    this.createError = '';
    this.api.post<any>('groups/', {
      name, code: this.newCode.trim(), description: this.newDesc.trim(),
    }).subscribe({
      next: g => {
        this.creating = false;
        this.showCreate = false;
        this.router.navigate(['/groups', g.id]);
      },
      error: () => { this.creating = false; this.createError = 'Не удалось создать группу.'; },
    });
  }

  open(g: Group): void {
    this.router.navigate(['/groups', g.id]);
  }

  archive(g: Group, ev: Event): void {
    ev.stopPropagation();
    if (!confirm(`Архивировать группу «${g.name}»?`)) return;
    this.api.post(`groups/${g.id}/archive/`, {}).subscribe({
      next: () => { g.status = 'archived'; },
    });
  }
}
