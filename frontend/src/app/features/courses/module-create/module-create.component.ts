import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';

@Component({
  selector: 'app-module-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './module-create.component.html',
  styleUrl: './module-create.component.scss',
})
export class ModuleCreateComponent implements OnInit {
  form: FormGroup;
  loading  = false;
  error    = '';
  courseId = '';

  moduleTypes = [
    { value: 'lecture',    label: 'Лекция' },
    { value: 'video',      label: 'Видео' },
    { value: 'document',   label: 'Документ' },
    { value: 'test',       label: 'Тест' },
    { value: 'simulation', label: 'Симуляция' },
  ];

  constructor(
    private fb:     FormBuilder,
    private api:    ApiService,
    private router: Router,
    private route:  ActivatedRoute,
  ) {
    this.form = this.fb.group({
      title:       ['', [Validators.required, Validators.maxLength(200)]],
      type:        ['lecture', Validators.required],
      content:     [''],
      file_url:    [''],
      order_num:   [0],
      is_required: [true],
    });
  }

  ngOnInit(): void {
    this.courseId = this.route.snapshot.paramMap.get('id') ?? '';
  }

  get selectedType(): string {
    return this.form.get('type')?.value;
  }

  submit(): void {
    if (this.form.invalid) return;
    this.loading = true;
    this.error   = '';

    const payload = { ...this.form.value, course: this.courseId };

    this.api.post<any>('modules/', payload).subscribe({
      next: () => this.router.navigate(['/courses', this.courseId]),
      error: err => {
        this.loading = false;
        this.error   = err.error?.title?.[0] || 'Ошибка при создании модуля.';
      },
    });
  }
}
