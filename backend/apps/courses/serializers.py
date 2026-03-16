from rest_framework import serializers
from .models import (
    Course, CourseModule, Enrollment, ModuleProgress,
    TestSettings, TestQuestion, TestResult,
)
from apps.users.serializers import UserSerializer


class TestSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TestSettings
        fields = (
            "time_limit_sec", "max_attempts", "passing_score",
            "shuffle_questions", "show_answers_after",
        )


class CourseModuleSerializer(serializers.ModelSerializer):
    test_settings = TestSettingsSerializer(read_only=True)
    progress      = serializers.SerializerMethodField()

    class Meta:
        model  = CourseModule
        fields = (
            "id", "title", "type", "content", "file_url",
            "order_num", "is_required", "unlock_after",
            "test_settings", "progress", "created_at",
        )

    def get_progress(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        enrollment = self.context.get("enrollment")
        if not enrollment:
            return None
        progress = ModuleProgress.objects.filter(
            enrollment=enrollment, module=obj,
        ).first()
        if not progress:
            return {"status": "not_started", "time_spent_sec": 0}
        return {
            "status":          progress.status,
            "time_spent_sec":  progress.time_spent_sec,
            "started_at":      progress.started_at,
            "completed_at":    progress.completed_at,
        }


class CourseModuleCreateSerializer(serializers.ModelSerializer):
    test_settings = TestSettingsSerializer(required=False)

    class Meta:
        model  = CourseModule
        fields = (
            "course", "title", "type", "content",
            "file_url", "order_num", "is_required",
            "unlock_after", "test_settings",
        )

    def create(self, validated_data):
        test_settings_data = validated_data.pop("test_settings", None)
        module = CourseModule.objects.create(**validated_data)
        if test_settings_data and module.type == CourseModule.Type.TEST:
            TestSettings.objects.create(module=module, **test_settings_data)
        return module


class CourseListSerializer(serializers.ModelSerializer):
    instructor_name = serializers.CharField(source="instructor.full_name", read_only=True)
    modules_count   = serializers.IntegerField(read_only=True)

    class Meta:
        model  = Course
        fields = (
            "id", "title", "description", "instructor_name",
            "status", "level", "cover_image",
            "modules_count", "created_at",
        )


class CourseDetailSerializer(serializers.ModelSerializer):
    instructor = UserSerializer(read_only=True)
    modules    = CourseModuleSerializer(many=True, read_only=True)

    class Meta:
        model  = Course
        fields = (
            "id", "title", "description", "instructor",
            "status", "level", "cover_image",
            "modules", "created_at", "updated_at",
        )


class CourseCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Course
        fields = ("id", "title", "description", "status", "level", "cover_image")
        read_only_fields = ("id",)

    def create(self, validated_data):
        validated_data["instructor"] = self.context["request"].user
        return super().create(validated_data)


class EnrollmentSerializer(serializers.ModelSerializer):
    student_name  = serializers.CharField(source="student.full_name",  read_only=True)
    course_title  = serializers.CharField(source="course.title",       read_only=True)
    progress      = serializers.SerializerMethodField()

    class Meta:
        model  = Enrollment
        fields = (
            "id", "course", "course_title", "student", "student_name",
            "status", "deadline", "enrolled_at", "completed_at", "progress",
        )
        read_only_fields = ("id", "enrolled_at", "completed_at")

    def get_progress(self, obj):
        return obj.get_progress_percent()


class EnrollmentCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Enrollment
        fields = ("course", "student", "deadline")

    def create(self, validated_data):
        validated_data["enrolled_by"] = self.context["request"].user
        return super().create(validated_data)


class TestQuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TestQuestion
        fields = (
            "id", "module", "question", "type",
            "options", "correct_answer", "points", "order_num",
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)
        # скрываем правильный ответ для студентов
        request = self.context.get("request")
        if request and request.user.primary_role == "student":
            data.pop("correct_answer", None)
        return data


class TestResultSerializer(serializers.ModelSerializer):
    score_percent = serializers.FloatField(read_only=True)
    module_title  = serializers.CharField(source="module.title", read_only=True)

    class Meta:
        model  = TestResult
        fields = (
            "id", "user", "module", "module_title", "attempt_num",
            "score", "max_score", "score_percent",
            "answers", "time_spent_sec",
            "started_at", "completed_at",
        )
        read_only_fields = ("id", "started_at", "attempt_num", "score", "max_score")


class TestSubmitSerializer(serializers.Serializer):
    """Сериализатор для отправки ответов на тест."""
    module_id      = serializers.IntegerField()
    answers        = serializers.ListField(child=serializers.DictField())
    time_spent_sec = serializers.IntegerField(required=False)

    def validate_module_id(self, value):
        try:
            module = CourseModule.objects.get(pk=value, type=CourseModule.Type.TEST)
        except CourseModule.DoesNotExist:
            raise serializers.ValidationError("Тестовый модуль не найден.")
        return value

    def save(self, user):
        from django.utils import timezone
        module_id = self.validated_data["module_id"]
        answers   = self.validated_data["answers"]
        module    = CourseModule.objects.get(pk=module_id)
        questions = {q.id: q for q in module.questions.all()}

        attempt_num = TestResult.objects.filter(user=user, module=module).count() + 1

        scored   = []
        score    = 0
        max_score = sum(q.points for q in questions.values())

        for answer in answers:
            q_id     = answer.get("question_id")
            given    = answer.get("answer")
            question = questions.get(q_id)
            if not question:
                continue
            correct   = question.correct_answer
            is_correct = (given == correct) if not isinstance(correct, list) \
                else (set(given) == set(correct) if isinstance(given, list) else False)
            if is_correct:
                score += question.points
            scored.append({
                "question_id": q_id,
                "answer":      given,
                "is_correct":  is_correct,
            })

        result = TestResult.objects.create(
            user           = user,
            module         = module,
            attempt_num    = attempt_num,
            score          = score,
            max_score      = max_score,
            answers        = scored,
            time_spent_sec = self.validated_data.get("time_spent_sec"),
            completed_at   = timezone.now(),
        )
        return result
