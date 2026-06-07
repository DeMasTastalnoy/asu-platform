import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, RouterModule, ReactiveFormsModule],
  templateUrl: './profile.component.html',
  styleUrl: './profile.component.scss',
})
export class ProfileComponent implements OnInit {
  user: any;
  form!: FormGroup;
  passwordForm!: FormGroup;
  saving = false;
  savingPassword = false;
  saved = false;
  savedPassword = false;
  error = '';
  errorPassword = '';
  showSensitive = false;

  /** Заглушки для незаполненных полей (по форме, не реальные данные). */
  private readonly STUBS: Record<string, string> = {
    birth_year:  '2000',
    passport:    '12 34 567890',
    snils:       '123-456-789 01',
    reg_address: 'г. Москва, ул. Примерная, д. 1, кв. 1',
  };

  constructor(
    private api: ApiService,
    private auth: AuthService,
    private fb: FormBuilder,
  ) {
    this.user = this.auth.currentUser;
  }

  ngOnInit(): void {
    const u = this.user();
    this.form = this.fb.group({
      full_name:   [u?.full_name ?? '', Validators.required],
      email:       [u?.email ?? '',     [Validators.required, Validators.email]],
      birth_year:  [u?.birth_year  || this.STUBS['birth_year']],
      passport:    [u?.passport    || this.STUBS['passport']],
      snils:       [u?.snils       || this.STUBS['snils']],
      reg_address: [u?.reg_address || this.STUBS['reg_address']],
    });

    this.passwordForm = this.fb.group({
      old_password: ['', Validators.required],
      new_password: ['', [Validators.required, Validators.minLength(8)]],
    });
  }

  saveProfile(): void {
    if (this.form.invalid) return;
    this.saving = true;
    this.error  = '';

    const u = this.user();
    this.api.patch<any>(`users/${u.id}/`, this.form.value).subscribe({
      next: updated => {
        this.saving = false;
        this.saved  = true;
        this.auth.loadCurrentUser();
        setTimeout(() => this.saved = false, 2000);
      },
      error: err => {
        this.saving = false;
        this.error  = err.error?.email?.[0] ?? err.error?.detail ?? 'Ошибка сохранения.';
      },
    });
  }

  changePassword(): void {
    if (this.passwordForm.invalid) return;
    this.savingPassword = true;
    this.errorPassword  = '';

    const u = this.user();
    this.api.post<any>(`users/${u.id}/change_password/`, this.passwordForm.value).subscribe({
      next: () => {
        this.savingPassword = false;
        this.savedPassword  = true;
        this.passwordForm.reset();
        setTimeout(() => this.savedPassword = false, 2000);
      },
      error: err => {
        this.savingPassword = false;
        this.errorPassword  = err.error?.old_password?.[0] ?? err.error?.detail ?? 'Ошибка смены пароля.';
      },
    });
  }

  getInitials(): string {
    const u    = this.user();
    const name = u?.full_name || u?.username || '';
    return name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  }

  getRoleLabel(): string {
    const map: Record<string, string> = {
      admin: 'Администратор', instructor: 'Инструктор', student: 'Обучающийся',
    };
    return map[this.user()?.primary_role] ?? '';
  }
}
