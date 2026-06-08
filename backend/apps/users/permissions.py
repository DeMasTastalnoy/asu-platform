from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsAdmin(BasePermission):
    """Только администраторы."""
    def has_permission(self, request, view):
        return bool(
            request.user and
            request.user.is_authenticated and
            request.user.primary_role == "admin"
        )


class IsInstructor(BasePermission):
    """Только инструкторы."""
    def has_permission(self, request, view):
        return bool(
            request.user and
            request.user.is_authenticated and
            request.user.primary_role in ("admin", "instructor")
        )


class IsAdminOrSelf(BasePermission):
    """Администратор или сам пользователь."""
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated)

    def has_object_permission(self, request, view, obj):
        return (
            request.user.primary_role == "admin" or
            obj == request.user
        )


class IsInstructorOrReadOnly(BasePermission):
    """Инструктор может изменять, остальные — только читать."""
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return bool(request.user and request.user.is_authenticated)
        return bool(
            request.user and
            request.user.is_authenticated and
            request.user.primary_role in ("admin", "instructor")
        )


class IsCourseContentOwnerOrReadOnly(BasePermission):
    """Изменять контент курса (модуль/вопрос) может только владелец курса или admin.

    Чтение — любому аутентифицированному. Курс берётся из obj.course
    (модуль) или obj.module.course (вопрос теста).
    """
    def has_permission(self, request, view):
        if request.method in SAFE_METHODS:
            return bool(request.user and request.user.is_authenticated)
        return bool(
            request.user and request.user.is_authenticated and
            request.user.primary_role in ("admin", "instructor")
        )

    def has_object_permission(self, request, view, obj):
        if request.method in SAFE_METHODS:
            return True
        if request.user.primary_role == "admin":
            return True
        course = getattr(obj, "course", None) or getattr(
            getattr(obj, "module", None), "course", None
        )
        return bool(course and course.instructor_id == request.user.id)
