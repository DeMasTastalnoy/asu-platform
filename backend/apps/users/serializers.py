from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password
from .models import User, UserRole, UserToken


class UserRoleSerializer(serializers.ModelSerializer):
    class Meta:
        model  = UserRole
        fields = ("role", "granted_at")


class UserSerializer(serializers.ModelSerializer):
    roles = UserRoleSerializer(many=True, read_only=True)

    class Meta:
        model  = User
        fields = (
            "id", "username", "email", "full_name",
            "birth_year", "passport", "snils", "reg_address",
            "primary_role", "is_active", "last_login_at",
            "created_at", "roles",
        )
        read_only_fields = ("id", "last_login_at", "created_at")


class UserCreateSerializer(serializers.ModelSerializer):
    password  = serializers.CharField(write_only=True, validators=[validate_password])
    password2 = serializers.CharField(write_only=True)

    class Meta:
        model  = User
        fields = ("username", "email", "full_name", "primary_role", "password", "password2")

    def validate(self, attrs):
        if attrs["password"] != attrs.pop("password2"):
            raise serializers.ValidationError({"password": "Пароли не совпадают."})
        return attrs

    def create(self, validated_data):
        # Роль выше «студента» может назначить только администратор (через UserViewSet).
        # Публичная регистрация (AllowAny) всегда создаёт обычного студента —
        # иначе любой мог бы зарегистрироваться админом.
        request  = self.context.get("request")
        is_admin = bool(
            request and request.user.is_authenticated
            and request.user.primary_role == User.Role.ADMIN
        )
        if not is_admin:
            validated_data["primary_role"] = User.Role.STUDENT
            # Самостоятельная регистрация — аккаунт неактивен до подтверждения
            # администратором (модерация регистраций). Аккаунты, заведённые
            # админом через UserViewSet, активны сразу.
            validated_data["is_active"] = False
        user = User.objects.create_user(**validated_data)
        UserRole.objects.create(user=user, role=user.primary_role)
        return user


class UserUpdateSerializer(serializers.ModelSerializer):
    """Редактирование своего/чужого профиля. Роль и активность сюда НЕ входят —
    их меняет только администратор через assign_role/toggle_active (IsAdmin),
    иначе студент мог бы PATCH-нуть себе primary_role=admin."""
    class Meta:
        model  = User
        fields = (
            "full_name", "email",
            "birth_year", "passport", "snils", "reg_address",
        )


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, validators=[validate_password])

    def validate_old_password(self, value):
        user = self.context["request"].user
        if not user.check_password(value):
            raise serializers.ValidationError("Неверный текущий пароль.")
        return value

    def save(self):
        user = self.context["request"].user
        user.set_password(self.validated_data["new_password"])
        user.save()
        return user

from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        # Понятное сообщение, если аккаунт ещё не подтверждён администратором
        # (самостоятельная регистрация создаёт неактивный аккаунт).
        user = User.objects.filter(username=attrs.get(self.username_field)).first()
        if user is not None and not user.is_active:
            raise serializers.ValidationError(
                "Аккаунт ожидает подтверждения администратором.",
                code="account_pending",
            )
        return super().validate(attrs)

    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['primary_role'] = user.primary_role
        token['full_name']    = user.full_name
        token['username']     = user.username
        return token