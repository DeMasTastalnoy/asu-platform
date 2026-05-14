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
    next: () => this.router.navigate(['/auth/login']),
    error: err => {
      this.loading = false;
      this.error   = err.error?.username?.[0] ?? err.error?.email?.[0] ?? err.error?.detail ?? 'Ошибка регистрации.';
    },
  });
}
}
