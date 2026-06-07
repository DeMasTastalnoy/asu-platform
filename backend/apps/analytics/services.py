"""Расчёт итогового балла, статистики курса и генерация PDF сертификата."""
import os

from django.conf import settings
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

from apps.courses.models import CourseModule, TestResult, ModuleProgress
from apps.simulations.models import SimulationResult

_FONT_REG  = "CertSans"
_FONT_BOLD = "CertSans-Bold"
_fonts_ready: tuple | None = None

# Организация-эмитент (печатается на документах).
ORG_NAME = "АСУ-Платформа"
ORG_SUB  = "Дистанционное обучение операторов АСУ ТП"

# Кандидаты TTF с поддержкой кириллицы (Windows / Linux).
_REG_CANDIDATES  = [r"C:\Windows\Fonts\arial.ttf",
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
_BOLD_CANDIDATES = [r"C:\Windows\Fonts\arialbd.ttf",
                    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]


def _ensure_fonts() -> tuple:
    """Регистрирует кириллический шрифт; при отсутствии — стандартный Helvetica."""
    global _fonts_ready
    if _fonts_ready:
        return _fonts_ready
    reg  = next((p for p in _REG_CANDIDATES  if os.path.exists(p)), None)
    bold = next((p for p in _BOLD_CANDIDATES if os.path.exists(p)), None)
    if reg:
        pdfmetrics.registerFont(TTFont(_FONT_REG, reg))
        pdfmetrics.registerFont(TTFont(_FONT_BOLD, bold or reg))
        _fonts_ready = (_FONT_REG, _FONT_BOLD)
    else:
        _fonts_ready = ("Helvetica", "Helvetica-Bold")
    return _fonts_ready


def _best_scores(enrollment) -> dict:
    """Лучший результат (%) студента по каждому тест-/сим-модулю курса."""
    course  = enrollment.course
    student = enrollment.student
    test_ids = list(course.modules.filter(
        type=CourseModule.Type.TEST).values_list("id", flat=True))
    sim_ids  = list(course.modules.filter(
        type=CourseModule.Type.SIMULATION).values_list("id", flat=True))

    best: dict = {}
    if test_ids:
        for r in TestResult.objects.filter(module_id__in=test_ids, user=student):
            p = r.score_percent
            if p is None:
                continue
            key = ("t", r.module_id)
            if key not in best or p > best[key]:
                best[key] = p
    if sim_ids:
        for r in SimulationResult.objects.filter(
            simulation__module_id__in=sim_ids, enrollment__student=student,
        ).select_related("simulation"):
            p = r.score_percent
            if p is None:
                continue
            key = ("s", r.simulation.module_id)
            if key not in best or p > best[key]:
                best[key] = p
    return best


def final_score(enrollment):
    """Итоговый балл курса — среднее лучших результатов по тестам и симуляциям."""
    vals = list(_best_scores(enrollment).values())
    return round(sum(vals) / len(vals), 1) if vals else None


def course_stats(enrollment) -> dict:
    """Прогресс и счётчики пройденного по тестам/симуляциям курса."""
    course = enrollment.course
    tests  = list(course.modules.filter(
        type=CourseModule.Type.TEST).values_list("id", flat=True))
    sims   = list(course.modules.filter(
        type=CourseModule.Type.SIMULATION).values_list("id", flat=True))
    done   = set(ModuleProgress.objects.filter(
        enrollment=enrollment, status=ModuleProgress.Status.COMPLETED,
    ).values_list("module_id", flat=True))
    return {
        "tests_done":  sum(1 for m in tests if m in done),
        "tests_total": len(tests),
        "sims_done":   sum(1 for m in sims if m in done),
        "sims_total":  len(sims),
        "progress":    enrollment.get_progress_percent(),
    }


def render_certificate_pdf(cert) -> str:
    """Рисует PDF сертификата в MEDIA_ROOT/certificates и возвращает URL."""
    enrollment = cert.enrollment
    reg, bold  = _ensure_fonts()

    out_dir = os.path.join(settings.MEDIA_ROOT, "certificates")
    os.makedirs(out_dir, exist_ok=True)
    filename = f"certificate_{cert.id}.pdf"
    path     = os.path.join(out_dir, filename)

    c = canvas.Canvas(path, pagesize=landscape(A4))
    w, h = landscape(A4)

    # Рамка
    c.setStrokeColorRGB(0.09, 0.37, 0.65)
    c.setLineWidth(3); c.rect(15 * mm, 15 * mm, w - 30 * mm, h - 30 * mm)
    c.setLineWidth(1); c.rect(18 * mm, 18 * mm, w - 36 * mm, h - 36 * mm)

    # Шапка организации
    c.setFillColorRGB(0.09, 0.37, 0.65)
    c.setFont(bold, 15)
    c.drawCentredString(w / 2, h - 32 * mm, ORG_NAME)
    c.setFillColorRGB(0.45, 0.45, 0.45)
    c.setFont(reg, 10)
    c.drawCentredString(w / 2, h - 38 * mm, ORG_SUB)

    c.setFillColorRGB(0.09, 0.37, 0.65)
    c.setFont(bold, 40)
    c.drawCentredString(w / 2, h - 60 * mm, "СЕРТИФИКАТ")

    c.setFillColorRGB(0.25, 0.25, 0.25)
    c.setFont(reg, 14)
    c.drawCentredString(w / 2, h - 70 * mm, "Настоящим подтверждается, что")

    c.setFillColorRGB(0, 0, 0)
    c.setFont(bold, 26)
    c.drawCentredString(w / 2, h - 86 * mm,
                        enrollment.student.full_name or enrollment.student.username)

    c.setFillColorRGB(0.25, 0.25, 0.25)
    c.setFont(reg, 14)
    c.drawCentredString(w / 2, h - 99 * mm, "успешно завершил(а) курс")

    c.setFillColorRGB(0, 0, 0)
    c.setFont(bold, 18)
    c.drawCentredString(w / 2, h - 112 * mm, f"«{enrollment.course.title}»")

    if cert.final_score is not None:
        c.setFillColorRGB(0.25, 0.25, 0.25)
        c.setFont(reg, 13)
        c.drawCentredString(w / 2, h - 126 * mm, f"Итоговый балл: {cert.final_score}%")

    # Подвал: номер и дата
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.setFont(reg, 11)
    c.drawString(30 * mm, 25 * mm, f"Рег. № {cert.number}")
    c.drawRightString(w - 30 * mm, 25 * mm,
                      f"Дата выдачи: {cert.issued_at:%d.%m.%Y}")

    c.showPage()
    c.save()
    return f"{settings.MEDIA_URL}certificates/{filename}"


def reg_number(prefix: str, pk: int) -> str:
    """Регистрационный номер документа: АСУ-<prefix>-<год>-<id>."""
    from django.utils import timezone
    return f"АСУ-{prefix}-{timezone.now():%Y}-{pk:05d}"
