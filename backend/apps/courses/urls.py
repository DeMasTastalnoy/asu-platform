from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    CourseViewSet, CourseModuleViewSet, EnrollmentViewSet,
    TestQuestionViewSet, TestSubmitView, TestResultViewSet,
    AttemptRequestViewSet, StudentGroupViewSet,
    ModuleUploadView, ModuleParseTextView,
)

router = DefaultRouter()
router.register("courses",          CourseViewSet,        basename="course")
router.register("modules",          CourseModuleViewSet,  basename="module")
router.register("enrollments",      EnrollmentViewSet,    basename="enrollment")
router.register("questions",        TestQuestionViewSet,  basename="question")
router.register("test-results",     TestResultViewSet,    basename="test-result")
router.register("attempt-requests", AttemptRequestViewSet, basename="attempt-request")
router.register("groups",           StudentGroupViewSet,  basename="group")

urlpatterns = [
    path("tests/submit/",       TestSubmitView.as_view(),     name="test-submit"),
    path("modules/upload/",     ModuleUploadView.as_view(),   name="module-upload"),
    path("modules/parse-text/", ModuleParseTextView.as_view(), name="module-parse-text"),
    path("", include(router.urls)),
]
