from django.db import models
from apps.courses.models import Course, Enrollment


class CourseAnalytics(models.Model):
    """
    Агрегированная статистика по курсу.
    Обновляется фоновой задачей Celery — не считается при каждом запросе.
    """

    course               = models.OneToOneField(
        Course, on_delete=models.CASCADE,
        related_name="analytics", primary_key=True,
    )
    total_enrolled       = models.PositiveIntegerField("Всего зачислено", default=0)
    total_completed      = models.PositiveIntegerField("Всего завершили", default=0)
    avg_test_score       = models.DecimalField(
        "Ср. балл тестов", max_digits=5, decimal_places=2,
        null=True, blank=True,
    )
    avg_sim_score        = models.DecimalField(
        "Ср. балл симуляций", max_digits=5, decimal_places=2,
        null=True, blank=True,
    )
    avg_completion_days  = models.DecimalField(
        "Ср. дней до завершения", max_digits=6, decimal_places=1,
        null=True, blank=True,
    )
    updated_at           = models.DateTimeField(auto_now=True)

    class Meta:
        db_table     = "course_analytics"
        verbose_name = "Аналитика курса"

    def __str__(self):
        return f"Аналитика: {self.course.title}"

    @property
    def completion_rate(self) -> float:
        if self.total_enrolled == 0:
            return 0.0
        return round(self.total_completed / self.total_enrolled * 100, 1)


class Certificate(models.Model):
    """Сертификат о завершении курса (формируется автоматически студентом)."""

    enrollment  = models.OneToOneField(
        Enrollment, on_delete=models.CASCADE,
        related_name="certificate",
    )
    number      = models.CharField("Рег. номер", max_length=40, blank=True, db_index=True)
    final_score = models.DecimalField(
        "Итоговый балл", max_digits=5, decimal_places=2,
        null=True, blank=True,
    )
    file_url    = models.CharField("PDF (URL)", max_length=500, blank=True)
    issued_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table     = "certificates"
        verbose_name = "Сертификат"
        verbose_name_plural = "Сертификаты"

    def __str__(self):
        return (
            f"Сертификат {self.number}: {self.enrollment.student} / "
            f"{self.enrollment.course} ({self.issued_at:%d.%m.%Y})"
        )


class DiplomaRequest(models.Model):
    """Заявка студента на диплом о завершении курса (оформляется администратором)."""
    class Status(models.TextChoices):
        PENDING  = "pending",  "Новая"
        ISSUED   = "issued",   "Оформлен"
        REJECTED = "rejected", "Отклонена"

    enrollment    = models.OneToOneField(
        Enrollment, on_delete=models.CASCADE,
        related_name="diploma_request",
    )
    full_name     = models.CharField("ФИО (подтверждённое)", max_length=150)
    email         = models.EmailField("Email (подтверждённый)", max_length=150)
    status        = models.CharField(
        "Статус", max_length=20,
        choices=Status.choices, default=Status.PENDING,
    )
    number        = models.CharField("Рег. номер диплома", max_length=40, blank=True)
    final_score   = models.DecimalField(
        "Итоговый балл", max_digits=5, decimal_places=2, null=True, blank=True,
    )
    comment       = models.CharField("Комментарий", max_length=300, blank=True)
    requested_at  = models.DateTimeField(auto_now_add=True)
    issued_at     = models.DateTimeField(null=True, blank=True)
    issued_by     = models.ForeignKey(
        "users.User", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="issued_diplomas",
    )

    class Meta:
        db_table     = "diploma_requests"
        ordering     = ["-requested_at"]
        verbose_name = "Заявка на диплом"
        verbose_name_plural = "Заявки на дипломы"

    def __str__(self):
        return f"Диплом [{self.status}]: {self.full_name} / {self.enrollment.course}"
