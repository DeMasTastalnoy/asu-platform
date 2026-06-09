import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { ApiService } from '../../../core/services/api.service';

interface EditOption { text: string; correct: boolean; }
interface EditPair { left: string; right: string; }   // для type === 'match'
interface EditQuestion {
  id?: number;
  question: string;
  type: 'single' | 'multiple' | 'text' | 'match';
  options: EditOption[];
  answerText: string;   // для type === 'text'
  pairs: EditPair[];    // для type === 'match'
  points: number;
}

@Component({
  selector: 'app-test-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './test-edit.component.html',
  styleUrl: './test-edit.component.scss',
})
export class TestEditComponent implements OnInit {
  moduleId = '';
  moduleTitle = '';
  questions: EditQuestion[] = [];
  private deletedIds: number[] = [];
  loading = true;
  saving  = false;
  saved   = false;
  error   = '';

  /** Настройки теста (редактируются вместе с вопросами). */
  settings = {
    timeLimitMin: 0,        // 0 = без лимита
    maxAttempts:  3,
    passingScore: 60,
    shuffle:      false,
    showAnswers:  true,
  };

  readonly TYPES = [
    { value: 'single',   label: 'Одиночный выбор' },
    { value: 'multiple', label: 'Множественный выбор' },
    { value: 'text',     label: 'Ввод текста' },
    { value: 'match',    label: 'Сопоставление' },
  ];

  constructor(
    private api:    ApiService,
    private route:  ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.moduleId = this.route.snapshot.paramMap.get('moduleId') ?? '';
    this.api.get<any>(`modules/${this.moduleId}/`).subscribe({
      next: m => {
        this.moduleTitle = m.title;
        const s = m.test_settings;
        if (s) {
          this.settings = {
            timeLimitMin: s.time_limit_sec ? Math.round(s.time_limit_sec / 60) : 0,
            maxAttempts:  s.max_attempts ?? 3,
            passingScore: Number(s.passing_score ?? 60),
            shuffle:      !!s.shuffle_questions,
            showAnswers:  s.show_answers_after !== false,
          };
        }
      },
    });
    this.api.get<any>(`questions/?module_id=${this.moduleId}`).subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        this.questions = list
          .sort((a: any, b: any) => (a.order_num ?? 0) - (b.order_num ?? 0))
          .map((q: any) => this.fromApi(q));
        this.loading = false;
      },
      error: () => { this.loading = false; this.error = 'Не удалось загрузить вопросы.'; },
    });
  }

  /** Преобразует вопрос из API в редактируемую модель. */
  private fromApi(q: any): EditQuestion {
    const type = ['single', 'multiple', 'text', 'match'].includes(q.type) ? q.type : 'single';
    const ca   = q.correct_answer;
    const opts = q.options ?? [];

    const isChoice = type === 'single' || type === 'multiple';
    const options: EditOption[] = isChoice
      ? opts.map((o: any) => ({
          text:    o.text ?? '',
          correct: type === 'multiple' ? Array.isArray(ca) && ca.includes(o.id) : ca === o.id,
        }))
      : [];

    let pairs: EditPair[] = [];
    if (type === 'match') {
      const lefts  = opts.filter((o: any) => o.side === 'left');
      const rights = opts.filter((o: any) => o.side === 'right');
      const rText: Record<string, string> = {};
      rights.forEach((r: any) => { rText[r.id] = r.text ?? ''; });
      const mapping = (ca && typeof ca === 'object' && !Array.isArray(ca)) ? ca : {};
      pairs = lefts.map((l: any) => ({ left: l.text ?? '', right: rText[mapping[l.id]] ?? '' }));
    }

    return {
      id:         q.id,
      question:   q.question ?? '',
      type,
      options:    isChoice ? (options.length ? options : this.blankOptions()) : [],
      answerText: type === 'text' ? (typeof ca === 'string' ? ca : '') : '',
      pairs:      type === 'match' ? (pairs.length ? pairs : this.blankPairs()) : [],
      points:     q.points ?? 1,
    };
  }

  private blankOptions(): EditOption[] {
    return [{ text: '', correct: true }, { text: '', correct: false }];
  }

  private blankPairs(): EditPair[] {
    return [{ left: '', right: '' }, { left: '', right: '' }];
  }

  addQuestion(): void {
    this.questions.push({
      question: '', type: 'single', options: this.blankOptions(), answerText: '', pairs: [], points: 1,
    });
  }

  removeQuestion(i: number): void {
    const q = this.questions[i];
    if (q.id) this.deletedIds.push(q.id);
    this.questions.splice(i, 1);
  }

  moveQuestion(i: number, dir: -1 | 1): void {
    const j = i + dir;
    if (j < 0 || j >= this.questions.length) return;
    [this.questions[i], this.questions[j]] = [this.questions[j], this.questions[i]];
  }

  onTypeChange(q: EditQuestion): void {
    if (q.type === 'match') {
      if (!q.pairs.length) q.pairs = this.blankPairs();
      return;
    }
    if (q.type === 'text') return;
    if (!q.options.length) q.options = this.blankOptions();
    if (q.type === 'single') {
      // оставить ровно один правильный
      let found = false;
      q.options.forEach(o => {
        if (o.correct && !found) found = true;
        else o.correct = false;
      });
      if (!found && q.options[0]) q.options[0].correct = true;
    }
  }

  addOption(q: EditQuestion): void {
    q.options.push({ text: '', correct: false });
  }

  removeOption(q: EditQuestion, i: number): void {
    q.options.splice(i, 1);
    if (q.type === 'single' && !q.options.some(o => o.correct) && q.options[0]) {
      q.options[0].correct = true;
    }
  }

  setCorrectSingle(q: EditQuestion, i: number): void {
    q.options.forEach((o, idx) => o.correct = idx === i);
  }

  addPair(q: EditQuestion): void {
    q.pairs.push({ left: '', right: '' });
  }

  removePair(q: EditQuestion, i: number): void {
    q.pairs.splice(i, 1);
  }

  // ── Валидность ────────────────────────────────────────────────────────────────
  questionValid(q: EditQuestion): boolean {
    if (!q.question.trim()) return false;
    if (q.type === 'text') return !!q.answerText.trim();
    if (q.type === 'match') {
      const filled = q.pairs.filter(p => p.left.trim() && p.right.trim());
      return filled.length >= 2;
    }
    const filled = q.options.filter(o => o.text.trim());
    return filled.length >= 2 && filled.some(o => o.correct);
  }

  get allValid(): boolean {
    // Пустой тест сохранять можно (например, только настройки) — пройти его всё равно нельзя.
    return this.questions.every(q => this.questionValid(q));
  }

  private letter(i: number): string { return String.fromCharCode(97 + i); }

  /** Готовит payload вопроса для API. */
  private toApi(q: EditQuestion, order: number): any {
    const base: any = {
      module:    +this.moduleId,
      question:  q.question.trim(),
      type:      q.type,
      points:    q.points || 1,
      order_num: order,
    };
    if (q.type === 'text') {
      base.options = [];
      base.correct_answer = q.answerText.trim();
    } else if (q.type === 'match') {
      // options хранит обе колонки с пометкой стороны, correct_answer — соответствие leftId→rightId
      const filled = q.pairs.filter(p => p.left.trim() && p.right.trim());
      const options: any[] = [];
      const mapping: Record<string, string> = {};
      filled.forEach((p, i) => {
        const lid = `l${i}`, rid = `r${i}`;
        options.push({ id: lid, text: p.left.trim(),  side: 'left'  });
        options.push({ id: rid, text: p.right.trim(), side: 'right' });
        mapping[lid] = rid;
      });
      base.options = options;
      base.correct_answer = mapping;
    } else {
      const filled = q.options.filter(o => o.text.trim());
      base.options = filled.map((o, i) => ({ id: this.letter(i), text: o.text.trim() }));
      const correctIds = filled
        .map((o, i) => (o.correct ? this.letter(i) : null))
        .filter((x): x is string => x !== null);
      base.correct_answer = q.type === 'multiple' ? correctIds : (correctIds[0] ?? '');
    }
    return base;
  }

  save(): void {
    if (!this.allValid) return;
    this.saving = true;
    this.error = '';

    const test_settings = {
      time_limit_sec:     this.settings.timeLimitMin > 0 ? this.settings.timeLimitMin * 60 : null,
      max_attempts:       this.settings.maxAttempts >= 0 ? this.settings.maxAttempts : 0,
      passing_score:      this.settings.passingScore,
      shuffle_questions:  this.settings.shuffle,
      show_answers_after: this.settings.showAnswers,
    };

    const ops = [
      this.api.patch(`modules/${this.moduleId}/`, { test_settings }),
      ...this.questions.map((q, i) => {
        const payload = this.toApi(q, i);
        return q.id
          ? this.api.patch(`questions/${q.id}/`, payload)
          : this.api.post('questions/', payload);
      }),
      ...this.deletedIds.map(id => this.api.delete(`questions/${id}/`)),
    ];

    forkJoin(ops.length ? ops : [of(null)]).subscribe({
      next: () => {
        this.saving = false;
        this.saved = true;
        this.deletedIds = [];
        setTimeout(() => this.saved = false, 2000);
      },
      error: () => { this.saving = false; this.error = 'Не удалось сохранить вопросы.'; },
    });
  }

  back(): void {
    this.router.navigate(['/testing']);
  }
}
