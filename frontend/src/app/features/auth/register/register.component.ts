import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss',
})
export class RegisterComponent {
  form: FormGroup;
  loading = false;
  error   = '';
  success = false;

  constructor(
    private fb:     FormBuilder,
    private auth:   AuthService,
    private router: Router,
  ) {
    this.form = this.fb.group({
      username:     ['', Validators.required],
      email:        ['', [Validators.required, Validators.email]],
      full_name:    ['', Validators.required],
      primary_role: ['student'],
      password:     ['', [Validators.required, Validators.minLength(8)]],
      password2:    ['', Validators.required],
    });
  }

  submit(): void {
  if (this.form.invalid) return;
  this.error = '';

  if (this.form.value.password !== this.form.value.password2) {
    this.error = 'Пароли не совпадают.';
    return;
  }

  this.loading = true;

  // Убран password2 из payload
  const { password2, ...payload } = this.form.value;

  this.auth.register(payload).subscribe({
    next: () => {
      this.loading = false;
      this.success = true;   // аккаунт создан, но ждёт подтверждения админом
    },
    error: err => {
      this.loading = false;
      const e = err.error ?? {};
      this.error =
        e.username?.[0] ?? e.email?.[0] ?? e.password?.[0] ??
        e.password2?.[0] ?? e.full_name?.[0] ?? e.non_field_errors?.[0] ??
        e.detail ?? 'Ошибка регистрации.';
    },
  });
}
}
