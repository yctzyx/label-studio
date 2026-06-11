from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("projects", "0038_taskworkflow_returned_to_annotation"),
    ]

    operations = [
        migrations.AddField(
            model_name="project",
            name="data_type_category",
            field=models.CharField(
                blank=True,
                choices=[
                    ("image", "Image"),
                    ("video", "Video"),
                    ("text", "Text"),
                    ("audio", "Audio"),
                    ("general", "General"),
                ],
                default="general",
                help_text="标注项目数据类型（图片/视频/文本/音频/通用），用于列表筛选与展示",
                max_length=32,
                verbose_name="data type category",
            ),
        ),
    ]
