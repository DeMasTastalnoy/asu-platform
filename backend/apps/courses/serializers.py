from django.db.models import Sum
from rest_framework import serializers
from .models import (
    Course, CourseModule, Enrollment, ModuleProgress,
    TestSettings, TestQuestion, TestResult, AttemptRequest,
    StudentGroup, StudentGroupMember,
)
from apps.users.serializers import UserSerializer


def attempt_allowance(module, user):
    """Считает попытки теста для пользователя: лимит, использовано, выдано доп.

    limit == 0 трактуется как «без ограничения». Возвращает dict с флагом
    blocked и наличием ожидающей заявки.
    """
    settings = getattr(module, "test_settings", None)
    limit    = settings.max_attempts if settings else 0
    used     = module.test_results.filter(user=user).count()
    granted  = AttemptRequest.objects.filter(
        student=user, module=module, status=AttemptRequest.Status.APPROVED,
    ).aggregate(s=Sum("granted_attempts"))["s"] or 0
    pending  = AttemptRequest.objects.filter(
        student=user, module=module, status=AttemptRequest.Status.PENDING,
    ).exists()
    blocked  = limit > 0 and used >= limit + granted
    return {
        "limit":           limit,
        "used":            used,
        "granted":         granted,
        "blocked":         blocked,
        "pending_request": pending,
    }


def module_locked(module, user):
    """True, если модуль закрыт для студента: задан unlock_after и предшественник не завершён.

    Преподаватель/админ не блокируются. Незаписанный студент не блокируется
    (доступ к курсу решают другие проверки).
    """
    if not module.unlock_after_id:
        return False
    if getattr(user, "primary_role", None) != "student":
        return False
    enrollment = Enrollment.objects.filter(
        course_id=module.course_id, student=user,
    ).first()
    if not enrollment:
        return False
    return not ModuleProgress.objects.filter(
        enrollment=enrollment, module_id=module.unlock_after_id,
        status=ModuleProgress.Status.COMPLETED,
    ).exists()


def test_passed(module, user):
    """Сдан ли тест пользователем — есть ли попытка с % ≥ проходного балла."""
    settings  = getattr(module, "test_settings", None)
    threshold = float(settings.passing_score) if settings else 60.0
    for r in module.test_results.filter(user=user):
        pct = r.score_percent
        if pct is not None and pct >= threshold:
            return True
    return False


class TestSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model  = TestSettings
        fields = (
            "time_limit_sec", "max_attempts", "passing_score",
            "shuffle_questions", "show_answers_after",
        )


class CourseModuleSerializer(serializers.ModelSerializer):
    test_settings  = TestSettingsSerializer(read_only=True)
    progress       = serializers.SerializerMethodField()
    course_title   = serializers.CharField(source="course.title", read_only=True)
    question_count = serializers.SerializerMethodField()
    attempts       = serializers.SerializerMethodField()

    class Meta:
        model  = CourseModule
        fields = (
            "id", "course", "course_title", "title", "type", "content", "file_url",
            "order_num", "is_required", "unlock_after",
            "test_settings", "question_count", "attempts", "progress", "created_at",
        )

    def get_question_count(self, obj):
        return obj.questions.count()

    def get_attempts(self, obj):
        """Состояние попыток теста для текущего пользователя (None для не-тестов)."""
        if obj.type != CourseModule.Type.TEST:
            return None
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        return attempt_allowance(obj, request.user)

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
            "id", "course", "title", "type", "content",
            "file_url", "order_num", "is_required",
            "unlock_after", "test_settings",
        )
        read_only_fields = ("id",)

    def create(self, validated_data):
        test_settings_data = validated_data.pop("test_settings", None)
        module = CourseModule.objects.create(**validated_data)
        if test_settings_data and module.type == CourseModule.Type.TEST:
            TestSettings.objects.create(module=module, **test_settings_data)
        return module

    def update(self, instance, validated_data):
        test_settings_data = validated_data.pop("test_settings", None)
        module = super().update(instance, validated_data)
        # Настройки теста сохраняем только если переданы (чтобы не затереть при обычном PATCH).
        if test_settings_data is not None and module.type == CourseModule.Type.TEST:
            TestSettings.objects.update_or_create(
                module=module, defaults=test_settings_data,
            )
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
            CourseModule.objects.get(pk=value, type=CourseModule.Type.TEST)
        except CourseModule.DoesNotExist:
            raise serializers.ValidationError("Тестовый модуль не найден.")
        return value

    def validate(self, attrs):
        """Блокируем отправку, если исчерпан лимит попыток (0 = без ограничения)."""
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            module = CourseModule.objects.get(pk=attrs["module_id"])
            if module_locked(module, request.user):
                raise serializers.ValidationError(
                    "Тест заблокирован: сначала завершите предыдущий модуль."
                )
            allowance = attempt_allowance(module, request.user)
            if allowance["blocked"]:
                raise serializers.ValidationError(
                    "Исчерпан лимит попыток. Обратитесь к преподавателю за доступом."
                )
        return attrs

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


class AttemptRequestSerializer(serializers.ModelSerializer):
    student_name  = serializers.CharField(source="student.full_name", read_only=True)
    module_title  = serializers.CharField(source="module.title",      read_only=True)
    course_title  = serializers.CharField(source="module.course.title", read_only=True)
    attempts_used = serializers.SerializerMethodField()

    class Meta:
        model  = AttemptRequest
        fields = (
            "id", "student", "student_name", "module", "module_title", "course_title",
            "status", "granted_attempts", "attempts_used",
            "created_at", "resolved_at",
        )
        read_only_fields = (
            "id", "student", "student_name", "module_title", "course_title",
            "status", "granted_attempts", "attempts_used",
            "created_at", "resolved_at",
        )

    def get_attempts_used(self, obj):
        return obj.module.test_results.filter(user=obj.student).count()

    def validate_module(self, module):
        if module.type != CourseModule.Type.TEST:
            raise serializers.ValidationError("Модуль не является тестом.")
        return module

    def create(self, validated_data):
        student = self.context["request"].user
        module  = validated_data["module"]
        # Не плодим дубли: если есть открытая заявка — возвращаем её.
        existing = AttemptRequest.objects.filter(
            student=student, module=module,
            status=AttemptRequest.Status.PENDING,
        ).first()
        if existing:
            return existing
        return AttemptRequest.objects.create(student=student, module=module)


class StudentGroupMemberSerializer(serializers.ModelSerializer):
    student_id   = serializers.IntegerField(source="student.id",        read_only=True)
    student_name = serializers.CharField(source="student.full_name",    read_only=True)
    username     = serializers.CharField(source="student.username",     read_only=True)
    email        = serializers.CharField(source="student.email",        read_only=True)

    class Meta:
        model  = StudentGroupMember
        fields = ("student_id", "student_name", "username", "email", "joined_at")


class StudentGroupSerializer(serializers.ModelSerializer):
    curator_name  = serializers.CharField(source="curator.full_name", read_only=True)
    members_count = serializers.SerializerMethodField()

    class Meta:
        model  = StudentGroup
        fields = (
            "id", "name", "code", "description",
            "curator", "curator_name", "status",
            "members_count", "created_at",
        )
        read_only_fields = ("id", "curator", "curator_name", "created_at")

    def get_members_count(self, obj):
        return obj.memberships.count()

    def create(self, validated_data):
        user = self.context["request"].user
        validated_data["curator"]    = user
        validated_data["created_by"] = user
        return super().create(validated_data)
