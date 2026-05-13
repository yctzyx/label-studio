"""Unmanaged models mapping 父平台表结构（只读）。"""

from django.db import models


class DataDatabase(models.Model):
    """数据集成-数据库管理 `data_database`。"""

    id = models.BigIntegerField(primary_key=True)
    name = models.CharField(max_length=200)
    database_type = models.IntegerField()
    database_ip = models.CharField(max_length=50)
    database_port = models.CharField(max_length=10)
    database_name = models.CharField(max_length=200)
    database_schema = models.CharField(max_length=200)
    status = models.IntegerField(default=0)
    user_name = models.CharField(max_length=50)
    password = models.CharField(max_length=50)
    is_rt_approve = models.IntegerField(null=True, blank=True)
    no_rt_reason = models.CharField(max_length=150, null=True, blank=True)
    jdbc_url = models.CharField(max_length=1000, null=True, blank=True)
    access_key = models.CharField(max_length=200, null=True, blank=True)
    secret_key = models.CharField(max_length=200, null=True, blank=True)
    bucket_name = models.CharField(max_length=200, null=True, blank=True)
    project_id = models.BigIntegerField(null=True, blank=True)
    org_id = models.BigIntegerField(null=True, blank=True)
    config_json = models.TextField(null=True, blank=True)
    version = models.IntegerField(null=True, blank=True)
    deleted = models.IntegerField(null=True, blank=True)
    creator = models.BigIntegerField(null=True, blank=True)
    create_time = models.DateTimeField(null=True, blank=True)
    updater = models.BigIntegerField(null=True, blank=True)
    update_time = models.DateTimeField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'data_database'


class MdDataSet(models.Model):
    """数据集 `md_data_set`。"""

    id = models.BigIntegerField(primary_key=True)
    data_set_name = models.CharField(max_length=255, null=True, blank=True)
    data_set_type = models.CharField(max_length=255, null=True, blank=True)
    data_set_tags = models.CharField(max_length=255, null=True, blank=True)
    data_set_desc = models.TextField(null=True, blank=True)
    source_id = models.BigIntegerField(null=True, blank=True)
    path = models.CharField(max_length=255, null=True, blank=True)
    data_catalogue = models.BigIntegerField(null=True, blank=True)
    create_time = models.DateTimeField(null=True, blank=True)
    update_time = models.DateTimeField(null=True, blank=True)
    create_id = models.CharField(max_length=128, null=True, blank=True)
    update_id = models.CharField(max_length=128, null=True, blank=True)
    is_deleted = models.IntegerField(null=True, blank=True)

    class Meta:
        managed = False
        db_table = 'md_data_set'


class PubOrg(models.Model):
    """父平台组织 `pub_org`（只读，字段需与库表一致；不符时请改 db_column 或模型）。"""

    id = models.CharField(max_length=64, primary_key=True)
    parent_id = models.CharField(max_length=64, null=True, blank=True)
    name = models.CharField(max_length=500, null=True, blank=True)
    code = models.CharField(max_length=200, null=True, blank=True)
    is_deleted = models.CharField(max_length=8, default='0')
    is_enable = models.CharField(max_length=8, default='1')

    class Meta:
        managed = False
        db_table = 'pub_org'


class PubUser(models.Model):
    """父平台用户 `pub_user`（只读）。"""

    id = models.CharField(max_length=64, primary_key=True)
    login_name = models.CharField(max_length=256, null=True, blank=True)
    email = models.CharField(max_length=320, null=True, blank=True)
    real_name = models.CharField(max_length=256, null=True, blank=True)
    is_deleted = models.CharField(max_length=8, default='0')
    is_enable = models.CharField(max_length=8, default='1')

    class Meta:
        managed = False
        db_table = 'pub_user'


class PubUserOrg(models.Model):
    """用户与组织关联 `pub_user_org`（只读）。需有可映射为字符串的单列主键 `id`。"""

    id = models.CharField(max_length=64, primary_key=True)
    user_id = models.CharField(max_length=64)
    org_id = models.CharField(max_length=64)

    class Meta:
        managed = False
        db_table = 'pub_user_org'
