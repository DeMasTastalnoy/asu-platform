import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';

@Component({
  selector: 'app-course-create',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './course-create.component.html',
  styleUrl: './course-create.component.scss',
})
export class CourseCreateComponent implements OnInit {
  form: FormGroup;
  loading = false;
  error   = '';
  courses: { id: number; title: string }[] = [];

  constructor(private fb: FormBuilder, private api: ApiService, private router: Router) {
    this.form = this.fb.group({
      title:        ['', [Validators.required, Validators.maxLength(200)]],
      description:  [''],
      level:        [1, [Validators.required, Validators.min(1), Validators.max(5)]],
      status:       ['draft'],
      prerequisite: [null],
    });
  }

  ngOnInit(): void {
    this.api.get<any>('courses/').subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        this.courses = list.map((c: any) => ({ id: c.id, title: c.title }));
      },
    });
  }

  submit(): void {
  if (this.form.invalid) return;
  this.loading = true;
  this.error   = '';

  this.api.post<any>('courses/', this.form.value).subscribe({
    next: course => {
      console.log('Созданный курс:', course);
      if (course?.id) {
        this.router.navigate(['/courses', course.id]);
      } else {
        this.router.navigate(['/courses']);
      }
    },
    error: err => {
      this.loading = false;
      this.error   = err.error?.title?.[0] || 'Ошибка при создании курса.';
    },
  });
}
}
