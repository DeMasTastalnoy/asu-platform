import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/services/api.service';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule],
  templateUrl: './admin-users.component.html',
  styleUrl: './admin-users.component.scss',
})
export class AdminUsersComponent implements OnInit {
  users: any[] = [];
  filtered: any[] = [];
  loading = true;
  search = '';
  selectedRole = '';
  selectedStatus = '';
  actionLoading: Record<number, boolean> = {};

  statuses = [
    { value: '',        label: 'Любой статус' },
    { value: 'active',  label: 'Активные' },
    { value: 'pending', label: 'Ожидают подтверждения' },
  ];

  roles = [
    { value: '',           label: 'Все роли' },
    { value: 'admin',      label: 'Администратор' },
    { value: 'instructor', label: 'Инструктор' },
    { value: 'student',    label: 'Обучающийся' },
  ];

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadUsers();
  }

  loadUsers(): void {
    this.api.get<any>('users/').subscribe({
      next: data => {
        this.users   = Array.isArray(data) ? data : data.results ?? [];
        this.filtered = [...this.users];
        this.loading  = false;
      },
      error: () => { this.loading = false; },
    });
  }

  get pendingCount(): number {
    return this.users.filter(u => !u.is_active).length;
  }

  applyFilter(): void {
    this.filtered = this.users.filter(u => {
      const matchSearch = !this.search ||
        u.full_name?.toLowerCase().includes(this.search.toLowerCase()) ||
        u.username?.toLowerCase().includes(this.search.toLowerCase()) ||
        u.email?.toLowerCase().includes(this.search.toLowerCase());
      const matchRole = !this.selectedRole || u.primary_role === this.selectedRole;
      const matchStatus = !this.selectedStatus ||
        (this.selectedStatus === 'active'  && u.is_active) ||
        (this.selectedStatus === 'pending' && !u.is_active);
      return matchSearch && matchRole && matchStatus;
    });
  }

  toggleActive(user: any): void {
    this.actionLoading[user.id] = true;
    this.api.post<any>(`users/${user.id}/toggle_active/`, {}).subscribe({
      next: res => {
        user.is_active = res.is_active;
        this.actionLoading[user.id] = false;
      },
      error: () => { this.actionLoading[user.id] = false; },
    });
  }

  assignRole(user: any, role: string): void {
    this.actionLoading[user.id] = true;
    this.api.post<any>(`users/${user.id}/assign_role/`, { role }).subscribe({
      next: () => {
        user.primary_role = role;
        this.actionLoading[user.id] = false;
      },
      error: () => { this.actionLoading[user.id] = false; },
    });
  }

  getRoleLabel(role: string): string {
    const map: Record<string, string> = {
      admin: 'Администратор', instructor: 'Инструктор', student: 'Обучающийся',
    };
    return map[role] ?? role;
  }

  getRoleClass(role: string): string {
    const map: Record<string, string> = {
      admin: 'role-admin', instructor: 'role-instructor', student: 'role-student',
    };
    return map[role] ?? '';
  }

  getInitials(user: any): string {
    const name = user.full_name || user.username || '';
    return name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  }
}
