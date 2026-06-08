"""
Демо-симуляция «Пульт оператора АСУ ТП» (АРМ/щит управления).

Создаёт шаблон-пульт (тумблеры, кнопки, лампы, индикаторы) с эталонным
сценарием правильного запуска и привязывает его модулем к курсу «Основы…».
Грейдинг — по последовательности действий (как у ДКВР).

Идемпотентно (get_or_create по имени шаблона). Запуск: manage.py seed_panel_simulation
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.users.models import User
from apps.courses.models import Course, CourseModule
from apps.simulations.models import SimulationTemplate

TEMPLATE_NAME = "Пульт оператора АСУ ТП"


def _el(var, etype, label, libid, x, y, w, h, color):
    return {
        "id": var, "variable": var, "type": etype, "label": label, "libId": libid,
        "x": x, "y": y, "width": w, "height": h,
        "props": {"color": color, "width": w, "height": h},
    }


# Элементы пульта: верхний ряд — индикаторы, нижний — органы управления.
ELEMENTS = [
    # Индикаторы (пассивные)
    _el("lamp-ready", "lamp", "ГОТОВНОСТЬ", "boiler-lamp-run",   120, 90, 80, 80, "#2E6B2E"),
    _el("lamp-run",   "lamp", "РАБОТА",     "boiler-lamp-run",   250, 90, 80, 80, "#1F5FA8"),
    _el("lamp-alarm", "lamp", "АВАРИЯ",     "boiler-lamp-alarm", 380, 90, 80, 80, "#A23B3B"),
    _el("gauge-press","gauge","ДАВЛЕНИЕ",   "boiler-gauge-steam",560, 70, 120,120, "#1A2A3A"),
    _el("gauge-temp", "gauge","ТЕМПЕРАТУРА","boiler-therm-boiler",720,70, 120,120, "#1A2A3A"),
    _el("disp-state", "display","СОСТОЯНИЕ","boiler-disp-power", 900, 95, 200,100, "#10212E"),
    # Органы управления (интерактивные, входят в сценарий)
    _el("sw-power", "switch", "ПИТАНИЕ",      "boiler-sw-mode",        120, 380, 130, 90, "#45556A"),
    _el("sw-vent",  "switch", "ВЕНТИЛЯЦИЯ",   "boiler-sw-mode",        290, 380, 130, 90, "#45556A"),
    _el("sw-mode",  "switch", "РЕЖИМ АВТО",   "boiler-sw-mode",        460, 380, 130, 90, "#45556A"),
    _el("btn-start","button", "ПУСК",         "boiler-btn-burner-start",660,380, 130, 90, "#2E7D32"),
    _el("btn-stop", "button", "СТОП",         "boiler-btn-burner-stop", 830,380, 130, 90, "#B23B3B"),
]

# Эталонный сценарий — корректная последовательность запуска с пульта.
SCENARIO = [
    {"step": 1, "element_id": "sw-power", "expected_value": True,
     "description": "Включите питание пульта — тумблер «ПИТАНИЕ»."},
    {"step": 2, "element_id": "sw-vent", "expected_value": True,
     "description": "Запустите вентиляцию (продувку) — тумблер «ВЕНТИЛЯЦИЯ»."},
    {"step": 3, "element_id": "sw-mode", "expected_value": True,
     "description": "Переведите управление в автоматический режим — «РЕЖИМ АВТО»."},
    {"step": 4, "element_id": "btn-start", "expected_value": True,
     "description": "Запустите установку кнопкой «ПУСК» и проконтролируйте лампу «РАБОТА»."},
]


class Command(BaseCommand):
    help = "Создаёт демо-симуляцию «Пульт оператора АСУ ТП» и привязывает к курсу «Основы…»."

    @transaction.atomic
    def handle(self, *args, **opts):
        course = Course.objects.filter(pk=1).first()
        if not course:
            self.stderr.write("Курс 1 не найден — сначала seed_demo_content.")
            return
        author = course.instructor or User.objects.filter(primary_role="admin").first()

        data = dict(
            author=author, library_set="boiler",
            status=SimulationTemplate.Status.PUBLISHED,
            canvas_w=1180, canvas_h=560,
            description="АРМ оператора: запуск установки с пульта в правильной последовательности.",
            elements=ELEMENTS, connections=[], rules=[], reference_scenario=SCENARIO,
        )
        tpl, created = SimulationTemplate.objects.get_or_create(
            name=TEMPLATE_NAME, defaults=data,
        )
        if not created:
            for k, v in data.items():
                setattr(tpl, k, v)
            tpl.save()

        # Модуль-тренажёр в курсе «Основы…» (после теста, если он есть).
        module = tpl.module
        if module is None:
            last = course.modules.order_by("-order_num").first()
            module = CourseModule.objects.create(
                course=course, title="Тренажёр: пульт оператора АСУ ТП",
                type=CourseModule.Type.SIMULATION,
                order_num=(last.order_num + 1) if last else 0,
                is_required=True,
                unlock_after=last,
            )
            tpl.module = module
            tpl.save(update_fields=["module"])
        else:
            module.title = "Тренажёр: пульт оператора АСУ ТП"
            module.save(update_fields=["title"])

        self.stdout.write(self.style.SUCCESS(
            f"Готово. Шаблон «{TEMPLATE_NAME}» (id={tpl.id}) → модуль [{module.id}] "
            f"в курсе «{course.title}». Элементов: {len(ELEMENTS)}, шагов сценария: {len(SCENARIO)}."
        ))
