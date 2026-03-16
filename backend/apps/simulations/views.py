from rest_framework import viewsets, generics, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.users.permissions import IsInstructor, IsInstructorOrReadOnly
from .models import ElementLibrary, SimulationTemplate, SimulationResult
from .serializers import (
    ElementLibrarySerializer, SimulationTemplateSerializer,
    SimulationResultSerializer, SimulationSubmitSerializer,
)


class ElementLibraryViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/simulations/elements/         — полная библиотека элементов АСУ
    GET /api/simulations/elements/?category=controls — фильтр по категории
    """
    serializer_class   = ElementLibrarySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs       = ElementLibrary.objects.filter(is_active=True)
        category = self.request.query_params.get("category")
        if category:
            qs = qs.filter(category=category)
        return qs


class SimulationTemplateViewSet(viewsets.ModelViewSet):
    """
    GET    /api/simulations/templates/        — список шаблонов
    POST   /api/simulations/templates/        — создать (инструктор)
    GET    /api/simulations/templates/{id}/   — детали
    PATCH  /api/simulations/templates/{id}/   — изменить
    DELETE /api/simulations/templates/{id}/   — удалить
    POST   /api/simulations/templates/{id}/publish/  — опубликовать
    POST   /api/simulations/templates/{id}/duplicate/ — копировать
    """
    serializer_class   = SimulationTemplateSerializer
    permission_classes = [IsInstructorOrReadOnly]

    def get_queryset(self):
        user = self.request.user
        if user.primary_role == "student":
            return SimulationTemplate.objects.filter(status="published")
        if user.primary_role == "instructor":
            return SimulationTemplate.objects.filter(author=user)
        return SimulationTemplate.objects.all()

    @action(detail=True, methods=["post"], permission_classes=[IsInstructor])
    def publish(self, request, pk=None):
        """POST /api/simulations/templates/{id}/publish/"""
        template = self.get_object()
        template.status = SimulationTemplate.Status.PUBLISHED
        template.save(update_fields=["status"])
        return Response({"detail": "Симуляция опубликована."})

    @action(detail=True, methods=["post"], permission_classes=[IsInstructor])
    def duplicate(self, request, pk=None):
        """POST /api/simulations/templates/{id}/duplicate/ — копировать шаблон."""
        template    = self.get_object()
        new_template = SimulationTemplate.objects.create(
            module             = None,
            author             = request.user,
            name               = f"{template.name} (копия)",
            description        = template.description,
            canvas_w           = template.canvas_w,
            canvas_h           = template.canvas_h,
            elements           = template.elements,
            rules              = template.rules,
            reference_scenario = template.reference_scenario,
            status             = SimulationTemplate.Status.DRAFT,
        )
        serializer = SimulationTemplateSerializer(new_template, context={"request": request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class SimulationSubmitView(generics.CreateAPIView):
    """POST /api/simulations/submit/ — сохранить лог действий студента."""
    serializer_class   = SimulationSubmitSerializer
    permission_classes = [permissions.IsAuthenticated]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = serializer.save()
        return Response(
            SimulationResultSerializer(result).data,
            status=status.HTTP_201_CREATED,
        )


class SimulationResultViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/simulations/results/       — результаты
    GET /api/simulations/results/{id}/  — детали результата
    """
    serializer_class   = SimulationResultSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.primary_role == "student":
            return SimulationResult.objects.filter(
                enrollment__student=user
            ).select_related("simulation", "enrollment")
        return SimulationResult.objects.all().select_related(
            "simulation", "enrollment__student"
        )
