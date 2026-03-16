from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from .views import RegisterView, LoginView, LogoutView, UserViewSet

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")

urlpatterns = [
    path("auth/register/", RegisterView.as_view(),     name="auth-register"),
    path("auth/login/",    LoginView.as_view(),        name="auth-login"),
    path("auth/logout/",   LogoutView.as_view(),       name="auth-logout"),
    path("auth/refresh/",  TokenRefreshView.as_view(), name="auth-refresh"),
    path("", include(router.urls)),
]
