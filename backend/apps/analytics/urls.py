from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CourseAnalyticsViewSet, CertificateViewSet, StudentProgressView,
    DiplomaRequestViewSet, StudentAchievementsView, StudentContinueView,
)

router = DefaultRouter()
router.register("analytics/courses",          CourseAnalyticsViewSet, basename="analytics")
router.register("analytics/certificates",     CertificateViewSet,     basename="certificate")
router.register("analytics/diploma-requests", DiplomaRequestViewSet,  basename="diploma-request")

urlpatterns = [
    path("analytics/progress/<int:pk>/", StudentProgressView.as_view(), name="student-progress"),
    path("analytics/achievements/",      StudentAchievementsView.as_view(), name="achievements"),
    path("analytics/continue/",          StudentContinueView.as_view(),     name="continue"),
    path("", include(router.urls)),
]
