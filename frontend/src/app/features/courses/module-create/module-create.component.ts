import { Component, OnInit, ViewChild, ElementRef } from '@angular/core';
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

  // Загрузка файла (документ/видео) и импорт текста лекции
  uploading    = false;
  uploadError  = '';
  uploadedName = '';
  importing    = false;

  /** Контейнер WYSIWYG-редактора лекции. */
  private editorEl?: ElementRef<HTMLElement>;
  @ViewChild('editor') set editorRef(el: ElementRef<HTMLElement> | undefined) {
    this.editorEl = el;
    if (el) el.nativeElement.innerHTML = this.form.get('content')?.value || '';
  }

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
        if (mod.file_url) {
          this.uploadedName = decodeURIComponent(String(mod.file_url).split('/').pop() || 'Файл');
        }
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

  // ── WYSIWYG-редактор лекции ──────────────────────────────
  /** Команда форматирования (execCommand) с последующей синхронизацией в форму. */
  exec(cmd: string, value: string | null = null): void {
    this.editorEl?.nativeElement.focus();
    document.execCommand(cmd, false, value ?? undefined);
    this.syncEditor();
  }

  /** Вставка ссылки. */
  insertLink(): void {
    const url = prompt('Адрес ссылки (URL):');
    if (url) this.exec('createLink', url);
  }

  /** Синхронизирует HTML редактора в форм-контрол content. */
  syncEditor(): void {
    if (this.editorEl) {
      this.form.get('content')?.setValue(this.editorEl.nativeElement.innerHTML, { emitEvent: false });
    }
  }

  // ── Импорт текста лекции (.md/.html/.txt) ────────────────
  onImportText(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    this.importing  = true;
    this.uploadError = '';
    const fd = new FormData();
    fd.append('file', file);
    this.api.post<any>('modules/parse-text/', fd).subscribe({
      next: res => {
        const html = res.html ?? '';
        this.form.get('content')?.setValue(html, { emitEvent: false });
        if (this.editorEl) this.editorEl.nativeElement.innerHTML = html;
        this.importing = false;
        input.value = '';
      },
      error: () => { this.importing = false; this.uploadError = 'Не удалось импортировать файл.'; input.value = ''; },
    });
  }

  // ── Загрузка файла модуля (документ/видео) ───────────────
  onFileUpload(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file  = input.files?.[0];
    if (!file) return;
    this.uploading   = true;
    this.uploadError = '';
    const fd = new FormData();
    fd.append('file', file);
    this.api.post<any>('modules/upload/', fd).subscribe({
      next: res => {
        this.form.get('file_url')?.setValue(res.url);
        this.uploadedName = res.name;
        this.uploading = false;
        input.value = '';
      },
      error: err => {
        this.uploading = false;
        this.uploadError = err.error?.detail ?? 'Не удалось загрузить файл.';
        input.value = '';
      },
    });
  }

  clearFile(): void {
    this.form.get('file_url')?.setValue('');
    this.uploadedName = '';
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
    const done = () => {
      // Новый тест ведём сразу в редактор вопросов — иначе он создаётся пустым.
      if (!this.isEdit && this.selectedType === 'test' && moduleId) {
        this.router.navigate(['/testing', moduleId, 'edit']);
      } else {
        this.router.navigate(['/courses', this.courseId]);
      }
    };

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
