from rest_framework import serializers
from .models import CourseAnalytics, Certificate, DiplomaRequest


class CourseAnalyticsSerializer(serializers.ModelSerializer):
    course_title    = serializers.CharField(source="course.title", read_only=True)
    completion_rate = serializers.FloatField(read_only=True)

    class Meta:
        model  = CourseAnalytics
        fields = (
            "course", "course_title",
            "total_enrolled", "total_completed", "completion_rate",
            "avg_test_score", "avg_sim_score",
            "avg_completion_days", "updated_at",
        )


class CertificateSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(
        source="enrollment.student.full_name", read_only=True,
    )
    course_title = serializers.CharField(
        source="enrollment.course.title", read_only=True,
    )

    class Meta:
        model  = Certificate
        fields = (
            "id", "enrollment", "student_name", "course_title",
            "number", "final_score", "file_url", "issued_at",
        )


class DiplomaRequestSerializer(serializers.ModelSerializer):
    student_name = serializers.CharField(source="enrollment.student.full_name", read_only=True)
    course_title = serializers.CharField(source="enrollment.course.title", read_only=True)
    course_id    = serializers.IntegerField(source="enrollment.course_id", read_only=True)

    class Meta:
        model  = DiplomaRequest
        fields = (
            "id", "enrollment", "course_id", "student_name", "course_title",
            "full_name", "email", "status", "number", "final_score",
            "comment", "requested_at", "issued_at",
        )
        read_only_fields = (
            "id", "course_id", "student_name", "course_title",
            "status", "number", "final_score", "issued_at", "requested_at",
        )
