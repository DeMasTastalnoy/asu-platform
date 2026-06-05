import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';

interface Question {
  id: number;
  question: string;
  type: string;
  options: { id: string; text: string }[];
  points: number;
}

@Component({
  selector: 'app-test-player',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './test-player.component.html',
  styleUrl: './test-player.component.scss',
})
export class TestPlayerComponent implements OnInit, OnDestroy {
  moduleId = '';
  questions: Question[] = [];
  currentIndex = 0;
  answers: Record<number, string | string[]> = {};
  loading = true;
  finished = false;
  submitting = false;
  result: any = null;
  error = '';

  // Timer
  timeLimit = 0;
  elapsed = 0;
  remaining = 0;
  timerInterval: any;
  startTime!: Date;

  // Settings
  settings: any = null;

  // Попытки / блокировка
  attemptInfo: any = null;
  blocked      = false;
  requesting   = false;
  requestSent  = false;

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.moduleId = this.route.snapshot.paramMap.get('moduleId') ?? '';
    // Сначала настройки (лимит времени, перемешивание), затем вопросы.
    this.api.get<any>(`modules/${this.moduleId}/`).subscribe({
      next: m => {
        this.settings    = m.test_settings ?? null;
        this.attemptInfo = m.attempts ?? null;
        this.timeLimit   = this.settings?.time_limit_sec ?? 0;
        if (this.attemptInfo?.blocked) {
          this.blocked     = true;
          this.requestSent = !!this.attemptInfo.pending_request;
          this.loading     = false;
          return;   // тест не загружаем — показываем заглушку
        }
        this.loadQuestions();
      },
      error: () => this.loadQuestions(),
    });
  }

  ngOnDestroy(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  loadQuestions(): void {
    this.api.get<any>(`questions/?module_id=${this.moduleId}`).subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        this.questions = this.settings?.shuffle_questions ? this.shuffle(list) : list;
        this.loading = false;
        this.startTimer();
      },
      error: () => { this.loading = false; this.error = 'Не удалось загрузить тест.'; },
    });
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  startTimer(): void {
    this.startTime = new Date();
    this.timerInterval = setInterval(() => {
      this.elapsed = Math.floor((new Date().getTime() - this.startTime.getTime()) / 1000);
      if (this.timeLimit > 0) {
        this.remaining = Math.max(0, this.timeLimit - this.elapsed);
        if (this.remaining === 0) this.submit();
      }
    }, 1000);
  }

  get currentQuestion(): Question | null {
    return this.questions[this.currentIndex] ?? null;
  }

  get progress(): number {
    return this.questions.length ? Math.round((this.currentIndex + 1) / this.questions.length * 100) : 0;
  }

  get answeredCount(): number {
    return Object.keys(this.answers).length;
  }

  isSelected(optionId: string): boolean {
    const ans = this.answers[this.currentQuestion?.id ?? -1];
    if (Array.isArray(ans)) return ans.includes(optionId);
    return ans === optionId;
  }

  selectOption(optionId: string): void {
    if (!this.currentQuestion || this.finished) return;
    const qid = this.currentQuestion.id;
    if (this.currentQuestion.type === 'multiple') {
      const current = (this.answers[qid] as string[]) ?? [];
      if (current.includes(optionId)) {
        this.answers[qid] = current.filter(id => id !== optionId);
      } else {
        this.answers[qid] = [...current, optionId];
      }
    } else {
      this.answers[qid] = optionId;
    }
  }

  next(): void {
    if (this.currentIndex < this.questions.length - 1) {
      this.currentIndex++;
    }
  }

  prev(): void {
    if (this.currentIndex > 0) this.currentIndex--;
  }

  goTo(index: number): void {
    this.currentIndex = index;
  }

  submit(): void {
    if (this.submitting) return;
    this.submitting = true;
    if (this.timerInterval) clearInterval(this.timerInterval);

    const answersPayload = this.questions.map(q => ({
      question_id: q.id,
      answer: this.answers[q.id] ?? null,
    }));

    this.api.post<any>('tests/submit/', {
      module_id:      +this.moduleId,
      answers:        answersPayload,
      time_spent_sec: this.elapsed,
    }).subscribe({
      next: res => {
        this.result    = res;
        this.finished  = true;
        this.submitting = false;
        // Модуль засчитываем завершённым только при сдаче (по проходному баллу).
        if (this.passed) {
          this.api.post(`modules/${this.moduleId}/complete/`, { time_spent_sec: this.elapsed }).subscribe();
        }
        // Обновляем состояние попыток — для экрана результата (осталось / лимит исчерпан)
        this.refreshAttempts();
      },
      error: () => { this.submitting = false; this.error = 'Ошибка при отправке ответов.'; },
    });
  }

  /** Перечитывает состояние попыток (после отправки теста). */
  private refreshAttempts(): void {
    this.api.get<any>(`modules/${this.moduleId}/`).subscribe({
      next: m => {
        this.attemptInfo = m.attempts ?? this.attemptInfo;
        this.requestSent = !!this.attemptInfo?.pending_request;
      },
    });
  }

  get attemptsLeft(): number | null {
    if (!this.attemptInfo || this.attemptInfo.limit <= 0) return null;
    return Math.max(0, this.attemptInfo.limit + this.attemptInfo.granted - this.attemptInfo.used);
  }

  /** Студент просит у преподавателя дополнительную попытку. */
  requestAccess(): void {
    if (this.requesting || this.requestSent) return;
    this.requesting = true;
    this.error = '';
    this.api.post('attempt-requests/', { module: +this.moduleId }).subscribe({
      next: () => { this.requesting = false; this.requestSent = true; },
      error: () => { this.requesting = false; this.error = 'Не удалось отправить заявку. Попробуйте позже.'; },
    });
  }

  get elapsedStr(): string {
    const m = Math.floor(this.elapsed / 60).toString().padStart(2, '0');
    const s = (this.elapsed % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  get scorePercent(): number {
    if (!this.result) return 0;
    return Math.round(this.result.score / this.result.max_score * 100);
  }

  /** Проходной балл из настроек теста (по умолчанию 60%). */
  get passingScore(): number {
    const ps = this.settings?.passing_score;
    return ps != null ? Number(ps) : 60;
  }

  /** Вердикт «сдал/не сдал» по проходному баллу. */
  get passed(): boolean {
    return this.scorePercent >= this.passingScore;
  }

  /** Показывать разбор ответов после теста (по умолчанию да). */
  get showAnswers(): boolean {
    return this.settings?.show_answers_after !== false;
  }
}
