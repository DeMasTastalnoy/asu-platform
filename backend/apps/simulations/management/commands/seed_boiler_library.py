from django.core.management.base import BaseCommand
from apps.simulations.models import ElementLibrary

BOILER_ELEMENTS = [
    # ── equipment ───────────────────────────────────────────────────────────────
    {
        "id": "boiler-vessel",
        "name": "Котёл (барабан)",
        "category": "equipment",
        "type": "boiler",
        "icon": "🏭",
        "default_properties": {
            "width": 200, "height": 280, "color": "#5A6B7A",
        },
    },

    # ── controls ────────────────────────────────────────────────────────────────
    {
        "id": "boiler-btn-burner-start",
        "name": "Кнопка пуск горелки",
        "category": "controls",
        "type": "button",
        "icon": "▶",
        "default_properties": {
            "color": "#4CAF50", "offColor": "#555",
            "width": 60, "height": 60, "shape": "circle",
        },
    },
    {
        "id": "boiler-btn-burner-stop",
        "name": "Кнопка стоп горелки",
        "category": "controls",
        "type": "button",
        "icon": "■",
        "default_properties": {
            "color": "#F44336", "offColor": "#555",
            "width": 60, "height": 60, "shape": "circle",
        },
    },
    {
        "id": "boiler-reg-fuel",
        "name": "Регулятор подачи топлива",
        "category": "controls",
        "type": "regulator",
        "icon": "⛽",
        "default_properties": {
            "color": "#FF9800", "min": 0, "max": 100,
            "unit": "%", "width": 100, "height": 36,
        },
    },
    {
        "id": "boiler-reg-air",
        "name": "Регулятор подачи воздуха",
        "category": "controls",
        "type": "regulator",
        "icon": "💨",
        "default_properties": {
            "color": "#03A9F4", "min": 0, "max": 100,
            "unit": "%", "width": 100, "height": 36,
        },
    },
    {
        "id": "boiler-sw-mode",
        "name": "Переключатель режима авто/ручной",
        "category": "controls",
        "type": "switch",
        "icon": "⬛",
        "default_properties": {
            "color": "#2196F3", "width": 120, "height": 36,
            "options": ["Авто", "Ручной"],
        },
    },

    # ── indicators ──────────────────────────────────────────────────────────────
    {
        "id": "boiler-lamp-run",
        "name": "Лампа работа горелки",
        "category": "indicators",
        "type": "lamp",
        "icon": "💡",
        "default_properties": {
            "color": "#4CAF50", "offColor": "#333",
            "width": 30, "height": 30,
        },
    },
    {
        "id": "boiler-lamp-alarm",
        "name": "Лампа авария",
        "category": "indicators",
        "type": "lamp",
        "icon": "🔴",
        "default_properties": {
            "color": "#F44336", "offColor": "#333",
            "width": 30, "height": 30,
        },
    },
    {
        "id": "boiler-gauge-steam",
        "name": "Манометр пара",
        "category": "indicators",
        "type": "gauge",
        "icon": "📊",
        "default_properties": {
            "min": 0, "max": 16, "unit": "бар",
            "normalMin": 6, "normalMax": 10,
            "warningColor": "#FFC107", "alarmColor": "#F44336",
            "width": 80, "height": 80,
        },
    },
    {
        "id": "boiler-gauge-water",
        "name": "Манометр воды",
        "category": "indicators",
        "type": "gauge",
        "icon": "📊",
        "default_properties": {
            "min": 0, "max": 6, "unit": "бар",
            "normalMin": 2, "normalMax": 4,
            "warningColor": "#FFC107", "alarmColor": "#F44336",
            "width": 80, "height": 80,
        },
    },
    {
        "id": "boiler-therm-boiler",
        "name": "Термометр котла",
        "category": "indicators",
        "type": "gauge",
        "icon": "🌡",
        "default_properties": {
            "min": 0, "max": 250, "unit": "°C",
            "normalMin": 140, "normalMax": 180,
            "warningColor": "#FFC107", "alarmColor": "#F44336",
            "width": 80, "height": 80,
        },
    },
    {
        "id": "boiler-disp-power",
        "name": "Дисплей мощности",
        "category": "indicators",
        "type": "display",
        "icon": "🖥",
        "default_properties": {
            "unit": "%", "width": 120, "height": 50,
            "fontSize": 18, "color": "#4FC3F7",
        },
    },
    {
        "id": "boiler-level-drum",
        "name": "Уровнемер барабана",
        "category": "indicators",
        "type": "level",
        "icon": "📶",
        "default_properties": {
            "min": 0, "max": 100, "unit": "%",
            "normalMin": 30, "normalMax": 70,
            "warningColor": "#FFC107", "alarmColor": "#F44336",
            "width": 40, "height": 100,
        },
    },

    # ── pipes ───────────────────────────────────────────────────────────────────
    {
        "id": "boiler-pipe-steam",
        "name": "Труба подачи пара",
        "category": "pipes",
        "type": "pipe",
        "icon": "━",
        "default_properties": {
            "color": "#B0BEC5", "width": 160, "height": 14,
            "direction": "horizontal", "label": "Пар",
        },
    },
    {
        "id": "boiler-pipe-ret-water",
        "name": "Труба обратной воды",
        "category": "pipes",
        "type": "pipe",
        "icon": "━",
        "default_properties": {
            "color": "#1E88E5", "width": 160, "height": 14,
            "direction": "horizontal", "label": "Обратная",
        },
    },
    {
        "id": "boiler-pipe-fuel",
        "name": "Труба подачи топлива",
        "category": "pipes",
        "type": "pipe",
        "icon": "━",
        "default_properties": {
            "color": "#FF9800", "width": 160, "height": 12,
            "direction": "horizontal", "label": "Топливо",
        },
    },
    {
        "id": "boiler-pipe-air",
        "name": "Труба подачи воздуха",
        "category": "pipes",
        "type": "pipe",
        "icon": "━",
        "default_properties": {
            "color": "#03A9F4", "width": 160, "height": 12,
            "direction": "horizontal", "label": "Воздух",
        },
    },

    # ── valves ──────────────────────────────────────────────────────────────────
    {
        "id": "boiler-valve-steam",
        "name": "Задвижка пара",
        "category": "valves",
        "type": "valve",
        "icon": "⊠",
        "default_properties": {
            "color": "#B0BEC5", "width": 40, "height": 40,
        },
    },
    {
        "id": "boiler-valve-fuel",
        "name": "Задвижка топлива",
        "category": "valves",
        "type": "valve",
        "icon": "⊠",
        "default_properties": {
            "color": "#FF9800", "width": 40, "height": 40,
        },
    },
    {
        "id": "boiler-valve-air",
        "name": "Задвижка воздуха",
        "category": "valves",
        "type": "valve",
        "icon": "⊠",
        "default_properties": {
            "color": "#03A9F4", "width": 40, "height": 40,
        },
    },
    {
        "id": "boiler-valve-safety",
        "name": "Предохранительный клапан",
        "category": "valves",
        "type": "safety-valve",
        "icon": "⚠",
        "default_properties": {
            "color": "#F44336", "width": 40, "height": 40,
            "triggerPressure": 14, "unit": "бар",
        },
    },
    {
        "id": "boiler-valve-check",
        "name": "Обратный клапан",
        "category": "valves",
        "type": "check-valve",
        "icon": "◁",
        "default_properties": {
            "color": "#78909C", "width": 40, "height": 40,
        },
    },

    # ── sensors ─────────────────────────────────────────────────────────────────
    {
        "id": "boiler-sensor-steam-temp",
        "name": "Датчик температуры пара",
        "category": "sensors",
        "type": "sensor",
        "icon": "🌡",
        "default_properties": {
            "unit": "°C", "min": 0, "max": 250,
            "normalMin": 140, "normalMax": 180,
            "warningColor": "#FFC107", "alarmColor": "#F44336",
            "width": 60, "height": 70,
        },
    },
    {
        "id": "boiler-sensor-steam-press",
        "name": "Датчик давления пара",
        "category": "sensors",
        "type": "sensor",
        "icon": "⊕",
        "default_properties": {
            "unit": "бар", "min": 0, "max": 16,
            "normalMin": 6, "normalMax": 10,
            "warningColor": "#FFC107", "alarmColor": "#F44336",
            "width": 60, "height": 70,
        },
    },
    {
        "id": "boiler-sensor-water-temp",
        "name": "Датчик температуры воды",
        "category": "sensors",
        "type": "sensor",
        "icon": "🌡",
        "default_properties": {
            "unit": "°C", "min": 0, "max": 120,
            "normalMin": 60, "normalMax": 90,
            "warningColor": "#FFC107", "alarmColor": "#F44336",
            "width": 60, "height": 70,
        },
    },
    {
        "id": "boiler-sensor-gas",
        "name": "Датчик загазованности",
        "category": "sensors",
        "type": "sensor",
        "icon": "☁",
        "default_properties": {
            "unit": "% НКПРП", "min": 0, "max": 100,
            "alarmLevel": 10,
            "warningColor": "#FFC107", "alarmColor": "#F44336",
            "width": 60, "height": 70,
        },
    },
    {
        "id": "boiler-sensor-draft",
        "name": "Датчик тяги",
        "category": "sensors",
        "type": "sensor",
        "icon": "⬆",
        "default_properties": {
            "unit": "Па", "min": -50, "max": 0,
            "normalMin": -20, "normalMax": -5,
            "warningColor": "#FFC107", "alarmColor": "#F44336",
            "width": 60, "height": 70,
        },
    },
]


class Command(BaseCommand):
    help = "Наполнить библиотеку элементами котельной установки (library_set='boiler')"

    def handle(self, *args, **options):
        created_count = 0
        updated_count = 0

        for data in BOILER_ELEMENTS:
            _, created = ElementLibrary.objects.update_or_create(
                id=data["id"],
                defaults={
                    "name":               data["name"],
                    "category":           data["category"],
                    "type":               data["type"],
                    "library_set":        "boiler",
                    "icon":               data.get("icon", ""),
                    "default_properties": data["default_properties"],
                    "is_active":          True,
                },
            )
            if created:
                created_count += 1
            else:
                updated_count += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Готово: создано {created_count}, обновлено {updated_count} элементов котельной."
            )
        )
