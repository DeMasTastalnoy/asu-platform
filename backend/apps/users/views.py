from rest_framework import generics, viewsets, status, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from django.utils import timezone

from .models import User, UserRole
from .serializers import (
    UserSerializer, UserCreateSerializer,
    UserUpdateSerializer, ChangePasswordSerializer,
)
from .permissions import IsAdmin, IsAdminOrSelf


class RegisterView(generics.CreateAPIView):
    """POST /api/auth/register/ — регистрация нового пользователя."""
    queryset         = User.objects.all()
    serializer_class = UserCreateSerializer
    permission_classes = [permissions.AllowAny]


class LoginView(TokenObtainPairView):
    """POST /api/auth/login/ — получение JWT токенов."""
    permission_classes = [permissions.AllowAny]

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            # обновляем last_login_at
            try:
                user = User.objects.get(username=request.data.get("username"))
                user.last_login_at = timezone.now()
                user.save(update_fields=["last_login_at"])
            except User.DoesNotExist:
                pass
        return response


class LogoutView(generics.GenericAPIView):
    """POST /api/auth/logout/ — инвалидация refresh-токена."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        try:
            token = RefreshToken(request.data.get("refresh"))
            token.blacklist()
        except Exception:
            pass
        return Response({"detail": "Выход выполнен."}, status=status.HTTP_200_OK)


class UserViewSet(viewsets.ModelViewSet):
    """
    GET    /api/users/          — список (только admin)
    POST   /api/users/          — создать (только admin)
    GET    /api/users/{id}/     — детали (admin или сам пользователь)
    PATCH  /api/users/{id}/     — изменить (admin или сам пользователь)
    DELETE /api/users/{id}/     — удалить (только admin)
    POST   /api/users/{id}/change_password/
    POST   /api/users/{id}/assign_role/
    GET    /api/users/me/       — текущий пользователь
    """
    queryset = User.objects.prefetch_related("roles").order_by("-created_at")

    def get_serializer_class(self):
        if self.action == "create":
            return UserCreateSerializer
        if self.action in ("update", "partial_update"):
            return UserUpdateSerializer
        return UserSerializer

    def get_permissions(self):
        if self.action in ("list", "create", "destroy"):
            return [IsAdmin()]
        if self.action in ("retrieve", "update", "partial_update", "change_password"):
            return [IsAdminOrSelf()]
        return [permissions.IsAuthenticated()]

    @action(detail=False, methods=["get"], permission_classes=[permissions.IsAuthenticated])
    def me(self, request):
        """GET /api/users/me/ — данные текущего пользователя."""
        serializer = UserSerializer(request.user)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], permission_classes=[IsAdminOrSelf])
    def change_password(self, request, pk=None):
        """POST /api/users/{id}/change_password/"""
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"detail": "Пароль изменён."})

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def assign_role(self, request, pk=None):
        """POST /api/users/{id}/assign_role/ — назначить роль пользователю."""
        user = self.get_object()
        role = request.data.get("role")
        if role not in [r[0] for r in UserRole.Role.choices]:
            return Response(
                {"detail": f"Недопустимая роль: {role}"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        UserRole.objects.get_or_create(
            user=user, role=role,
            defaults={"granted_by": request.user},
        )
        return Response({"detail": f"Роль '{role}' назначена."})

    @action(detail=True, methods=["post"], permission_classes=[IsAdmin])
    def toggle_active(self, request, pk=None):
        """POST /api/users/{id}/toggle_active/ — заблокировать/разблокировать."""
        user = self.get_object()
        user.is_active = not user.is_active
        user.save(update_fields=["is_active"])
        state = "активирован" if user.is_active else "заблокирован"
        return Response({"detail": f"Пользователь {state}.", "is_active": user.is_active})
