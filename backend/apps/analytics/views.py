from rest_framework import viewsets, generics, permissions, status
from rest_framework.response import Response
from rest_framework.decorators import action
from rest_framework.views import APIView
from django.db.models import Avg, Count
from django.utils import timezone

from apps.users.permissions import IsAdmin, IsInstructor
from apps.courses.models import Enrollment, TestResult
from apps.simulations.models import SimulationResult
from .models import CourseAnalytics, Certificate, DiplomaRequest
from .serializers import (
    CourseAnalyticsSerializer, CertificateSerializer, DiplomaRequestSerializer,
)
from . import services


class CourseAnalyticsViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/analytics/courses/        — аналитика по всем курсам (admin)
    GET /api/analytics/courses/{id}/   — аналитика по одному курсу
    POST /api/analytics/courses/{id}/refresh/ — пересчитать вручную
    """
    serializer_class   = CourseAnalyticsSerializer
    permission_classes = [IsInstructor]

    def get_queryset(self):
        user = self.request.user
        qs   = CourseAnalytics.objects.select_related("course")
        if user.primary_role == "instructor":
            return qs.filter(course__instructor=user)
        return qs

    @action(detail=True, methods=["post"], permission_classes=[IsInstructor])
    def refresh(self, request, pk=None):
        """POST /api/analytics/courses/{id}/refresh/ — пересчитать статистику."""
        analytics = self.get_object()
        course    = analytics.course

        enrollments = Enrollment.objects.filter(course=course)
        total_enrolled  = enrollments.count()
        total_completed = enrollments.filter(status="completed").count()

        avg_test = TestResult.objects.filter(
            module__course=course
        ).aggregate(avg=Avg("score"))["avg"]

        avg_sim = SimulationResult.objects.filter(
            simulation__module__course=course
        ).aggregate(avg=Avg("score"))["avg"]

        analytics.total_enrolled  = total_enrolled
        analytics.total_completed = total_completed
        analytics.avg_test_score  = round(avg_test, 2) if avg_test else None
        analytics.avg_sim_score   = round(avg_sim,  2) if avg_sim  else None
        analytics.save()

        return Response(CourseAnalyticsSerializer(analytics).data)


class CertificateViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET  /api/analytics/certificates/        — сертификаты
    GET  /api/analytics/certificates/{id}/   — один сертификат
    POST /api/analytics/certificates/issue/  — сформировать сертификат {enrollment_id}
    """
    serializer_class   = CertificateSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs   = Certificate.objects.select_related(
            "enrollment__student", "enrollment__course"
        )
        if user.primary_role == "student":
            return qs.filter(enrollment__student=user)
        if user.primary_role == "instructor":
            return qs.filter(enrollment__course__instructor=user)
        return qs

    @action(detail=False, methods=["post"])
    def issue(self, request):
        """Студент сам формирует сертификат по завершённому курсу."""
        enrollment_id = request.data.get("enrollment_id")
        enrollment = Enrollment.objects.filter(pk=enrollment_id).select_related(
            "student", "course"
        ).first()
        if not enrollment:
            return Response({"detail": "Зачисление не найдено."}, status=status.HTTP_404_NOT_FOUND)
        if enrollment.student_id != request.user.id:
            return Response({"detail": "Это чужое зачисление."}, status=status.HTTP_403_FORBIDDEN)
        if enrollment.get_progress_percent() < 100:
            return Response({"detail": "Курс ещё не завершён."}, status=status.HTTP_400_BAD_REQUEST)

        cert = Certificate.objects.filter(enrollment=enrollment).first()
        if cert is None or not cert.file_url:
            if cert is None:
                cert = Certificate.objects.create(
                    enrollment=enrollment,
                    final_score=services.final_score(enrollment),
                )
            cert.number   = services.reg_number("С", cert.id)
            cert.file_url = services.render_certificate_pdf(cert)
            cert.save(update_fields=["number", "file_url", "final_score"])
        return Response(CertificateSerializer(cert).data, status=status.HTTP_200_OK)


class DiplomaRequestViewSet(viewsets.ModelViewSet):
    """
    GET  /api/analytics/diploma-requests/          — заявки (свои/все для admin)
    POST /api/analytics/diploma-requests/          — подать заявку {enrollment, full_name, email}
    POST /api/analytics/diploma-requests/{id}/issue/  — оформить (admin)
    POST /api/analytics/diploma-requests/{id}/reject/ — отклонить (admin)
    """
    serializer_class   = DiplomaRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        qs   = DiplomaRequest.objects.select_related(
            "enrollment__student", "enrollment__course",
        )
        role = getattr(user, "primary_role", None)
        if role == "student":
            qs = qs.filter(enrollment__student=user)
        elif role != "admin":
            qs = qs.none()  # дипломы оформляет администратор
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        return qs

    def create(self, request, *args, **kwargs):
        enrollment = Enrollment.objects.filter(
            pk=request.data.get("enrollment")
        ).select_related("course").first()
        if not enrollment:
            return Response({"detail": "Зачисление не найдено."}, status=status.HTTP_404_NOT_FOUND)
        if enrollment.student_id != request.user.id:
            return Response({"detail": "Это чужое зачисление."}, status=status.HTTP_403_FORBIDDEN)
        if enrollment.get_progress_percent() < 100:
            return Response({"detail": "Курс ещё не завершён."}, status=status.HTTP_400_BAD_REQUEST)

        existing = DiplomaRequest.objects.filter(enrollment=enrollment).first()
        if existing:
            return Response(DiplomaRequestSerializer(existing).data, status=status.HTTP_200_OK)

        full_name = (request.data.get("full_name") or request.user.full_name or "").strip()
        email     = (request.data.get("email") or request.user.email or "").strip()
        if not full_name or not email:
            return Response({"detail": "Укажите ФИО и email."}, status=status.HTTP_400_BAD_REQUEST)

        req = DiplomaRequest.objects.create(
            enrollment=enrollment, full_name=full_name, email=email,
            final_score=services.final_score(enrollment),
        )
        return Response(DiplomaRequestSerializer(req).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def issue(self, request, pk=None):
        req = self.get_object()
        req.status    = DiplomaRequest.Status.ISSUED
        req.number    = services.reg_number("Д", req.id)
        req.issued_at = timezone.now()
        req.issued_by = request.user
        req.save(update_fields=["status", "number", "issued_at", "issued_by"])
        return Response(self.get_serializer(req).data)

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def reject(self, request, pk=None):
        req = self.get_object()
        req.status  = DiplomaRequest.Status.REJECTED
        req.comment = (request.data.get("comment") or "").strip()
        req.save(update_fields=["status", "comment"])
        return Response(self.get_serializer(req).data)


class StudentAchievementsView(APIView):
    """GET /api/analytics/achievements/ — достижения студента по его курсам."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        enrollments = Enrollment.objects.filter(
            student=request.user
        ).select_related("course")

        courses = []
        agg_tests_done = agg_tests_total = agg_sims_done = agg_sims_total = 0
        prog_sum = 0.0
        for e in enrollments:
            stats = services.course_stats(e)
            cert  = Certificate.objects.filter(enrollment=e).first()
            dipl  = DiplomaRequest.objects.filter(enrollment=e).first()
            completed = stats["progress"] >= 100
            courses.append({
                "enrollment_id": e.id,
                "course_id":     e.course_id,
                "course_title":  e.course.title,
                "progress":      stats["progress"],
                "completed":     completed,
                "tests_done":    stats["tests_done"],
                "tests_total":   stats["tests_total"],
                "sims_done":     stats["sims_done"],
                "sims_total":    stats["sims_total"],
                "final_score":   services.final_score(e),
                "certificate":   CertificateSerializer(cert).data if cert and cert.file_url else None,
                "diploma":       DiplomaRequestSerializer(dipl).data if dipl else None,
            })
            agg_tests_done  += stats["tests_done"];  agg_tests_total += stats["tests_total"]
            agg_sims_done   += stats["sims_done"];   agg_sims_total  += stats["sims_total"]
            prog_sum        += stats["progress"]

        n = len(courses)
        summary = {
            "courses":       n,
            "avg_progress":  round(prog_sum / n, 1) if n else 0.0,
            "tests_done":    agg_tests_done,  "tests_total": agg_tests_total,
            "sims_done":     agg_sims_done,   "sims_total":  agg_sims_total,
        }
        return Response({"summary": summary, "courses": courses})


class StudentProgressView(generics.RetrieveAPIView):
    """
    GET /api/analytics/progress/{enrollment_id}/
    Детальный прогресс студента по курсу.
    """
    permission_classes = [permissions.IsAuthenticated]

    def retrieve(self, request, *args, **kwargs):
        from apps.courses.models import Enrollment, ModuleProgress
        from apps.courses.serializers import EnrollmentSerializer

        enrollment_id = self.kwargs.get("pk")
        try:
            enrollment = Enrollment.objects.select_related(
                "course", "student"
            ).get(pk=enrollment_id)
        except Enrollment.DoesNotExist:
            return Response({"detail": "Зачисление не найдено."}, status=404)

        # проверяем доступ
        user = request.user
        if user.primary_role == "student" and enrollment.student != user:
            return Response({"detail": "Нет доступа."}, status=403)

        progresses = ModuleProgress.objects.filter(
            enrollment=enrollment
        ).select_related("module")

        modules_data = []
        for mp in progresses:
            modules_data.append({
                "module_id":     mp.module.id,
                "module_title":  mp.module.title,
                "module_type":   mp.module.type,
                "status":        mp.status,
                "time_spent_sec": mp.time_spent_sec,
                "completed_at":  mp.completed_at,
            })

        return Response({
            "enrollment_id": enrollment.id,
            "course":        enrollment.course.title,
            "student":       enrollment.student.full_name,
            "status":        enrollment.status,
            "progress_pct":  enrollment.get_progress_percent(),
            "deadline":      enrollment.deadline,
            "modules":       modules_data,
        })
