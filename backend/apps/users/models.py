from django.db import models
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin


class UserManager(BaseUserManager):
    def create_user(self, username, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Email обязателен")
        email = self.normalize_email(email)
        user = self.model(username=username, email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, username, email, password=None, **extra_fields):
        extra_fields.setdefault("primary_role", User.Role.ADMIN)
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        return self.create_user(username, email, password, **extra_fields)


class User(AbstractBaseUser, PermissionsMixin):
    class Role(models.TextChoices):
        ADMIN      = "admin",      "Администратор"
        INSTRUCTOR = "instructor", "Инструктор"
        STUDENT    = "student",    "Обучающийся"

    username      = models.CharField("Логин", max_length=50, unique=True)
    email         = models.EmailField("Email", max_length=100, unique=True)
    full_name     = models.CharField("ФИО", max_length=100, blank=True)
    primary_role  = models.CharField(
        "Основная роль", max_length=20,
        choices=Role.choices, default=Role.STUDENT,
    )
    is_active     = models.BooleanField("Активен", default=True)
    is_staff      = models.BooleanField(default=False)
    last_login_at = models.DateTimeField("Последний вход", null=True, blank=True)
    created_at    = models.DateTimeField("Дата создания", auto_now_add=True)
    updated_at    = models.DateTimeField("Дата изменения", auto_now=True)

    objects = UserManager()

    USERNAME_FIELD  = "username"
    REQUIRED_FIELDS = ["email"]

    class Meta:
        db_table = "users"
        verbose_name = "Пользователь"
        verbose_name_plural = "Пользователи"

    def __str__(self):
        return f"{self.full_name or self.username} ({self.primary_role})"

    def has_role(self, role: str) -> bool:
        """Проверяет роль через таблицу user_roles (поддержка множественных ролей)."""
        return self.roles.filter(role=role).exists()


class UserRole(models.Model):
    class Role(models.TextChoices):
        ADMIN      = "admin",      "Администратор"
        INSTRUCTOR = "instructor", "Инструктор"
        STUDENT    = "student",    "Обучающийся"

    user       = models.ForeignKey(User, on_delete=models.CASCADE, related_name="roles")
    role       = models.CharField(max_length=20, choices=Role.choices)
    granted_by = models.ForeignKey(
        User, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="granted_roles",
    )
    granted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "user_roles"
        unique_together = ("user", "role")
        verbose_name = "Роль пользователя"
        verbose_name_plural = "Роли пользователей"

    def __str__(self):
        return f"{self.user.username} → {self.role}"


class UserToken(models.Model):
    class TokenType(models.TextChoices):
        REFRESH        = "refresh",        "Refresh-токен"
        PASSWORD_RESET = "password_reset", "Сброс пароля"
        EMAIL_VERIFY   = "email_verify",   "Подтверждение email"

    user       = models.ForeignKey(User, on_delete=models.CASCADE, related_name="tokens")
    token_hash = models.CharField(max_length=255, db_index=True)
    type       = models.CharField(max_length=20, choices=TokenType.choices)
    expires_at = models.DateTimeField("Истекает")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "user_tokens"
        indexes  = [models.Index(fields=["user", "type"])]
        verbose_name = "Токен пользователя"

    def is_expired(self) -> bool:
        from django.utils import timezone
        return timezone.now() > self.expires_at
