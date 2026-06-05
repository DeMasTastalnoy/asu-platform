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
    AttemptRequestSerializer, test_passed,
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

    @action(detail=True, methods=["get"], permission_classes=[IsInstructor])
    def analytics(self, request, pk=None):
        """GET /api/modules/{id}/analytics/ — статистика по тесту (для преподавателя).

        Сводка: число студентов, попыток, средний балл, % сдавших + разбивка
        по студентам (число попыток, лучший результат, последняя попытка, сдал).
        """
        module = self.get_object()
        if module.type != CourseModule.Type.TEST:
            return Response({"detail": "Модуль не является тестом."},
                            status=status.HTTP_400_BAD_REQUEST)
        if (request.user.primary_role == "instructor"
                and module.course.instructor_id != request.user.id):
            return Response({"detail": "Это тест чужого курса."},
                            status=status.HTTP_403_FORBIDDEN)

        settings  = getattr(module, "test_settings", None)
        threshold = float(settings.passing_score) if settings else 60.0

        results = list(module.test_results.select_related("user").all())
        by_student = {}
        for r in results:
            by_student.setdefault(r.user, []).append(r)

        students      = []
        best_pcts     = []
        passed_count  = 0
        for user, rs in by_student.items():
            pcts = [r.score_percent for r in rs if r.score_percent is not None]
            best = max(pcts) if pcts else None
            last = max((r.completed_at or r.started_at) for r in rs)
            is_passed = best is not None and best >= threshold
            if is_passed:
                passed_count += 1
            if best is not None:
                best_pcts.append(best)
            students.append({
                "student_id":   user.id,
                "student_name": user.full_name or user.username,
                "attempts":     len(rs),
                "best_pct":     round(best, 1) if best is not None else None,
                "last_at":      last,
                "passed":       is_passed,
            })
        # лучшие сверху, «нет результата» — в конец
        students.sort(key=lambda s: (s["best_pct"] is None, -(s["best_pct"] or 0)))

        all_pcts = [r.score_percent for r in results if r.score_percent is not None]
        n_students = len(by_student)
        summary = {
            "students":       n_students,
            "total_attempts": len(results),
            "avg_score":      round(sum(all_pcts) / len(all_pcts), 1) if all_pcts else None,
            "avg_best":       round(sum(best_pcts) / len(best_pcts), 1) if best_pcts else None,
            "pass_rate":      round(passed_count / n_students * 100, 1) if n_students else None,
            "passing_score":  threshold,
            "question_count": module.questions.count(),
        }

        # Сложность вопросов: доля верных ответов по каждому вопросу (по всем попыткам).
        q_stats = {}  # question_id -> [answered, correct]
        for r in results:
            for a in (r.answers or []):
                qid = a.get("question_id")
                if qid is None:
                    continue
                st = q_stats.setdefault(qid, [0, 0])
                st[0] += 1
                if a.get("is_correct"):
                    st[1] += 1
        questions = []
        for q in module.questions.all():
            answered, correct = q_stats.get(q.id, [0, 0])
            rate = round(correct / answered * 100, 1) if answered else None
            questions.append({
                "question_id":  q.id,
                "question":     q.question,
                "points":       q.points,
                "answered":     answered,
                "correct":      correct,
                "correct_rate": rate,
            })
        # сложные (низкий % верных) — сверху; вопросы без ответов — в конец
        questions.sort(key=lambda x: (x["correct_rate"] is None,
                                      x["correct_rate"] if x["correct_rate"] is not None else 0))

        return Response({
            "module_id": module.id,
            "title":     module.title,
            "summary":   summary,
            "students":  students,
            "questions": questions,
        })

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def complete(self, request, pk=None):
        """POST /api/modules/{id}/complete/ — студент завершил модуль."""
        module = self.get_object()

        # Тест засчитываем завершённым только при сдаче (по проходному баллу).
        if module.type == CourseModule.Type.TEST and not test_passed(module, request.user):
            return Response(
                {"detail": "Тест не сдан — модуль не засчитан.", "progress": "in_progress"},
                status=status.HTTP_400_BAD_REQUEST,
            )

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
