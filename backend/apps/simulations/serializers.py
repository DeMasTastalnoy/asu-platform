from rest_framework import serializers
from .models import ElementLibrary, SimulationTemplate, SimulationResult


class ElementLibrarySerializer(serializers.ModelSerializer):
    class Meta:
        model  = ElementLibrary
        fields = ("id", "name", "category", "type", "icon", "default_properties")


class SimulationTemplateSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", read_only=True)

    class Meta:
        model  = SimulationTemplate
        fields = (
            "id", "module", "name", "description", "author_name",
            "canvas_w", "canvas_h", "elements", "rules",
            "reference_scenario", "status", "created_at", "updated_at",
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
            "time_spent_sec", "started_at", "completed_at",
        )
        read_only_fields = (
            "id", "attempt_num", "score", "max_score",
            "deviations", "started_at",
        )


class SimulationSubmitSerializer(serializers.Serializer):
    """Сохранение лога действий студента и автоматическая оценка."""
    simulation_id  = serializers.IntegerField()
    enrollment_id  = serializers.IntegerField()
    actions_log    = serializers.ListField(child=serializers.DictField())
    time_spent_sec = serializers.IntegerField(required=False)

    def validate(self, attrs):
        from apps.courses.models import Enrollment
        try:
            SimulationTemplate.objects.get(pk=attrs["simulation_id"])
        except SimulationTemplate.DoesNotExist:
            raise serializers.ValidationError({"simulation_id": "Симуляция не найдена."})
        try:
            Enrollment.objects.get(pk=attrs["enrollment_id"])
        except Enrollment.DoesNotExist:
            raise serializers.ValidationError({"enrollment_id": "Зачисление не найдено."})
        return attrs

    def save(self):
        from django.utils import timezone
        from apps.courses.models import Enrollment

        sim        = SimulationTemplate.objects.get(pk=self.validated_data["simulation_id"])
        enrollment = Enrollment.objects.get(pk=self.validated_data["enrollment_id"])
        actions    = self.validated_data["actions_log"]
        attempt_num = SimulationResult.objects.filter(
            simulation=sim, enrollment=enrollment
        ).count() + 1

        # сравниваем лог с эталонным сценарием
        deviations, score, max_score = self._evaluate(actions, sim.reference_scenario)

        result = SimulationResult.objects.create(
            simulation     = sim,
            enrollment     = enrollment,
            attempt_num    = attempt_num,
            score          = score,
            max_score      = max_score,
            actions_log    = actions,
            deviations     = deviations,
            time_spent_sec = self.validated_data.get("time_spent_sec"),
            completed_at   = timezone.now(),
        )
        return result

    def _evaluate(self, actions, reference):
        """Сравнение действий студента с эталонным сценарием."""
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
