from rest_framework import viewsets, generics, permissions
from rest_framework.response import Response
from rest_framework.decorators import action
from django.db.models import Avg, Count

from apps.users.permissions import IsAdmin, IsInstructor
from apps.courses.models import Enrollment, TestResult
from apps.simulations.models import SimulationResult
from .models import CourseAnalytics, Certificate
from .serializers import CourseAnalyticsSerializer, CertificateSerializer


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
    GET /api/analytics/certificates/        — сертификаты
    GET /api/analytics/certificates/{id}/   — один сертификат
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
