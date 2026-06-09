from pathlib import Path
from datetime import timedelta
from decouple import config, Csv

BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Секреты и окружение — из .env (см. .env.example). В код не зашиваем.
SECRET_KEY = config("DJANGO_SECRET_KEY", default="dev-insecure-CHANGE-ME-in-.env")
DEBUG      = config("DEBUG", default=True, cast=bool)
ALLOWED_HOSTS = config("ALLOWED_HOSTS", default="localhost,127.0.0.1", cast=Csv())

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # сторонние
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    "django_filters",
    # приложения проекта
    "apps.users",
    "apps.courses",
    "apps.simulations",
    "apps.analytics",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

ROOT_URLCONF = "config.urls"
AUTH_USER_MODEL = "users.User"

DATABASES = {
    "default": {
        "ENGINE":   "django.db.backends.mysql",
        "NAME":     config("DB_NAME", default="asu_platform"),
        "USER":     config("DB_USER", default="root"),
        "PASSWORD": config("DB_PASSWORD", default=""),
        "HOST":     config("DB_HOST", default="127.0.0.1"),
        "PORT":     config("DB_PORT", default="3306"),
        "OPTIONS":  {"charset": "utf8mb4"},
    }
}

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 20,
    # Антибрутфорс: ограничиваем частоту запросов (логин — отдельным scope).
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.ScopedRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "login": "10/min",
    },
}

# Политика сложности паролей (применяется при регистрации и смене пароля).
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
     "OPTIONS": {"min_length": 8}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME":  timedelta(minutes=60),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "AUTH_HEADER_TYPES":      ("Bearer",),
}

CORS_ALLOWED_ORIGINS = config(
    "CORS_ORIGINS", default="http://localhost:4200", cast=Csv(),
)

STATIC_URL   = "/static/"
STATIC_ROOT  = BASE_DIR / "staticfiles"   # collectstatic → раздаётся nginx в проде
MEDIA_URL    = "/media/"
MEDIA_ROOT   = BASE_DIR / "media"

# Разрешаем встраивание (PDF-сертификатов/документов) в iframe того же origin.
X_FRAME_OPTIONS = "SAMEORIGIN"

# Макс. размер загружаемого файла модуля (МБ).
MODULE_UPLOAD_MAX_MB = config("UPLOAD_MAX_MB", default=500, cast=int)

# ── Безопасность за HTTPS (включается в проде через SECURE=True в .env) ──
SECURE = config("SECURE", default=False, cast=bool)
if SECURE:
    SECURE_PROXY_SSL_HEADER  = ("HTTP_X_FORWARDED_PROTO", "https")  # за nginx-TLS
    SECURE_SSL_REDIRECT      = True
    SESSION_COOKIE_SECURE    = True
    CSRF_COOKIE_SECURE       = True
    SECURE_HSTS_SECONDS      = 31536000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_CONTENT_TYPE_NOSNIFF = True

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
LANGUAGE_CODE = "ru-ru"
TIME_ZONE     = "Europe/Moscow"
USE_TZ        = True


import pymysql
pymysql.install_as_MySQLdb()

# Отзыв refresh-токенов при логауте (см. LogoutView.blacklist()).
SIMPLE_JWT["ROTATE_REFRESH_TOKENS"]      = True
SIMPLE_JWT["BLACKLIST_AFTER_ROTATION"]   = True