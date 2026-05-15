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

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.moduleId = this.route.snapshot.paramMap.get('moduleId') ?? '';
    this.loadQuestions();
  }

  ngOnDestroy(): void {
    if (this.timerInterval) clearInterval(this.timerInterval);
  }

  loadQuestions(): void {
    this.api.get<any>(`questions/?module_id=${this.moduleId}`).subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        this.questions = list;
        this.loading = false;
        this.startTimer();
      },
      error: () => { this.loading = false; this.error = 'Не удалось загрузить тест.'; },
    });
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
        // Отмечаем модуль как завершённый
        this.api.post(`modules/${this.moduleId}/complete/`, { time_spent_sec: this.elapsed }).subscribe();
      },
      error: () => { this.submitting = false; this.error = 'Ошибка при отправке ответов.'; },
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
}
