import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
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

  /** id редактируемого модуля (null — режим создания). */
  moduleId: string | null = null;
  /** id симуляции, привязанной к модулю на момент открытия (для отвязки при смене). */
  private currentSimId: number | null = null;

  /** Опубликованные симуляции для привязки к модулю типа «Симуляция». */
  simulations: { id: number; name: string; module: number | null }[] = [];

  get isEdit(): boolean { return !!this.moduleId; }

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
      simulation:  [''],   // id выбранной симуляции (не входит в payload модуля)
      order_num:   [0],
      is_required: [true],
    });
  }

  ngOnInit(): void {
    this.courseId = this.route.snapshot.paramMap.get('id') ?? '';
    this.moduleId = this.route.snapshot.paramMap.get('moduleId');
    this.loadSimulations();
    if (this.isEdit) this.loadModule();
  }

  /** Загружает опубликованные симуляции, доступные для привязки. */
  loadSimulations(): void {
    // Фильтруем по статусу на сервере: иначе из-за пагинации (20 на страницу)
    // опубликованная симуляция может оказаться на 2-й странице среди черновиков.
    this.api.get<any>('simulations/templates/?status=published').subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        this.simulations = list
          .map((s: any) => ({ id: s.id, name: s.name, module: s.module ?? null }));
      },
    });
  }

  /** В режиме редактирования подгружает данные модуля и текущую привязку симуляции. */
  loadModule(): void {
    this.api.get<any>(`modules/${this.moduleId}/`).subscribe({
      next: mod => {
        this.form.patchValue({
          title:       mod.title,
          type:        mod.type,
          content:     mod.content ?? '',
          file_url:    mod.file_url ?? '',
          order_num:   mod.order_num ?? 0,
          is_required: mod.is_required ?? true,
        });
        if (mod.type === 'simulation') {
          this.api.get<any>(`simulations/templates/?module_id=${this.moduleId}`).subscribe({
            next: data => {
              const list = Array.isArray(data) ? data : data.results ?? [];
              if (list.length > 0) {
                const bound = list[0];
                this.currentSimId = bound.id;
                // Привязанная симуляция может быть черновиком — добавим её в список,
                // чтобы она отобразилась выбранной в выпадающем списке.
                if (!this.simulations.some(s => s.id === bound.id)) {
                  this.simulations = [
                    { id: bound.id, name: bound.name, module: bound.module ?? null },
                    ...this.simulations,
                  ];
                }
                this.form.patchValue({ simulation: bound.id });
              }
            },
          });
        }
      },
      error: () => { this.error = 'Не удалось загрузить модуль.'; },
    });
  }

  get selectedType(): string {
    return this.form.get('type')?.value;
  }

  submit(): void {
    if (this.form.invalid) return;
    this.loading = true;
    this.error   = '';

    // simulation — служебное поле формы, в payload модуля его не отправляем
    const { simulation, ...moduleData } = this.form.value;
    const payload = { ...moduleData, course: this.courseId };

    const req = this.isEdit
      ? this.api.patch<any>(`modules/${this.moduleId}/`, payload)
      : this.api.post<any>('modules/', payload);

    req.subscribe({
      next:  (module) => this.syncSimulation(module?.id ?? this.moduleId, simulation),
      error: err => {
        this.loading = false;
        this.error   = err.error?.title?.[0] || 'Ошибка при сохранении модуля.';
      },
    });
  }

  /**
   * Приводит привязку симуляции к выбранному состоянию: отвязывает прежнюю
   * (если изменилась или тип модуля больше не «симуляция») и привязывает новую.
   */
  private syncSimulation(moduleId: any, selected: string): void {
    const done = () => this.router.navigate(['/courses', this.courseId]);

    const isSim     = this.selectedType === 'simulation';
    const desiredId = (isSim && selected) ? Number(selected) : null;

    // Привязка не изменилась — просто выходим
    if (desiredId === this.currentSimId) { done(); return; }

    const ops = [];
    if (this.currentSimId && this.currentSimId !== desiredId) {
      ops.push(this.api.patch(`simulations/templates/${this.currentSimId}/`, { module: null }));
    }
    if (desiredId) {
      ops.push(this.api.patch(`simulations/templates/${desiredId}/`, { module: moduleId }));
    }
    if (ops.length === 0) { done(); return; }

    forkJoin(ops).subscribe({
      next:  () => done(),
      error: () => {
        this.loading = false;
        this.error   = 'Модуль сохранён, но не удалось обновить привязку симуляции.';
      },
    });
  }
}
