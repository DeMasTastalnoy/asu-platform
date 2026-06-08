import os
import uuid

import bleach
import markdown as md_lib
from rest_framework import viewsets, generics, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from django.conf import settings
from django.core.files.storage import default_storage
from django.utils.html import escape
from django.utils import timezone

from rest_framework.exceptions import PermissionDenied
from apps.users.permissions import (
    IsAdmin, IsInstructor, IsInstructorOrReadOnly, IsCourseContentOwnerOrReadOnly,
)
from apps.users.models import User
from apps.simulations.models import SimulationResult
from .models import (
    Course, CourseModule, Enrollment, ModuleProgress,
    TestQuestion, TestResult, AttemptRequest,
    StudentGroup, StudentGroupMember,
)
from .serializers import (
    CourseListSerializer, CourseDetailSerializer, CourseCreateSerializer,
    CourseModuleSerializer, CourseModuleCreateSerializer,
    EnrollmentSerializer, EnrollmentCreateSerializer,
    TestQuestionSerializer, TestResultSerializer, TestSubmitSerializer,
    AttemptRequestSerializer, test_passed, module_locked,
    StudentGroupSerializer, StudentGroupMemberSerializer,
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

    @action(detail=True, methods=["get"], url_path="group-analytics", permission_classes=[IsInstructor])
    def group_analytics(self, request, pk=None):
        """GET /api/courses/{id}/group-analytics/ — успеваемость курса в разрезе групп.

        Сводка по курсу + сравнение учебных групп (завершение, средний балл по
        тестам) + разбор по модулям-тестам (средний балл, % сдавших).
        """
        course = self.get_object()
        if (request.user.primary_role == "instructor"
                and course.instructor_id != request.user.id):
            return Response({"detail": "Это чужой курс."}, status=status.HTTP_403_FORBIDDEN)

        enrollments  = list(Enrollment.objects.filter(course=course).select_related("student", "group"))
        test_modules = list(course.modules.filter(type=CourseModule.Type.TEST))
        tm_ids       = [m.id for m in test_modules]
        thresholds   = {}
        for m in test_modules:
            s = getattr(m, "test_settings", None)
            thresholds[m.id] = float(s.passing_score) if s else 60.0

        # Лучший результат (%) каждого студента по каждому тест-модулю.
        best = {}  # (user_id, module_id) -> pct
        if tm_ids:
            for r in TestResult.objects.filter(module_id__in=tm_ids):
                pct = r.score_percent
                if pct is None:
                    continue
                key = (r.user_id, r.module_id)
                if key not in best or pct > best[key]:
                    best[key] = pct

        def student_course_avg(uid):
            vals = [best[(uid, mid)] for mid in tm_ids if (uid, mid) in best]
            return sum(vals) / len(vals) if vals else None

        # Симуляции курса: лучший результат (%) каждого студента по сим-модулю + успешность.
        sim_modules = list(course.modules.filter(type=CourseModule.Type.SIMULATION))
        sm_ids      = [m.id for m in sim_modules]
        best_sim    = {}  # (user_id, module_id) -> pct
        best_sim_ok = {}  # (user_id, module_id) -> bool (лучший проход без аварии)
        if sm_ids:
            sim_qs = SimulationResult.objects.filter(
                simulation__module__course=course, enrollment__isnull=False,
            ).select_related("enrollment", "simulation")
            for r in sim_qs:
                mid = r.simulation.module_id
                if mid not in sm_ids:
                    continue
                pct = r.score_percent
                if pct is None:
                    continue
                key = (r.enrollment.student_id, mid)
                if key not in best_sim or pct > best_sim[key]:
                    best_sim[key]    = pct
                    best_sim_ok[key] = bool(r.completed and not r.safety_tripped)

        def student_sim_avg(uid):
            vals = [best_sim[(uid, mid)] for mid in sm_ids if (uid, mid) in best_sim]
            return sum(vals) / len(vals) if vals else None

        # Группировка зачислений по учебной группе (None → «Без группы»).
        from collections import defaultdict
        by_group = defaultdict(list)
        for e in enrollments:
            by_group[e.group].append(e)

        groups_out = []
        for g, ens in by_group.items():
            comp = [e.get_progress_percent() for e in ens]
            avgs = [a for a in (student_course_avg(e.student_id) for e in ens) if a is not None]
            savg = [a for a in (student_sim_avg(e.student_id) for e in ens) if a is not None]
            groups_out.append({
                "group_id":        g.id if g else None,
                "name":            g.name if g else "Без группы",
                "code":            g.code if g else "",
                "students":        len(ens),
                "completed":       sum(1 for c in comp if c >= 100),
                "completion_rate": round(sum(comp) / len(comp), 1) if comp else 0.0,
                "avg_test_score":  round(sum(avgs) / len(avgs), 1) if avgs else None,
                "avg_sim_score":   round(sum(savg) / len(savg), 1) if savg else None,
            })
        groups_out.sort(key=lambda x: (x["group_id"] is None, -x["completion_rate"]))

        # Фильтр детальной части (сводка/тесты/симуляции/студенты) по группе.
        # Сравнение групп (groups_out) остаётся глобальным.
        group_param = request.query_params.get("group")
        detail_enr  = enrollments
        if group_param and group_param.isdigit():
            gid = int(group_param)
            detail_enr = [e for e in enrollments if e.group_id == gid]
        detail_ids = {e.student_id for e in detail_enr}

        # Разбор по тест-модулям курса (в пределах выбранных студентов).
        modules_out = []
        for m in test_modules:
            pcts = [v for (uid, mid), v in best.items() if mid == m.id and uid in detail_ids]
            passed = sum(1 for p in pcts if p >= thresholds[m.id])
            modules_out.append({
                "module_id": m.id,
                "title":     m.title,
                "attempted": len(pcts),
                "avg_score": round(sum(pcts) / len(pcts), 1) if pcts else None,
                "pass_rate": round(passed / len(pcts) * 100, 1) if pcts else None,
            })

        # Разбор по сим-модулям курса (success = пройдено без аварии).
        sims_out = []
        for m in sim_modules:
            pcts = [v for (uid, mid), v in best_sim.items() if mid == m.id and uid in detail_ids]
            oks  = [best_sim_ok[(uid, mid)] for (uid, mid) in best_sim
                    if mid == m.id and uid in detail_ids]
            sims_out.append({
                "module_id":    m.id,
                "title":        m.title,
                "attempted":    len(pcts),
                "avg_score":    round(sum(pcts) / len(pcts), 1) if pcts else None,
                "success_rate": round(sum(1 for o in oks if o) / len(oks) * 100, 1) if oks else None,
            })

        # Разбивка по студентам (с учётом фильтра).
        students_out = []
        for e in detail_enr:
            at = student_course_avg(e.student_id)
            asim = student_sim_avg(e.student_id)
            prog = e.get_progress_percent()
            students_out.append({
                "student_id":  e.student_id,
                "name":        e.student.full_name or e.student.username,
                "group":       e.group.name if e.group else "—",
                "progress":    prog,
                "avg_test":    round(at, 1) if at is not None else None,
                "avg_sim":     round(asim, 1) if asim is not None else None,
                "completed":   prog >= 100,
            })
        students_out.sort(key=lambda s: -s["progress"])

        all_comp = [e.get_progress_percent() for e in detail_enr]
        all_avgs = [a for a in (student_course_avg(e.student_id) for e in detail_enr) if a is not None]
        all_savg = [a for a in (student_sim_avg(e.student_id) for e in detail_enr) if a is not None]
        summary = {
            "enrolled":        len(detail_enr),
            "completed":       sum(1 for c in all_comp if c >= 100),
            "completion_rate": round(sum(all_comp) / len(all_comp), 1) if all_comp else 0.0,
            "avg_test_score":  round(sum(all_avgs) / len(all_avgs), 1) if all_avgs else None,
            "avg_sim_score":   round(sum(all_savg) / len(all_savg), 1) if all_savg else None,
            "test_modules":    len(test_modules),
            "sim_modules":     len(sim_modules),
        }
        return Response({
            "course_id":    course.id,
            "course_title": course.title,
            "group":        int(group_param) if (group_param and group_param.isdigit()) else None,
            "summary":      summary,
            "groups":       groups_out,
            "modules":      modules_out,
            "sims":         sims_out,
            "students":     students_out,
        })

    @action(detail=True, methods=["get"], url_path="student-detail", permission_classes=[IsInstructor])
    def student_detail(self, request, pk=None):
        """GET /api/courses/{id}/student-detail/?student=<id> — детализация по студенту."""
        course = self.get_object()
        if (request.user.primary_role == "instructor"
                and course.instructor_id != request.user.id):
            return Response({"detail": "Это чужой курс."}, status=status.HTTP_403_FORBIDDEN)

        student_id = request.query_params.get("student")
        enrollment = Enrollment.objects.filter(
            course=course, student_id=student_id,
        ).select_related("student", "group").first()
        if not enrollment:
            return Response({"detail": "Студент не записан на курс."},
                            status=status.HTTP_404_NOT_FOUND)
        student = enrollment.student

        # Тесты курса по студенту.
        tests_out = []
        for m in course.modules.filter(type=CourseModule.Type.TEST):
            s = getattr(m, "test_settings", None)
            threshold = float(s.passing_score) if s else 60.0
            rs = list(m.test_results.filter(user=student))
            pcts = [r.score_percent for r in rs if r.score_percent is not None]
            best = max(pcts) if pcts else None
            last = max((r.completed_at or r.started_at for r in rs), default=None)
            tests_out.append({
                "module_id": m.id,
                "title":     m.title,
                "attempts":  len(rs),
                "best_pct":  round(best, 1) if best is not None else None,
                "passing":   threshold,
                "passed":    best is not None and best >= threshold,
                "last_at":   last,
            })

        # Симуляции курса по студенту.
        sims_out = []
        sim_modules = list(course.modules.filter(type=CourseModule.Type.SIMULATION))
        sim_results = SimulationResult.objects.filter(
            simulation__module__course=course, enrollment__student=student,
        ).select_related("simulation")
        by_mod = {}
        for r in sim_results:
            by_mod.setdefault(r.simulation.module_id, []).append(r)
        for m in sim_modules:
            rs = by_mod.get(m.id, [])
            pcts = [r.score_percent for r in rs if r.score_percent is not None]
            best = max(pcts) if pcts else None
            best_ok = False
            if best is not None:
                for r in rs:
                    if r.score_percent == best:
                        best_ok = bool(r.completed and not r.safety_tripped)
                        break
            last = max((r.completed_at or r.started_at for r in rs), default=None)
            sims_out.append({
                "module_id": m.id,
                "title":     m.title,
                "attempts":  len(rs),
                "best_pct":  round(best, 1) if best is not None else None,
                "success":   best_ok,
                "last_at":   last,
            })

        return Response({
            "student_id": student.id,
            "name":       student.full_name or student.username,
            "group":      enrollment.group.name if enrollment.group else "—",
            "progress":   enrollment.get_progress_percent(),
            "tests":      tests_out,
            "sims":       sims_out,
        })


class CourseModuleViewSet(viewsets.ModelViewSet):
    """
    GET    /api/modules/          — список модулей
    POST   /api/modules/          — создать модуль (инструктор)
    PATCH  /api/modules/{id}/     — изменить
    DELETE /api/modules/{id}/     — удалить
    POST   /api/modules/{id}/complete/ — отметить модуль завершённым
    """
    permission_classes = [IsCourseContentOwnerOrReadOnly]

    def perform_create(self, serializer):
        # Инструктор может добавлять модули только в свои курсы.
        course = serializer.validated_data.get("course")
        user   = self.request.user
        if user.primary_role != "admin" and course and course.instructor_id != user.id:
            raise PermissionDenied("Можно добавлять модули только в свои курсы.")
        serializer.save()

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

    def retrieve(self, request, *args, **kwargs):
        """Студент не может открыть модуль, пока не завершён предшествующий."""
        module = self.get_object()
        if module_locked(module, request.user):
            return Response(
                {"detail": "Модуль заблокирован: сначала завершите предыдущий."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().retrieve(request, *args, **kwargs)

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

        all_results = list(module.test_results.select_related("user").all())

        # Фильтр детальной части по учебной группе (?group=<id>).
        group_param = request.query_params.get("group")
        results = all_results
        if group_param:
            member_ids = set(StudentGroupMember.objects.filter(
                group_id=group_param
            ).values_list("student_id", flat=True))
            results = [r for r in all_results if r.user_id in member_ids]

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

        # Сравнение учебных групп (всегда по всем результатам, без учёта фильтра).
        results_by_user = {}
        for r in all_results:
            results_by_user.setdefault(r.user_id, []).append(r)
        groups_qs = StudentGroup.objects.all()
        if request.user.primary_role == "instructor":
            groups_qs = groups_qs.filter(curator=request.user)
        groups_cmp = []
        for g in groups_qs:
            member_ids = g.memberships.values_list("student_id", flat=True)
            g_best = []
            g_passed = 0
            for uid in member_ids:
                rs = results_by_user.get(uid)
                if not rs:
                    continue
                pcts = [x.score_percent for x in rs if x.score_percent is not None]
                if not pcts:
                    continue
                best = max(pcts)
                g_best.append(best)
                if best >= threshold:
                    g_passed += 1
            if not g_best:
                continue  # в этой группе никто не проходил тест — пропускаем
            groups_cmp.append({
                "group_id":  g.id,
                "name":      g.name,
                "code":      g.code,
                "students":  len(g_best),
                "avg_best":  round(sum(g_best) / len(g_best), 1),
                "pass_rate": round(g_passed / len(g_best) * 100, 1),
            })
        groups_cmp.sort(key=lambda x: -x["pass_rate"])

        return Response({
            "module_id": module.id,
            "title":     module.title,
            "group":     int(group_param) if group_param else None,
            "summary":   summary,
            "students":  students,
            "questions": questions,
            "groups":    groups_cmp,
        })

    @action(detail=True, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def complete(self, request, pk=None):
        """POST /api/modules/{id}/complete/ — студент завершил модуль."""
        module = self.get_object()

        # Нельзя завершить заблокированный модуль (предшественник не пройден).
        if module_locked(module, request.user):
            return Response(
                {"detail": "Модуль заблокирован: сначала завершите предыдущий."},
                status=status.HTTP_403_FORBIDDEN,
            )

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


class ModuleUploadView(APIView):
    """POST /api/modules/upload/ — загрузка файла модуля (документ/видео). Возвращает URL."""
    permission_classes = [IsInstructor]
    parser_classes     = [MultiPartParser, FormParser]

    ALLOWED  = {
        ".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".txt", ".rtf",
        ".mp4", ".webm", ".ogg", ".mov", ".m4v",
        ".png", ".jpg", ".jpeg", ".gif",
    }

    def post(self, request):
        f = request.FILES.get("file")
        if not f:
            return Response({"detail": "Файл не передан."}, status=status.HTTP_400_BAD_REQUEST)
        ext = os.path.splitext(f.name)[1].lower()
        if ext not in self.ALLOWED:
            return Response({"detail": f"Недопустимый тип файла: {ext or '—'}"},
                            status=status.HTTP_400_BAD_REQUEST)
        max_mb = settings.MODULE_UPLOAD_MAX_MB
        if f.size > max_mb * 1024 * 1024:
            return Response({"detail": f"Файл слишком большой (макс. {max_mb} МБ)."},
                            status=status.HTTP_400_BAD_REQUEST)
        stored = default_storage.save(f"module_files/{uuid.uuid4().hex}{ext}", f)
        return Response({
            "url":  settings.MEDIA_URL + stored,
            "name": f.name,
            "ext":  ext.lstrip("."),
        }, status=status.HTTP_201_CREATED)


# Разрешённые теги/атрибуты при импорте текста (защита от XSS).
_ALLOWED_TAGS = [
    "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "blockquote",
    "h1", "h2", "h3", "h4", "ul", "ol", "li", "a", "code", "pre", "span",
    "table", "thead", "tbody", "tr", "th", "td",
]
_ALLOWED_ATTRS = {"a": ["href", "title", "target", "rel"]}


class ModuleParseTextView(APIView):
    """POST /api/modules/parse-text/ — импорт текста лекции (.md/.html/.txt) → безопасный HTML."""
    permission_classes = [IsInstructor]
    parser_classes     = [MultiPartParser, FormParser]

    def post(self, request):
        f = request.FILES.get("file")
        if not f:
            return Response({"detail": "Файл не передан."}, status=status.HTTP_400_BAD_REQUEST)
        if f.size > 5 * 1024 * 1024:
            return Response({"detail": "Текстовый файл слишком большой (макс. 5 МБ)."},
                            status=status.HTTP_400_BAD_REQUEST)
        ext = os.path.splitext(f.name)[1].lower()
        raw = f.read().decode("utf-8", errors="replace")

        if ext == ".md":
            html = md_lib.markdown(raw, extensions=["extra", "sane_lists", "nl2br"])
        elif ext in (".html", ".htm"):
            html = raw
        else:  # .txt и прочее
            html = "".join(
                f"<p>{escape(line)}</p>" for line in raw.splitlines() if line.strip()
            )

        clean = bleach.clean(html, tags=_ALLOWED_TAGS, attributes=_ALLOWED_ATTRS, strip=True)
        return Response({"html": clean})


class TestQuestionViewSet(viewsets.ModelViewSet):
    """
    GET    /api/questions/?module_id=1 — вопросы теста
    POST   /api/questions/             — создать вопрос (инструктор)
    PATCH  /api/questions/{id}/        — изменить
    DELETE /api/questions/{id}/        — удалить
    """
    serializer_class   = TestQuestionSerializer
    permission_classes = [IsCourseContentOwnerOrReadOnly]

    def perform_create(self, serializer):
        # Вопросы можно добавлять только в тесты своих курсов.
        module = serializer.validated_data.get("module")
        user   = self.request.user
        if user.primary_role != "admin" and module and module.course.instructor_id != user.id:
            raise PermissionDenied("Можно добавлять вопросы только в свои тесты.")
        serializer.save()

    def get_queryset(self):
        qs        = TestQuestion.objects.select_related("module__course")
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


class StudentGroupViewSet(viewsets.ModelViewSet):
    """
    GET/POST   /api/groups/                  — список/создание групп
    PATCH/DELETE /api/groups/{id}/            — правка/удаление
    GET  /api/groups/{id}/members/           — участники группы
    POST /api/groups/{id}/add_members/       — добавить {student_ids:[]}
    POST /api/groups/{id}/remove_members/    — убрать {student_ids:[]} (без отчисления)
    POST /api/groups/{id}/enroll/            — зачислить всех на курс {course_id, deadline?}
    POST /api/groups/{id}/archive/           — в архив

    Видимость: инструктор — только свои группы (curator=он); admin — все.
    """
    serializer_class   = StudentGroupSerializer
    permission_classes = [IsInstructor]

    def get_queryset(self):
        qs   = StudentGroup.objects.select_related("curator")
        user = self.request.user
        if user.primary_role == "instructor":
            qs = qs.filter(curator=user)
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        return qs

    def _check_owner(self, group):
        """True, если текущий пользователь вправе менять группу."""
        user = self.request.user
        return user.primary_role == "admin" or group.curator_id == user.id

    @action(detail=True, methods=["get"])
    def members(self, request, pk=None):
        group   = self.get_object()
        members = group.memberships.select_related("student").all()
        return Response(StudentGroupMemberSerializer(members, many=True).data)

    @action(detail=True, methods=["post"])
    def add_members(self, request, pk=None):
        group = self.get_object()
        if not self._check_owner(group):
            return Response({"detail": "Это чужая группа."}, status=status.HTTP_403_FORBIDDEN)
        ids = request.data.get("student_ids", [])
        students = User.objects.filter(id__in=ids, primary_role="student")
        added = 0
        for s in students:
            _, created = StudentGroupMember.objects.get_or_create(group=group, student=s)
            if created:
                added += 1
        return Response({"added": added, "members_count": group.memberships.count()})

    @action(detail=True, methods=["post"])
    def remove_members(self, request, pk=None):
        group = self.get_object()
        if not self._check_owner(group):
            return Response({"detail": "Это чужая группа."}, status=status.HTTP_403_FORBIDDEN)
        ids = request.data.get("student_ids", [])
        removed, _ = StudentGroupMember.objects.filter(
            group=group, student_id__in=ids
        ).delete()
        # Зачисления на курсы НЕ трогаем: членство ≠ зачисление.
        return Response({"removed": removed, "members_count": group.memberships.count()})

    @action(detail=True, methods=["post"])
    def enroll(self, request, pk=None):
        """Пакетно зачисляет всех участников группы на курс."""
        group = self.get_object()
        if not self._check_owner(group):
            return Response({"detail": "Это чужая группа."}, status=status.HTTP_403_FORBIDDEN)

        course_id = request.data.get("course_id")
        deadline  = request.data.get("deadline") or None
        try:
            course = Course.objects.get(pk=course_id)
        except Course.DoesNotExist:
            return Response({"detail": "Курс не найден."}, status=status.HTTP_404_NOT_FOUND)
        if request.user.primary_role == "instructor" and course.instructor_id != request.user.id:
            return Response({"detail": "Это чужой курс."}, status=status.HTTP_403_FORBIDDEN)

        enrolled = 0   # новых зачислений
        tagged   = 0   # существующих, помеченных этой группой
        for member in group.memberships.select_related("student"):
            enr, created = Enrollment.objects.get_or_create(
                course=course, student=member.student,
                defaults={
                    "enrolled_by": request.user,
                    "group":       group,
                    "deadline":    deadline,
                },
            )
            if created:
                enrolled += 1
            elif enr.group_id is None:
                # уже зачислен индивидуально — связываем с группой для аналитики
                enr.group = group
                enr.save(update_fields=["group"])
                tagged += 1
        return Response({
            "enrolled":     enrolled,
            "tagged":       tagged,
            "course_title": course.title,
            "total":        group.memberships.count(),
        })

    @action(detail=True, methods=["post"])
    def archive(self, request, pk=None):
        group = self.get_object()
        if not self._check_owner(group):
            return Response({"detail": "Это чужая группа."}, status=status.HTTP_403_FORBIDDEN)
        group.status = StudentGroup.Status.ARCHIVED
        group.save(update_fields=["status"])
        return Response(self.get_serializer(group).data)
