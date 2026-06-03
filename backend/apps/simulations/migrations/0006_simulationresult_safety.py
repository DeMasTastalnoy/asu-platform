from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('simulations', '0005_simulationtemplate_library_set'),
    ]

    operations = [
        migrations.AddField(
            model_name='simulationresult',
            name='errors_count',
            field=models.PositiveSmallIntegerField(default=0, verbose_name='Ошибочных действий'),
        ),
        migrations.AddField(
            model_name='simulationresult',
            name='completed',
            field=models.BooleanField(default=True, verbose_name='Пройдено полностью'),
        ),
        migrations.AddField(
            model_name='simulationresult',
            name='safety_tripped',
            field=models.BooleanField(default=False, verbose_name='Сработала аварийная защита'),
        ),
        migrations.AddField(
            model_name='simulationresult',
            name='alarm_count',
            field=models.PositiveSmallIntegerField(default=0, verbose_name='Кол-во аварий'),
        ),
    ]
