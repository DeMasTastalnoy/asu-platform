from django.contrib import admin
from .models import (
    Course, Enrollment, CourseModule,
    ModuleProgress, TestSettings, TestQuestion, TestResult,
)


class CourseModuleInline(admin.TabularInline):
    model  = CourseModule
    extra  = 0
    fields = ("order_num", "title", "type", "is_required")
    ordering = ("order_num",)


class EnrollmentInline(admin.TabularInline):
    model  = Enrollment
    extra  = 0
    fields = ("student", "status", "enrolled_at", "deadline")
    readonly_fields = ("enrolled_at",)
    raw_id_fields   = ("student",)


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display  = ("title", "instructor", "status", "level", "modules_count", "created_at")
    list_filter   = ("status", "level")
    search_fields = ("title", "instructor__full_name")
    raw_id_fields = ("instructor",)
    inlines       = [CourseModuleInline, EnrollmentInline]


@admin.register(CourseModule)
class CourseModuleAdmin(admin.ModelAdmin):
    list_display  = ("title", "course", "type", "order_num", "is_required")
    list_filter   = ("type", "is_required")
    search_fields = ("title", "course__title")
    raw_id_fields = ("course", "unlock_after")


@admin.register(Enrollment)
class EnrollmentAdmin(admin.ModelAdmin):
    list_display  = ("student", "course", "status", "enrolled_at", "deadline")
    list_filter   = ("status",)
    raw_id_fields = ("student", "course", "enrolled_by")


@admin.register(TestQuestion)
class TestQuestionAdmin(admin.ModelAdmin):
    list_display  = ("module", "type", "points", "order_num")
    list_filter   = ("type",)
    raw_id_fields = ("module",)


@admin.register(TestResult)
class TestResultAdmin(admin.ModelAdmin):
    list_display  = ("user", "module", "attempt_num", "score", "max_score", "completed_at")
    list_filter   = ("module__course",)
    raw_id_fields = ("user", "module")
