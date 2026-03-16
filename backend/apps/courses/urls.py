from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CourseViewSet, CourseModuleViewSet, EnrollmentViewSet,
    TestQuestionViewSet, TestSubmitView, TestResultViewSet,
)

router = DefaultRouter()
router.register("courses",      CourseViewSet,       basename="course")
router.register("modules",      CourseModuleViewSet, basename="module")
router.register("enrollments",  EnrollmentViewSet,   basename="enrollment")
router.register("questions",    TestQuestionViewSet, basename="question")
router.register("test-results", TestResultViewSet,   basename="test-result")

urlpatterns = [
    path("tests/submit/", TestSubmitView.as_view(), name="test-submit"),
    path("", include(router.urls)),
]
