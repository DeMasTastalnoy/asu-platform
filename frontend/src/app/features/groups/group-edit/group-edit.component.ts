import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule, ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../../core/services/api.service';

interface Member {
  student_id: number;
  student_name: string;
  username: string;
  email: string;
  joined_at: string;
}

interface StudentOpt {
  id: number;
  full_name: string;
  username: string;
  email: string;
}

@Component({
  selector: 'app-group-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './group-edit.component.html',
  styleUrl: './group-edit.component.scss',
})
export class GroupEditComponent implements OnInit {
  groupId = '';
  group: any = null;
  members: Member[] = [];
  loading = true;
  error   = '';

  // Реквизиты (правка)
  name = ''; code = ''; description = '';
  savingInfo = false;
  savedInfo  = false;

  // Поиск студентов
  search = '';
  searchResults: StudentOpt[] = [];
  searching = false;
  private searchTimer: any;

  // Зачисление на курс
  courses: { id: number; title: string }[] = [];
  enrollCourseId: number | null = null;
  enrollDeadline = '';
  enrolling = false;
  enrollMsg = '';

  constructor(
    private api: ApiService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.groupId = this.route.snapshot.paramMap.get('id') ?? '';
    this.api.get<any>(`groups/${this.groupId}/`).subscribe({
      next: g => {
        this.group = g;
        this.name = g.name; this.code = g.code ?? ''; this.description = g.description ?? '';
        this.loading = false;
        this.loadMembers();
      },
      error: () => { this.loading = false; this.error = 'Группа не найдена.'; },
    });
    this.api.get<any>('courses/').subscribe({
      next: data => {
        const list = Array.isArray(data) ? data : data.results ?? [];
        this.courses = list.map((c: any) => ({ id: c.id, title: c.title }));
      },
    });
  }

  loadMembers(): void {
    this.api.get<any>(`groups/${this.groupId}/members/`).subscribe({
      next: data => { this.members = data ?? []; },
    });
  }

  // ── Реквизиты ────────────────────────────────────────────
  saveInfo(): void {
    if (!this.name.trim() || this.savingInfo) return;
    this.savingInfo = true; this.savedInfo = false;
    this.api.patch<any>(`groups/${this.groupId}/`, {
      name: this.name.trim(), code: this.code.trim(), description: this.description.trim(),
    }).subscribe({
      next: g => {
        this.group = g; this.savingInfo = false; this.savedInfo = true;
        setTimeout(() => this.savedInfo = false, 2000);
      },
      error: () => { this.savingInfo = false; this.error = 'Не удалось сохранить.'; },
    });
  }

  // ── Поиск/добавление студентов ───────────────────────────
  onSearchInput(): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.runSearch(), 300);
  }

  runSearch(): void {
    const q = this.search.trim();
    this.searching = true;
    this.api.get<StudentOpt[]>('users/students/', q ? { search: q } : {}).subscribe({
      next: data => {
        const memberIds = new Set(this.members.map(m => m.student_id));
        this.searchResults = (data ?? []).filter(s => !memberIds.has(s.id));
        this.searching = false;
      },
      error: () => { this.searching = false; },
    });
  }

  addMember(s: StudentOpt): void {
    this.api.post(`groups/${this.groupId}/add_members/`, { student_ids: [s.id] }).subscribe({
      next: () => {
        this.searchResults = this.searchResults.filter(x => x.id !== s.id);
        this.loadMembers();
      },
    });
  }

  removeMember(m: Member): void {
    if (!confirm(`Убрать ${m.student_name || m.username} из группы? (на курсах останется зачислен)`)) return;
    this.api.post(`groups/${this.groupId}/remove_members/`, { student_ids: [m.student_id] }).subscribe({
      next: () => { this.members = this.members.filter(x => x.student_id !== m.student_id); },
    });
  }

  // ── Зачисление на курс ───────────────────────────────────
  enroll(): void {
    if (!this.enrollCourseId || this.enrolling) return;
    this.enrolling = true; this.enrollMsg = '';
    const body: any = { course_id: this.enrollCourseId };
    if (this.enrollDeadline) body.deadline = this.enrollDeadline;
    this.api.post<any>(`groups/${this.groupId}/enroll/`, body).subscribe({
      next: res => {
        this.enrolling = false;
        const tagged = res.tagged ? `, привязано ранее зачисленных: ${res.tagged}` : '';
        this.enrollMsg = `Зачислено новых: ${res.enrolled} из ${res.total} на «${res.course_title}»${tagged}.`;
      },
      error: () => { this.enrolling = false; this.enrollMsg = 'Не удалось зачислить.'; },
    });
  }

  back(): void { this.router.navigate(['/groups']); }
}
