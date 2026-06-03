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
    pagination_class = None

    def get_queryset(self):
        qs          = ElementLibrary.objects.filter(is_active=True)
        category    = self.request.query_params.get("category")
        library_set = self.request.query_params.get("library_set")
        if category:
            qs = qs.filter(category=category)
        if library_set:
            qs = qs.filter(library_set=library_set)
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
            qs = SimulationTemplate.objects.filter(status="published").order_by('-created_at')
        elif user.primary_role == "instructor":
            qs = SimulationTemplate.objects.filter(author=user).order_by('-created_at')
        else:
            qs = SimulationTemplate.objects.all().order_by('-created_at')

        module_id = self.request.query_params.get('module_id')
        if module_id:
            qs = qs.filter(module_id=module_id)

        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)

        return qs

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
            connections        = template.connections,
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
