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

  /** Человекочитаемые названия полей формы (для сообщений об ошибках). */
  private readonly fieldLabels: Record<string, string> = {
    username: 'Логин', email: 'Email', full_name: 'ФИО',
    password: 'Пароль', password2: 'Подтверждение пароля',
  };

  submit(): void {
  this.error = '';

  // Клиентская проверка: подсветить и явно назвать незаполненные/некорректные поля.
  if (this.form.invalid) {
    this.form.markAllAsTouched();
    const bad = Object.keys(this.form.controls)
      .filter(k => this.form.get(k)?.invalid)
      .map(k => this.fieldLabels[k] ?? k);
    this.error = 'Заполните корректно: ' + bad.join(', ') + '.';
    return;
  }

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
      // Найти первое поле с ошибкой и назвать его в сообщении.
      const order = ['username', 'email', 'full_name', 'password', 'password2'];
      const field = order.find(f => e[f]?.length);
      if (field) {
        this.error = `${this.fieldLabels[field]}: ${e[field][0]}`;
      } else {
        this.error = e.non_field_errors?.[0] ?? e.detail ?? 'Ошибка регистрации.';
      }
    },
  });
}
}
