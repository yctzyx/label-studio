"""在本库创建 data_database / md_data_set 镜像表（与父平台表结构一致，供同步写入）。"""

from django.db import migrations

CREATE_DATA_DATABASE = """
CREATE TABLE IF NOT EXISTS `data_database` (
  `id` bigint NOT NULL,
  `name` varchar(200) NOT NULL,
  `database_type` int NOT NULL,
  `database_ip` varchar(50) NOT NULL,
  `database_port` varchar(10) NOT NULL,
  `database_name` varchar(200) NOT NULL,
  `database_schema` varchar(200) NOT NULL,
  `status` int NOT NULL DEFAULT 0,
  `user_name` varchar(50) NOT NULL,
  `password` varchar(50) NOT NULL,
  `is_rt_approve` int DEFAULT NULL,
  `no_rt_reason` varchar(150) DEFAULT NULL,
  `jdbc_url` varchar(1000) DEFAULT NULL,
  `access_key` varchar(200) DEFAULT NULL,
  `secret_key` varchar(200) DEFAULT NULL,
  `bucket_name` varchar(200) DEFAULT NULL,
  `project_id` bigint DEFAULT NULL,
  `org_id` bigint DEFAULT NULL,
  `config_json` longtext,
  `version` int DEFAULT NULL,
  `deleted` int DEFAULT NULL,
  `creator` bigint DEFAULT NULL,
  `create_time` datetime(6) DEFAULT NULL,
  `updater` bigint DEFAULT NULL,
  `update_time` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""

CREATE_MD_DATA_SET = """
CREATE TABLE IF NOT EXISTS `md_data_set` (
  `id` bigint NOT NULL,
  `data_set_name` varchar(255) DEFAULT NULL,
  `data_set_type` varchar(255) DEFAULT NULL,
  `data_set_tags` varchar(255) DEFAULT NULL,
  `data_set_desc` longtext,
  `source_id` bigint DEFAULT NULL,
  `path` varchar(255) DEFAULT NULL,
  `data_catalogue` bigint DEFAULT NULL,
  `create_time` datetime(6) DEFAULT NULL,
  `update_time` datetime(6) DEFAULT NULL,
  `create_id` varchar(128) DEFAULT NULL,
  `update_id` varchar(128) DEFAULT NULL,
  `is_deleted` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `md_data_set_source_id` (`source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.RunSQL(CREATE_DATA_DATABASE, migrations.RunSQL.noop),
        migrations.RunSQL(CREATE_MD_DATA_SET, migrations.RunSQL.noop),
    ]
