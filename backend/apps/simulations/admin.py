from django.contrib import admin
from .models import ElementLibrary, SimulationTemplate, SimulationResult


@admin.register(ElementLibrary)
class ElementLibraryAdmin(admin.ModelAdmin):
    list_display  = ("id", "name", "category", "type", "is_active")
    list_filter   = ("category", "is_active")
    search_fields = ("name", "id")


@admin.register(SimulationTemplate)
class SimulationTemplateAdmin(admin.ModelAdmin):
    list_display  = ("id", "name", "author", "module", "status", "created_at")
    list_filter   = ("status",)
    search_fields = ("name",)
    raw_id_fields = ("author", "module")
    readonly_fields = ("created_at", "updated_at")
    fields = ("name", "description", "module", "author", "status", "elements", "rules", "reference_scenario", "canvas_w", "canvas_h")


@admin.register(SimulationResult)
class SimulationResultAdmin(admin.ModelAdmin):
    list_display  = ("student", "simulation", "attempt_num", "score", "completed_at")
    raw_id_fields = ("simulation", "enrollment")

    def student(self, obj):
        return obj.enrollment.student
    student.short_description = "Студент"
