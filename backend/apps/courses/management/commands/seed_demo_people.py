"""
Демо-пользователи: 2 преподавателя, 2 учебные группы по 10 студентов,
привязка преподавателей к курсам и зачисление групп.

Идемпотентно (get_or_create по username / имени группы).
Пароль всех демо-пользователей: Demo!2026

Запуск:  manage.py seed_demo_people
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.users.models import User, UserRole
from apps.courses.models import Course, Enrollment, StudentGroup, StudentGroupMember

PASSWORD = "Demo!2026"

INSTRUCTORS = [
    ("ivanov", "Иванов Иван Иванович"),
    ("petrov", "Пётр Петрович Петров"),
]

# 20 студентов (по 10 на группу)
STUDENT_NAMES = [
    "Соколов Артём Дмитриевич", "Кузнецова Анна Сергеевна", "Попов Максим Андреевич",
    "Лебедева Мария Ивановна", "Новиков Дмитрий Олегович", "Морозова Екатерина Павловна",
    "Волков Никита Романович", "Зайцева Ольга Викторовна", "Павлов Илья Алексеевич",
    "Семёнова Дарья Юрьевна",
    "Голубев Сергей Игоревич", "Виноградова Полина Денисовна", "Богданов Егор Кириллович",
    "Орлова Алина Максимовна", "Макаров Тимофей Антонович", "Андреева Ксения Глебовна",
    "Никитин Михаил Степанович", "Фёдорова Вероника Артёмовна", "Степанов Даниил Игоревич",
    "Алексеева Софья Романовна",
]


class Command(BaseCommand):
    help = "Создаёт 2 преподавателей, 2 группы по 10 студентов и привязывает к курсам."

    @transaction.atomic
    def handle(self, *args, **opts):
        course1 = Course.objects.filter(pk=1).first()
        course2 = Course.objects.filter(pk=2).first()
        if not (course1 and course2):
            self.stderr.write("Курсы 1 и 2 не найдены — сначала seed_demo_content.")
            return

        # 1. Преподаватели.
        instructors = []
        for username, full in INSTRUCTORS:
            u = self._user(username, full, "instructor")
            instructors.append(u)
        ins1, ins2 = instructors

        # 2. Привязка преподавателей к курсам (становятся инструкторами).
        course1.instructor = ins1; course1.save(update_fields=["instructor"])
        course2.instructor = ins2; course2.save(update_fields=["instructor"])

        # 3. Студенты + группы.
        students = [self._user(f"student{i:02d}", STUDENT_NAMES[i - 1], "student")
                    for i in range(1, 21)]

        g1 = self._group("Операторы АСУ ТП, набор ОК-26-1", "ОК-26-1", ins1)
        g2 = self._group("Операторы АСУ ТП, набор ОК-26-2", "ОК-26-2", ins2)
        self._fill_group(g1, students[:10])
        self._fill_group(g2, students[10:])

        # 4. Зачисление групп на курсы (с тегом группы).
        # Группа 1 → курс 1. Группа 2 → курс 1 (база) + курс 2.
        n = 0
        n += self._enroll(g1, course1)
        n += self._enroll(g2, course1)
        n += self._enroll(g2, course2)

        self.stdout.write(self.style.SUCCESS(
            f"Готово. Преподаватели: {ins1.full_name} → «{course1.title}», "
            f"{ins2.full_name} → «{course2.title}». "
            f"Группы: {g1.code} (10), {g2.code} (10). Создано зачислений: {n}. "
            f"Пароль всех демо-аккаунтов: {PASSWORD}"
        ))

    # ── helpers ───────────────────────────────────────────────
    def _user(self, username, full_name, role):
        u, created = User.objects.get_or_create(
            username=username,
            defaults=dict(email=f"{username}@asu-demo.local",
                          full_name=full_name, primary_role=role),
        )
        if created:
            u.set_password(PASSWORD)
            u.full_name = full_name
            u.save()
            UserRole.objects.get_or_create(user=u, role=role)
        return u

    def _group(self, name, code, curator):
        g, _ = StudentGroup.objects.get_or_create(
            code=code, defaults=dict(name=name, curator=curator, created_by=curator),
        )
        # актуализируем имя/куратора на случай повторного запуска
        g.name = name; g.curator = curator; g.save()
        return g

    def _fill_group(self, group, members):
        for s in members:
            StudentGroupMember.objects.get_or_create(group=group, student=s)

    def _enroll(self, group, course):
        created = 0
        for m in group.memberships.select_related("student"):
            enr, made = Enrollment.objects.get_or_create(
                course=course, student=m.student,
                defaults=dict(enrolled_by=group.curator, group=group),
            )
            if made:
                created += 1
            elif enr.group_id is None:
                enr.group = group
                enr.save(update_fields=["group"])
        return created
