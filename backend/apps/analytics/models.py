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
    """Документ о завершении курса (требование ФЗ-273, ст. 60)."""

    enrollment  = models.OneToOneField(
        Enrollment, on_delete=models.CASCADE,
        related_name="certificate",
    )
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
            f"Сертификат: {self.enrollment.student} / "
            f"{self.enrollment.course} ({self.issued_at:%d.%m.%Y})"
        )
