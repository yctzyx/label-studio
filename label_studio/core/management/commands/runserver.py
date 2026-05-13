"""This file and its contents are licensed under the Apache License 2.0. Please see the included NOTICE for copyright information and LICENSE for a copy of the license.

自定义 runserver 命令：启动前注册到 Nacos。
确保使用 poetry run python label_studio/manage.py runserver 时能正确注册。

注意：必须继承 staticfiles 的 runserver（因其在 INSTALLED_APPS 中更靠前），
否则 Django 会使用 staticfiles 的命令而跳过本模块。
"""
import logging

from django.conf import settings

# 继承 staticfiles 的 runserver，保留静态文件服务能力，同时添加 Nacos 注册
try:
    from django.contrib.staticfiles.management.commands.runserver import Command as BaseRunserverCommand
except ImportError:
    from django.core.management.commands.runserver import Command as BaseRunserverCommand

logger = logging.getLogger(__name__)


class Command(BaseRunserverCommand):
    """扩展 runserver，在启动前注册到 Nacos"""

    default_port = '8081'

    def add_arguments(self, parser):
        super().add_arguments(parser)
        self.default_port = str(getattr(settings, 'INTERNAL_PORT', '8080'))

    def inner_run(self, *args, **options):
        """在启动服务器前执行 Nacos 注册"""
        self._register_nacos()
        self._start_pub_directory_scheduler()
        super().inner_run(*args, **options)

    def _register_nacos(self):
        """当 NACOS_ENABLED 时，注册到 Nacos"""
        logger.info('[Nacos] runserver 启动，检查 Nacos 注册...')
        if not getattr(settings, 'NACOS_ENABLED', False):
            logger.info(
                '[Nacos] 跳过注册: NACOS_ENABLED=False 或 NACOS_SERVER_ADDR 为空。'
                '请在 .env 中设置 NACOS_SERVER_ADDR=192.168.1.76:8848'
            )
            return
        try:
            from label_studio.core.nacos_registry import (
                _get_instance_ip,
                register_and_schedule_deregister,
            )

            addr = getattr(self, 'addr', '127.0.0.1')
            port = int(getattr(self, 'port', settings.INTERNAL_PORT))
            if addr in ('0.0.0.0', '0', ''):
                register_ip = _get_instance_ip()
            else:
                register_ip = addr
            register_and_schedule_deregister(register_ip, port)
            logger.info('[Nacos] 注册完成: %s:%s', register_ip, port)
        except Exception as e:
            logger.warning('[Nacos] 注册失败: %s', e, exc_info=True)

    def _start_pub_directory_scheduler(self):
        """启动目录同步定时任务（默认每 60 秒）。"""
        try:
            from parent_integration.pub_directory_scheduler import start_pub_directory_scheduler_once

            start_pub_directory_scheduler_once()
        except Exception as e:
            logger.warning('[PubDirectorySync] scheduler startup failed: %s', e, exc_info=True)
