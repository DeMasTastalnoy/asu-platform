from django.db import models
from apps.users.models import User
from apps.courses.models import CourseModule, Enrollment


class ElementLibrary(models.Model):
    """Библиотека типовых элементов АСУ для конструктора симуляций."""

    LIBRARY_SETS = [
        ('universal',    'Универсальная'),
        ('boiler',       'Котельная установка'),
        ('pump_station', 'Насосная станция'),
        ('substation',   'Электроподстанция'),
    ]

    id                 = models.CharField(primary_key=True, max_length=50)
    name               = models.CharField("Название", max_length=100)
    category           = models.CharField(
        "Категория", max_length=50,
        help_text="controls | indicators | pipes | valves | sensors",
    )
    type               = models.CharField("Тип элемента", max_length=50)
    library_set        = models.CharField(
        "Библиотека АСУ", max_length=50,
        choices=LIBRARY_SETS, default='universal'
    )
    icon               = models.CharField("Иконка (SVG/URL)", max_length=500, blank=True)
    default_properties = models.JSONField("Свойства по умолчанию", default=dict)
    is_active          = models.BooleanField("Активен", default=True)

    class Meta:
        db_table     = "element_library"
        ordering     = ["library_set", "category", "name"]
        verbose_name = "Элемент библиотеки"
        verbose_name_plural = "Библиотека элементов"

    def __str__(self):
        return f"[{self.library_set}] {self.name}"


class SimulationTemplate(models.Model):
    """Шаблон симуляции, созданный инструктором в конструкторе."""

    class Status(models.TextChoices):
        DRAFT     = "draft",     "Черновик"
        PUBLISHED = "published", "Опубликован"

    module      = models.OneToOneField(
        CourseModule, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="simulation_template",
        verbose_name="Модуль курса",
    )
    author      = models.ForeignKey(
        User, on_delete=models.RESTRICT, related_name="simulation_templates",
        verbose_name="Автор",
    )
    name        = models.CharField("Название", max_length=200)
    description = models.TextField("Описание", blank=True)
    canvas_w    = models.PositiveIntegerField("Ширина холста (px)", default=1200)
    canvas_h    = models.PositiveIntegerField("Высота холста (px)", default=700)

    # elements: список объектов Konva
    # [{"id":"btn-01","type":"button","x":100,"y":200,"props":{...},"variable":"btn_start"}, ...]
    elements    = models.JSONField("Элементы холста")

    # rules: список триггеров ЕСЛИ-ТО
    # [{"id":"r1","if":{"variable":"btn_start","op":"eq","value":true},
    #   "then":[{"variable":"pump_status","set":true}]}, ...]
    rules       = models.JSONField("Правила (триггеры)", default=list, blank=True)

    # reference_scenario: эталонная последовательность действий для оценки
    # [{"step":1,"element_id":"btn-01","action":"click","expected_value":true,"timeout_sec":30}, ...]
    reference_scenario = models.JSONField("Эталонный сценарий", default=list, blank=True)

    library_set = models.CharField(
        "Библиотека АСУ", max_length=50, default='universal',
    )
    status      = models.CharField(
        "Статус", max_length=20,
        choices=Status.choices, default=Status.DRAFT,
    )
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "simulation_templates"
        indexes  = [
            models.Index(fields=["author"]),
            models.Index(fields=["module"]),
        ]
        verbose_name = "Шаблон симуляции"
        verbose_name_plural = "Шаблоны симуляций"

    def __str__(self):
        return f"{self.name} [{self.status}]"


class SimulationResult(models.Model):
    """Результат прохождения симуляции студентом."""

    simulation  = models.ForeignKey(
        SimulationTemplate, on_delete=models.CASCADE, related_name="results",
    )
    enrollment = models.ForeignKey(
        Enrollment, on_delete=models.CASCADE, related_name="simulation_results",
        null=True, blank=True,  # добавить эти два параметра
    )
    attempt_num = models.PositiveSmallIntegerField("Номер попытки", default=1)
    score       = models.DecimalField("Балл", max_digits=5, decimal_places=2, null=True, blank=True)
    max_score   = models.DecimalField("Макс. балл", max_digits=5, decimal_places=2, null=True, blank=True)

    # actions_log: хронологический лог всех действий студента
    # [{"ts": "2025-03-15T10:00:01Z", "element_id": "btn-01",
    #   "action": "click", "value": true, "step_index": 1}, ...]
    actions_log = models.JSONField("Лог действий")

    # deviations: отклонения от эталонного сценария
    # [{"step": 2, "expected": "btn-02", "actual": "btn-03",
    #   "delay_sec": 45, "penalty": 10}, ...]
    deviations  = models.JSONField("Отклонения от эталона", default=list, blank=True)

    time_spent_sec = models.PositiveIntegerField("Время (сек)", null=True, blank=True)

    # Итог прохождения и эксплуатационная безопасность
    errors_count   = models.PositiveSmallIntegerField("Ошибочных действий", default=0)
    completed      = models.BooleanField("Пройдено полностью", default=True)
    safety_tripped = models.BooleanField("Сработала аварийная защита", default=False)
    alarm_count    = models.PositiveSmallIntegerField("Кол-во аварий", default=0)

    started_at  = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "simulation_results"
        indexes  = [models.Index(fields=["simulation", "enrollment"])]
        verbose_name = "Результат симуляции"
        verbose_name_plural = "Результаты симуляций"

    def __str__(self):
        return (
            f"{self.enrollment.student} / {self.simulation.name} "
            f"попытка {self.attempt_num} → {self.score}"
        )

    @property
    def score_percent(self) -> float | None:
        if self.score is None or self.max_score is None or self.max_score == 0:
            return None
        return round(float(self.score) / float(self.max_score) * 100, 1)

    @property
    def student(self):
        return self.enrollment.student
