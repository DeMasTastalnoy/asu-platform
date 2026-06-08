from django.db import models
from apps.users.models import User


class Course(models.Model):
    class Status(models.TextChoices):
        DRAFT     = "draft",     "Черновик"
        PUBLISHED = "published", "Опубликован"
        ARCHIVED  = "archived",  "Архив"

    title         = models.CharField("Название", max_length=200)
    description   = models.TextField("Описание", blank=True)
    instructor    = models.ForeignKey(
        User, on_delete=models.RESTRICT,
        related_name="courses", verbose_name="Инструктор",
    )
    status        = models.CharField(
        "Статус", max_length=20,
        choices=Status.choices, default=Status.DRAFT,
    )
    level         = models.PositiveSmallIntegerField("Уровень сложности", default=1)
    cover_image   = models.CharField("Обложка (URL)", max_length=500, blank=True)
    prerequisite  = models.ForeignKey(
        "self", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="unlocks",
        verbose_name="Доступен после курса",
    )
    created_at    = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        db_table  = "courses"
        ordering  = ["-created_at"]
        indexes   = [
            models.Index(fields=["status"]),
            models.Index(fields=["instructor"]),
        ]
        verbose_name = "Курс"
        verbose_name_plural = "Курсы"

    def __str__(self):
        return f"{self.title} [{self.status}]"

    @property
    def modules_count(self) -> int:
        return self.modules.count()


class Enrollment(models.Model):
    class Status(models.TextChoices):
        ACTIVE    = "active",    "Активно"
        COMPLETED = "completed", "Завершено"
        DROPPED   = "dropped",   "Отчислен"

    course      = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="enrollments")
    student     = models.ForeignKey(User, on_delete=models.CASCADE, related_name="enrollments")
    enrolled_by = models.ForeignKey(
        User, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="enrolled_students",
    )
    # Через какую учебную группу студент зачислён (для аналитики по потокам).
    group       = models.ForeignKey(
        "StudentGroup", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="enrollments",
        verbose_name="Учебная группа",
    )
    status      = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    deadline    = models.DateField("Срок сдачи", null=True, blank=True)
    enrolled_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table        = "enrollments"
        unique_together = ("course", "student")
        verbose_name    = "Зачисление"
        verbose_name_plural = "Зачисления"

    def __str__(self):
        return f"{self.student} → {self.course}"

    def get_progress_percent(self) -> float:
        """Процент завершённых обязательных модулей."""
        required = self.course.modules.filter(is_required=True)
        total = required.count()
        if total == 0:
            return 100.0
        done = self.module_progresses.filter(
            module__in=required,
            status=ModuleProgress.Status.COMPLETED,
        ).count()
        return round(done / total * 100, 1)


class CourseModule(models.Model):
    class Type(models.TextChoices):
        LECTURE    = "lecture",    "Лекция"
        VIDEO      = "video",      "Видео"
        DOCUMENT   = "document",   "Документ"
        TEST       = "test",       "Тест"
        SIMULATION = "simulation", "Симуляция"

    course    = models.ForeignKey(Course, on_delete=models.CASCADE, related_name="modules")
    title     = models.CharField("Название", max_length=200)
    type      = models.CharField("Тип", max_length=20, choices=Type.choices)
    content   = models.TextField("Контент (HTML/Markdown)", blank=True)
    file_url  = models.CharField("Файл (URL)", max_length=500, blank=True)
    order_num = models.PositiveIntegerField("Порядок", default=0)
    is_required = models.BooleanField("Обязателен", default=True)
    unlock_after = models.ForeignKey(
        "self", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="unlocks",
        verbose_name="Доступен после модуля",
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "course_modules"
        ordering = ["order_num"]
        indexes  = [models.Index(fields=["course", "order_num"])]
        verbose_name = "Модуль курса"
        verbose_name_plural = "Модули курса"

    def __str__(self):
        return f"[{self.type}] {self.title}"


class ModuleProgress(models.Model):
    class Status(models.TextChoices):
        NOT_STARTED = "not_started", "Не начат"
        IN_PROGRESS = "in_progress", "В процессе"
        COMPLETED   = "completed",   "Завершён"

    enrollment   = models.ForeignKey(
        Enrollment, on_delete=models.CASCADE, related_name="module_progresses",
    )
    module       = models.ForeignKey(CourseModule, on_delete=models.CASCADE)
    status       = models.CharField(
        max_length=20, choices=Status.choices, default=Status.NOT_STARTED,
    )
    time_spent_sec = models.PositiveIntegerField("Время (сек)", default=0)
    started_at   = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table        = "module_progress"
        unique_together = ("enrollment", "module")
        verbose_name    = "Прогресс по модулю"

    def __str__(self):
        return f"{self.enrollment.student} / {self.module} → {self.status}"


# ── Тестирование ─────────────────────────────────────────────

class TestSettings(models.Model):
    module            = models.OneToOneField(
        CourseModule, on_delete=models.CASCADE,
        related_name="test_settings", primary_key=True,
    )
    time_limit_sec    = models.PositiveIntegerField("Лимит времени (сек)", null=True, blank=True)
    max_attempts      = models.PositiveSmallIntegerField("Макс. попыток", default=3)
    passing_score     = models.DecimalField("Проходной балл (%)", max_digits=5, decimal_places=2, default=60)
    shuffle_questions = models.BooleanField("Перемешивать вопросы", default=False)
    show_answers_after = models.BooleanField("Показывать ответы после", default=True)

    class Meta:
        db_table = "test_settings"
        verbose_name = "Настройки теста"

    def __str__(self):
        return f"Настройки теста: {self.module.title}"


class TestQuestion(models.Model):
    class QuestionType(models.TextChoices):
        SINGLE   = "single",   "Одиночный выбор"
        MULTIPLE = "multiple", "Множественный выбор"
        TEXT     = "text",     "Ввод текста"
        MATCH    = "match",    "Сопоставление"

    module         = models.ForeignKey(
        CourseModule, on_delete=models.CASCADE, related_name="questions",
    )
    question       = models.TextField("Вопрос")
    type           = models.CharField(max_length=20, choices=QuestionType.choices, default=QuestionType.SINGLE)
    # options: [{"id": "a", "text": "..."}, ...]
    options        = models.JSONField("Варианты ответа", default=list, blank=True)
    # correct_answer: "a" | ["a","b"] | {"a":"1","b":"2"}
    correct_answer = models.JSONField("Правильный ответ")
    points         = models.PositiveSmallIntegerField("Баллы", default=1)
    order_num      = models.PositiveIntegerField("Порядок", default=0)

    class Meta:
        db_table = "test_questions"
        ordering = ["order_num"]
        indexes  = [models.Index(fields=["module"])]
        verbose_name = "Вопрос теста"
        verbose_name_plural = "Вопросы теста"

    def __str__(self):
        return f"Q{self.order_num}: {self.question[:60]}"


class TestResult(models.Model):
    user        = models.ForeignKey(User, on_delete=models.CASCADE, related_name="test_results")
    module      = models.ForeignKey(CourseModule, on_delete=models.CASCADE, related_name="test_results")
    attempt_num = models.PositiveSmallIntegerField("Номер попытки", default=1)
    score       = models.DecimalField("Балл", max_digits=5, decimal_places=2, null=True, blank=True)
    max_score   = models.DecimalField("Макс. балл", max_digits=5, decimal_places=2, null=True, blank=True)
    # answers: [{"question_id": 1, "answer": "a", "is_correct": true}, ...]
    answers     = models.JSONField("Ответы", default=list)
    time_spent_sec = models.PositiveIntegerField("Время (сек)", null=True, blank=True)
    started_at  = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "test_results"
        indexes  = [models.Index(fields=["user", "module"])]
        verbose_name = "Результат теста"

    def __str__(self):
        return f"{self.user} / {self.module} попытка {self.attempt_num} → {self.score}"

    @property
    def score_percent(self) -> float | None:
        if self.score is None or self.max_score is None or self.max_score == 0:
            return None
        return round(float(self.score) / float(self.max_score) * 100, 1)


class AttemptRequest(models.Model):
    """Заявка студента на дополнительную попытку прохождения теста."""
    class Status(models.TextChoices):
        PENDING  = "pending",  "Ожидает"
        APPROVED = "approved", "Одобрена"
        REJECTED = "rejected", "Отклонена"

    student          = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="attempt_requests",
    )
    module           = models.ForeignKey(
        CourseModule, on_delete=models.CASCADE, related_name="attempt_requests",
    )
    status           = models.CharField(
        "Статус", max_length=20,
        choices=Status.choices, default=Status.PENDING,
    )
    granted_attempts = models.PositiveSmallIntegerField("Выдано попыток", default=0)
    resolved_by      = models.ForeignKey(
        User, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="resolved_attempt_requests",
    )
    created_at       = models.DateTimeField(auto_now_add=True)
    resolved_at      = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "attempt_requests"
        ordering = ["-created_at"]
        indexes  = [models.Index(fields=["student", "module"])]
        verbose_name = "Заявка на попытку"
        verbose_name_plural = "Заявки на попытки"

    def __str__(self):
        return f"{self.student} → {self.module} [{self.status}]"


# ── Учебные группы (потоки) ──────────────────────────────────

class StudentGroup(models.Model):
    """Учебная группа (поток) — набор студентов для пакетного зачисления и аналитики."""
    class Status(models.TextChoices):
        ACTIVE   = "active",   "Активна"
        ARCHIVED = "archived", "Архив"

    name        = models.CharField("Название", max_length=200)
    code        = models.CharField("Код", max_length=50, blank=True)
    description = models.TextField("Описание", blank=True)
    curator     = models.ForeignKey(
        User, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="curated_groups",
        verbose_name="Куратор",
    )
    status      = models.CharField(
        "Статус", max_length=20,
        choices=Status.choices, default=Status.ACTIVE,
    )
    students    = models.ManyToManyField(
        User, through="StudentGroupMember",
        related_name="student_groups", verbose_name="Студенты",
    )
    created_by  = models.ForeignKey(
        User, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="created_groups",
    )
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "student_groups"
        ordering = ["-created_at"]
        indexes  = [models.Index(fields=["curator"])]
        verbose_name = "Учебная группа"
        verbose_name_plural = "Учебные группы"

    def __str__(self):
        return f"{self.name}" + (f" ({self.code})" if self.code else "")


class StudentGroupMember(models.Model):
    """Членство студента в учебной группе (through-модель)."""
    group     = models.ForeignKey(
        StudentGroup, on_delete=models.CASCADE, related_name="memberships",
    )
    student   = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="group_memberships",
    )
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table        = "student_group_members"
        unique_together = ("group", "student")
        verbose_name    = "Участник группы"
        verbose_name_plural = "Участники групп"

    def __str__(self):
        return f"{self.student} ∈ {self.group}"
