from rest_framework import viewsets, generics, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from django.utils import timezone

from apps.users.permissions import IsAdmin, IsInstructor, IsInstructorOrReadOnly
from .models import (
    Course, CourseModule, Enrollment, ModuleProgress,
    TestQuestion, TestResult, AttemptRequest,
)
from .serializers import (
    CourseListSerializer, CourseDetailSerializer, CourseCreateSerializer,
    CourseModuleSerializer, CourseModuleCreateSerializer,
    EnrollmentSerializer, EnrollmentCreateSerializer,
    TestQuestionSerializer, TestResultSerializer, TestSubmitSerializer,
    AttemptRequestSerializer,
)


class CourseViewSet(viewsets.ModelViewSet):
    """
    GET    /api/courses/              — список курсов
    POST   /api/courses/              — создать курс (инструктор)
    GET    /api/courses/{id}/         — детали курса
    PATCH  /api/courses/{id}/         — изменить (инструктор/admin)
    DELETE /api/courses/{id}/         — удалить (admin)
    GET    /api/courses/{id}/modules/ — модули курса
    GET    /api/courses/{id}/students/— список студентов
    POST   /api/courses/{id}/publish/ — опубликовать
    """
    permission_classes = [IsInstructorOrReadOnly]

    def get_queryset(self):
        user = self.request.user
        qs   = Course.objects.select_related("instructor")
        if user.primary_role == "student":
            # студент видит только опубликованные курсы на которые записан
            enrolled_ids = Enrollment.objects.filter(
                student=user, status="active"
            ).values_list("course_id", flat=True)
            return qs.filter(id__in=enrolled_ids, status="published")
        if user.primary_role == "instructor":
            return qs.filter(instructor=user)
        return qs  # admin видит все

    def get_serializer_class(self):
        if self.action == "list":
            return CourseListSerializer
        if self.action in ("create", "update", "partial_update"):
            return CourseCreateSerializer
        return CourseDetailSerializer

    @action(detail=True, methods=["get"])
    def modules(self, request, pk=None):
        """GET /api/courses/{id}/modules/"""
        course = self.get_object()
        enrollment = Enrollment.objects.filter(
            course=course, student=request.user
        ).first()
        serializer = CourseModuleSerializer(
            course.modules.all(), many=True,
            context={"request": request, "enrollment": enrollment},
        )
        return Response(serializer.data)

    @action(detail=True, methods=["get"], permission_classes=[IsInstructor])
    def students(self, request, pk=None):
        """GET /api/courses/{id}/students/ — список зачисленных студентов."""
        course      = self.get_object()
        enrollments = Enrollment.objects.filter(course=course).select_related("student")
        serializer  = EnrollmentSerializer(enrollments, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], permission_classes=[IsInstructor])
    def publish(self, request, pk=None):
        """POST /api/courses/{id}/publish/"""
        course = self.get_object()
        course.status = Course.Status.PUBLISHED
        course.save(update_fields=["status"])
        return Response({"detail": "Курс опубликован."})


class CourseModuleViewSet(viewsets.ModelViewSet):
    """
    GET    /api/modules/          — список модулей
    POST   /api/modules/          — создать модуль (инструктор)
    PATCH  /api/modules/{id}/     — изменить
    DELETE /api/modules/{id}/     — удалить
    POST   /api/modules/{id}/complete/ — отметить модуль завершённым
    """
    permission_classes = [IsInstructorOrReadOnly]

    def get_queryset(self):
        qs = CourseModule.objects.select_related("course")
        # Список модулей скоупим по роли (для вкладки «Тестирование» и т.п.);
        # доступ к конкретному модулю (detail/complete) оставляем как был.
        if self.action == "list":
            user = self.request.user
            role = getattr(user, "primary_role", None)
            if role == "instructor":
                qs = qs.filter(course__instructor=user)
            elif role == "student":
                enrolled = Enrollment.objects.filter(
                    student=user
                ).values_list("course_id", flat=True)
                qs = qs.filter(course_id__in=enrolled)
            type_param = self.request.query_params.get("type")
            if type_param:
                qs = qs.filter(type=type_param)
        return qs

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return CourseModuleCreateSerializer
        return CourseModuleSerializer

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def complete(self, request, pk=None):
        """POST /api/modules/{id}/complete/ — студент завершил модуль."""
        module = self.get_object()
        enrollment = Enrollment.objects.filter(
            course=module.course, student=request.user, status="active"
        ).first()

        if not enrollment:
            return Response({"detail": "Модуль просмотрен.", "progress": "completed"})

        progress, _ = ModuleProgress.objects.get_or_create(
            enrollment=enrollment, module=module,
        )
        if progress.status != ModuleProgress.Status.COMPLETED:
            progress.status = ModuleProgress.Status.COMPLETED
            progress.completed_at = timezone.now()
            if not progress.started_at:
                progress.started_at = timezone.now()
            time_spent = request.data.get("time_spent_sec", 0)
            progress.time_spent_sec += time_spent
            progress.save()
        return Response({"detail": "Модуль отмечен как завершённый.", "progress": progress.status})


class EnrollmentViewSet(viewsets.ModelViewSet):
    """
    GET    /api/enrollments/      — список зачислений
    POST   /api/enrollments/      — зачислить студента
    DELETE /api/enrollments/{id}/ — отчислить
    """
    def get_queryset(self):
        user = self.request.user
        if user.primary_role == "student":
            return Enrollment.objects.filter(student=user).select_related("course")
        if user.primary_role == "instructor":
            return Enrollment.objects.filter(
                course__instructor=user
            ).select_related("course", "student")
        return Enrollment.objects.all().select_related("course", "student")

    def get_serializer_class(self):
        if self.action == "create":
            return EnrollmentCreateSerializer
        return EnrollmentSerializer

    def get_permissions(self):
        if self.action == "create":
            return [IsInstructor()]
        return [permissions.IsAuthenticated()]


class TestQuestionViewSet(viewsets.ModelViewSet):
    """
    GET    /api/questions/?module_id=1 — вопросы теста
    POST   /api/questions/             — создать вопрос (инструктор)
    PATCH  /api/questions/{id}/        — изменить
    DELETE /api/questions/{id}/        — удалить
    """
    serializer_class   = TestQuestionSerializer
    permission_classes = [IsInstructorOrReadOnly]

    def get_queryset(self):
        qs        = TestQuestion.objects.all()
        module_id = self.request.query_params.get("module_id")
        if module_id:
            qs = qs.filter(module_id=module_id)
        return qs


class TestSubmitView(generics.CreateAPIView):
    """POST /api/tests/submit/ — отправить ответы на тест."""
    serializer_class   = TestSubmitSerializer
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = serializer.save(user=request.user)
        return Response(
            TestResultSerializer(result).data,
            status=status.HTTP_201_CREATED,
        )


class TestResultViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/test-results/              — результаты (свои для студента, все для инструктора)
    GET /api/test-results/{id}/
    """
    serializer_class   = TestResultSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.primary_role == "student":
            return TestResult.objects.filter(user=user).select_related("module")
        return TestResult.objects.all().select_related("user", "module")


class AttemptRequestViewSet(viewsets.ModelViewSet):
    """
    GET  /api/attempt-requests/            — заявки (свои для студента, по своим курсам для инструктора)
    POST /api/attempt-requests/            — студент просит доп. попытку {module}
    POST /api/attempt-requests/{id}/approve/ — инструктор выдаёт попытку {granted_attempts?}
    POST /api/attempt-requests/{id}/reject/  — инструктор отклоняет
    """
    serializer_class   = AttemptRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs   = AttemptRequest.objects.select_related(
            "student", "module", "module__course",
        )
        role = getattr(user, "primary_role", None)
        if role == "student":
            qs = qs.filter(student=user)
        elif role == "instructor":
            qs = qs.filter(module__course__instructor=user)
        # admin — все
        module_id = self.request.query_params.get("module")
        if module_id:
            qs = qs.filter(module_id=module_id)
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        return qs

    def _resolve(self, request, pk, new_status, granted):
        """Общая обработка одобрения/отклонения инструктором."""
        if request.user.primary_role not in ("admin", "instructor"):
            return Response({"detail": "Недостаточно прав."}, status=status.HTTP_403_FORBIDDEN)
        req = self.get_object()
        if req.module.course.instructor_id != request.user.id and request.user.primary_role != "admin":
            return Response({"detail": "Это заявка по чужому курсу."}, status=status.HTTP_403_FORBIDDEN)
        req.status           = new_status
        req.granted_attempts = granted
        req.resolved_by      = request.user
        req.resolved_at      = timezone.now()
        req.save(update_fields=["status", "granted_attempts", "resolved_by", "resolved_at"])
        return Response(self.get_serializer(req).data)

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        try:
            granted = int(request.data.get("granted_attempts", 1))
        except (TypeError, ValueError):
            granted = 1
        granted = max(1, granted)
        return self._resolve(request, pk, AttemptRequest.Status.APPROVED, granted)

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._resolve(request, pk, AttemptRequest.Status.REJECTED, 0)
