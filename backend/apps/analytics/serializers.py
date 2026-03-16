from rest_framework import serializers
from .models import CourseAnalytics, Certificate


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
            "final_score", "file_url", "issued_at",
        )
