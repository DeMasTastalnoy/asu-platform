# apps/users/admin.py
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, UserRole, UserToken


class UserRoleInline(admin.TabularInline):
    model = UserRole
    extra = 1
    fk_name = "user"


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display  = ("username", "email", "full_name", "primary_role", "is_active", "created_at")
    list_filter   = ("primary_role", "is_active")
    search_fields = ("username", "email", "full_name")
    inlines       = [UserRoleInline]
    fieldsets = (
        (None, {"fields": ("username", "password")}),
        ("Личные данные", {"fields": ("email", "full_name")}),
        ("Роль и статус", {"fields": ("primary_role", "is_active", "is_staff", "is_superuser")}),
        ("Даты", {"fields": ("last_login_at", "created_at", "updated_at")}),
    )
    readonly_fields = ("created_at", "updated_at", "last_login_at")
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("username", "email", "full_name", "primary_role", "password1", "password2"),
        }),
    )


@admin.register(UserToken)
class UserTokenAdmin(admin.ModelAdmin):
    list_display  = ("user", "type", "expires_at", "created_at")
    list_filter   = ("type",)
    raw_id_fields = ("user",)
