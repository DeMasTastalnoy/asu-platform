from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('simulations', '0004_alter_elementlibrary_options_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='simulationtemplate',
            name='library_set',
            field=models.CharField(default='universal', max_length=50, verbose_name='Библиотека АСУ'),
        ),
    ]
