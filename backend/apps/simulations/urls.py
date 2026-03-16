from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    ElementLibraryViewSet, SimulationTemplateViewSet,
    SimulationSubmitView, SimulationResultViewSet,
)

router = DefaultRouter()
router.register("simulations/elements",  ElementLibraryViewSet,      basename="element")
router.register("simulations/templates", SimulationTemplateViewSet,   basename="simulation")
router.register("simulations/results",   SimulationResultViewSet,     basename="sim-result")

urlpatterns = [
    path("simulations/submit/", SimulationSubmitView.as_view(), name="sim-submit"),
    path("", include(router.urls)),
]
