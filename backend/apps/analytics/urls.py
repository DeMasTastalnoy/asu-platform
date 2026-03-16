from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CourseAnalyticsViewSet, CertificateViewSet, StudentProgressView

router = DefaultRouter()
router.register("analytics/courses",      CourseAnalyticsViewSet, basename="analytics")
router.register("analytics/certificates", CertificateViewSet,     basename="certificate")

urlpatterns = [
    path("analytics/progress/<int:pk>/", StudentProgressView.as_view(), name="student-progress"),
    path("", include(router.urls)),
]
