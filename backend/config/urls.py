from django.contrib import admin
from django.urls import path, include, re_path
from django.conf import settings
from django.views.static import serve as static_serve
from django.views.decorators.clickjacking import xframe_options_exempt

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("apps.users.urls")),
    path("api/", include("apps.courses.urls")),
    path("api/", include("apps.simulations.urls")),
    path("api/", include("apps.analytics.urls")),
]

if settings.DEBUG:
    # Отдаём media без X-Frame-Options, чтобы PDF можно было показать в iframe
    # (по умолчанию Django ставит DENY, и встраивание блокируется).
    media_serve = xframe_options_exempt(static_serve)
    urlpatterns += [
        re_path(
            r"^media/(?P<path>.*)$", media_serve,
            {"document_root": settings.MEDIA_ROOT},
        ),
    ]