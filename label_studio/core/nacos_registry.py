"""This file and its contents are licensed under the Apache License 2.0. Please see the included NOTICE for copyright information and LICENSE for a copy of the license.

Nacos 服务注册模块 - 使用 nacos-sdk-python 官方 SDK。
- 支持 Nacos 1.x / 2.x（SDK 1.x 使用 HTTP 协议）
- 临时实例自动心跳，健康状态由 SDK 维护
- 进程退出时自动反注册

依赖: nacos-sdk-python>=1.0.0,<2.0.0
配置从 Django settings (core.settings.base) 读取。
"""
import atexit
import logging
import socket

import nacos

logger = logging.getLogger(__name__)

# 全局 Nacos 客户端和注册信息，用于 atexit 反注册
_nacos_client = None
_registered_instance = None


def _get_settings():
    """延迟导入 settings，避免循环依赖。"""
    from django.conf import settings
    return settings


def _get_instance_ip():
    """
    获取要注册到 Nacos 的本机 IP（网关可访问的地址）。
    优先使用 NACOS_IP 配置，否则自动检测本机出口 IP。
    """
    s = _get_settings()
    ip = (s.NACOS_IP or '').strip()
    if ip:
        logger.info('[Nacos] 使用配置的实例 IP: %s', ip)
        return ip
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(0.5)
        try:
            sock.connect(('8.8.8.8', 80))
            ip = sock.getsockname()[0]
        except Exception:
            ip = '127.0.0.1'
        finally:
            sock.close()
        logger.info('[Nacos] 自动检测到实例 IP: %s', ip)
        return ip
    except Exception as e:
        logger.warning('[Nacos] 自动检测 IP 失败，使用 127.0.0.1: %s', e)
        return '127.0.0.1'


def _parse_server_address(addr):
    """
    解析 NACOS_SERVER_ADDR，SDK 需要 "host:port" 格式（无协议前缀）。
    多个地址用逗号分隔，如 192.168.1.76:8848 或 192.168.1.76:8848,192.168.1.77:8848。
    """
    if not addr or not addr.strip():
        return None
    addr = addr.strip()
    # SDK 的 parse_nacos_server_addr 期望 host:port，去掉协议前缀
    for prefix in ('https://', 'http://'):
        if addr.lower().startswith(prefix):
            addr = addr[len(prefix):].strip()
            break
    return addr if addr else None


def _is_nacos_enabled():
    """判断 Nacos 注册是否已启用。"""
    s = _get_settings()
    if not getattr(s, 'NACOS_ENABLED', False):
        return False
    addr = (getattr(s, 'NACOS_SERVER_ADDR', '') or '').strip()
    return bool(addr)


def _create_nacos_client():
    """创建 NacosClient 实例。"""
    s = _get_settings()
    server_addr = _parse_server_address(getattr(s, 'NACOS_SERVER_ADDR', ''))
    if not server_addr:
        raise RuntimeError('NACOS_SERVER_ADDR 未配置')
    namespace = (s.NACOS_NAMESPACE_ID or '').strip() or None
    username = (s.NACOS_USERNAME or '').strip() or None
    password = (s.NACOS_PASSWORD or '').strip() or None
    client = nacos.NacosClient(
        server_addresses=server_addr,
        namespace=namespace,
        username=username,
        password=password,
        log_level=logging.WARNING,
    )
    return client


def register_to_nacos(ip, port, service_name=None, metadata=None):
    """
    使用 nacos-sdk-python 将当前实例注册到 Nacos。
    临时实例 + heartbeat_interval 时，SDK 会自动发送心跳，保持健康状态。
    """
    s = _get_settings()
    service_name = service_name or s.NACOS_SERVICE_NAME
    group_name = (s.NACOS_GROUP_NAME or 'DEFAULT_GROUP').strip()

    meta = metadata or {}
    if 'version' not in meta:
        try:
            from label_studio import __version__
            meta['version'] = __version__
        except Exception:
            pass

    global _nacos_client
    if _nacos_client is None:
        _nacos_client = _create_nacos_client()

    # ephemeral=True + heartbeat_interval=5：SDK 自动心跳，健康状态正常
    heartbeat_interval = 5
    _nacos_client.add_naming_instance(
        service_name=service_name,
        ip=ip,
        port=int(port),
        cluster_name=None,
        weight=1.0,
        metadata=meta,
        enable=True,
        healthy=True,
        ephemeral=True,
        group_name=group_name,
        heartbeat_interval=heartbeat_interval,
    )
    logger.info(
        '[Nacos] 注册成功（SDK 自动心跳）: 服务=%s %s:%s',
        service_name, ip, port
    )


def deregister_from_nacos(ip, port, service_name=None):
    """从 Nacos 反注册实例，并停止心跳任务。"""
    global _nacos_client
    if _nacos_client is None:
        return
    s = _get_settings()
    service_name = service_name or s.NACOS_SERVICE_NAME
    group_name = (s.NACOS_GROUP_NAME or 'DEFAULT_GROUP').strip()
    try:
        _nacos_client.remove_naming_instance(
            service_name=service_name,
            ip=ip,
            port=int(port),
            cluster_name=None,
            ephemeral=True,
            group_name=group_name,
        )
        logger.info('[Nacos] 反注册成功: 服务=%s %s:%s', service_name, ip, port)
    except Exception as e:
        logger.warning('[Nacos] 反注册失败: %s', e)


def register_and_schedule_deregister(ip, port, service_name=None, metadata=None):
    """
    注册到 Nacos 并注册进程退出时的反注册回调。
    使用 nacos-sdk-python，临时实例自动心跳，健康状态由 SDK 维护。
    """
    global _registered_instance
    s = _get_settings()
    logger.info(
        '[Nacos] 配置检查: NACOS_ENABLED=%s NACOS_SERVER_ADDR=%s',
        getattr(s, 'NACOS_ENABLED', False),
        repr(getattr(s, 'NACOS_SERVER_ADDR', ''))
    )
    if not _is_nacos_enabled():
        logger.info(
            '[Nacos] 跳过注册: NACOS_ENABLED 为 False 或 NACOS_SERVER_ADDR 为空。'
            '请在 .env 中设置 NACOS_SERVER_ADDR=192.168.1.76:8848'
        )
        return
    ip = ip or _get_instance_ip()
    port = int(port)
    register_to_nacos(ip, port, service_name=service_name, metadata=metadata)
    _registered_instance = (ip, port, service_name or s.NACOS_SERVICE_NAME)

    def _atexit_deregister():
        if _registered_instance:
            nip, nport, sname = _registered_instance
            try:
                deregister_from_nacos(nip, nport, sname)
            except Exception as e:
                logger.warning('[Nacos] 进程退出时反注册失败: %s', e)

    atexit.register(_atexit_deregister)
