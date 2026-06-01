from rest_framework import serializers
from .models import ElementLibrary, SimulationTemplate, SimulationResult


class ElementLibrarySerializer(serializers.ModelSerializer):
    class Meta:
        model  = ElementLibrary
        fields = ("id", "name", "category", "type", "library_set", "icon", "default_properties")


class SimulationTemplateSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", read_only=True)

    class Meta:
        model  = SimulationTemplate
        fields = (
            "id", "module", "name", "description", "author_name",
            "canvas_w", "canvas_h", "elements", "rules",
            "reference_scenario", "status", "library_set", "created_at", "updated_at",
        )
        read_only_fields = ("id", "author_name", "created_at", "updated_at")

    def create(self, validated_data):
        validated_data["author"] = self.context["request"].user
        return super().create(validated_data)


class SimulationResultSerializer(serializers.ModelSerializer):
    student_name    = serializers.CharField(source="enrollment.student.full_name", read_only=True)
    simulation_name = serializers.CharField(source="simulation.name", read_only=True)
    score_percent   = serializers.FloatField(read_only=True)

    class Meta:
        model  = SimulationResult
        fields = (
            "id", "simulation", "simulation_name", "enrollment",
            "student_name", "attempt_num",
            "score", "max_score", "score_percent",
            "actions_log", "deviations",
            "errors_count", "completed", "safety_tripped", "alarm_count",
            "time_spent_sec", "started_at", "completed_at",
        )
        read_only_fields = (
            "id", "attempt_num", "score", "max_score",
            "deviations", "started_at",
        )


class SimulationSubmitSerializer(serializers.Serializer):
    """Сохранение лога действий студента и автоматическая оценка."""

    # Штрафы за нарушение режима эксплуатации
    SAFETY_TRIP_FACTOR = 0.5   # балл умножается на коэффициент при срабатывании защиты
    ALARM_PENALTY      = 0.5   # дополнительный вычет за каждую аварию

    simulation_id  = serializers.IntegerField()
    enrollment_id  = serializers.IntegerField(required=False, allow_null=True)
    actions_log    = serializers.ListField(child=serializers.DictField())
    time_spent_sec = serializers.IntegerField(required=False)
    errors_count   = serializers.IntegerField(required=False, default=0)
    completed      = serializers.BooleanField(required=False, default=True)
    safety_tripped = serializers.BooleanField(required=False, default=False)
    alarm_count    = serializers.IntegerField(required=False, default=0)

    def validate(self, attrs):
        from apps.courses.models import Enrollment
        try:
            SimulationTemplate.objects.get(pk=attrs["simulation_id"])
        except SimulationTemplate.DoesNotExist:
            raise serializers.ValidationError({"simulation_id": "Симуляция не найдена."})

        # enrollment_id необязателен — для прямого запуска без курса
        if attrs.get("enrollment_id"):
            try:
                Enrollment.objects.get(pk=attrs["enrollment_id"])
            except Enrollment.DoesNotExist:
                raise serializers.ValidationError({"enrollment_id": "Зачисление не найдено."})
        return attrs

    def save(self):
        from django.utils import timezone
        from apps.courses.models import Enrollment

        sim = SimulationTemplate.objects.get(pk=self.validated_data["simulation_id"])
        enrollment_id = self.validated_data.get("enrollment_id")
        actions = self.validated_data["actions_log"]

        attempt_num = 1
        enrollment = None

        if enrollment_id:
            enrollment = Enrollment.objects.get(pk=enrollment_id)
            attempt_num = SimulationResult.objects.filter(
                simulation=sim, enrollment=enrollment
            ).count() + 1

        deviations, score, max_score = self._evaluate(actions, sim.reference_scenario, sim.elements)

        # Штраф за нарушение режима эксплуатации (срабатывание аварийной защиты)
        safety_tripped = self.validated_data.get("safety_tripped", False)
        alarm_count    = self.validated_data.get("alarm_count", 0)
        if safety_tripped and score is not None:
            penalized = max(0.0, score * self.SAFETY_TRIP_FACTOR - alarm_count * self.ALARM_PENALTY)
            deviations.append({
                "type":        "safety",
                "detail":      "Сработала аварийная защита — превышение давления",
                "alarm_count": alarm_count,
                "penalty":     round(score - penalized, 2),
            })
            score = round(penalized, 2)

        result = SimulationResult.objects.create(
            simulation=sim,
            enrollment=enrollment,
            attempt_num=attempt_num,
            score=score,
            max_score=max_score,
            actions_log=actions,
            deviations=deviations,
            time_spent_sec=self.validated_data.get("time_spent_sec"),
            errors_count=self.validated_data.get("errors_count", 0),
            completed=self.validated_data.get("completed", True),
            safety_tripped=self.validated_data.get("safety_tripped", False),
            alarm_count=self.validated_data.get("alarm_count", 0),
            completed_at=timezone.now(),
        )
        return result

    # Типы элементов-органов управления — только они оцениваются в сценарии.
    CONTROL_TYPES = {"button", "valve", "pump", "switch", "toggle"}

    def _evaluate(self, actions, reference, elements=None):
        """Сравнение действий студента с эталонным сценарием.

        Шаги, нацеленные на индикаторы (манометр, уровнемер, дисплей и т.п.),
        в оценке не участвуют — клик по ним не несёт смысловой нагрузки.
        """
        if not reference:
            return [], None, None

        # Тип элемента по его variable (element_id в сценарии == variable элемента)
        type_by_var = {e.get("variable"): e.get("type") for e in (elements or [])}
        reference = [
            s for s in reference
            if type_by_var.get(s.get("element_id")) in self.CONTROL_TYPES
        ]
        if not reference:
            return [], None, None

        max_score  = len(reference)
        score      = 0
        deviations = []

        actions_map = {a.get("element_id"): a for a in actions}

        for step in reference:
            step_num   = step.get("step")
            element_id = step.get("element_id")
            expected   = step.get("expected_value")
            actual_action = actions_map.get(element_id)

            if actual_action and actual_action.get("value") == expected:
                score += 1
            else:
                deviations.append({
                    "step":     step_num,
                    "expected": element_id,
                    "actual":   actual_action.get("element_id") if actual_action else None,
                    "penalty":  1,
                })

        return deviations, score, max_score
