"""将父平台 pub_org / pub_user / pub_user_org 同步到 Label Studio 的 Organization / User / OrganizationMember。"""

from __future__ import annotations

import logging
import re
from typing import Any

from django.conf import settings
from django.db import transaction

from organizations.models import Organization, OrganizationMember
from parent_integration.models import PubOrg, PubUser, PubUserOrg
from users.models import User

logger = logging.getLogger(__name__)


def pub_directory_db() -> str:
    return getattr(settings, 'PUB_DIRECTORY_DB', 'default') or 'default'


def _is_active_row(is_deleted: Any, is_enable: Any) -> bool:
    """兼容 char '0'/'1'、整数 0/1、None（视为不过滤）。"""
    d_ok = True
    e_ok = True
    if is_deleted is not None and str(is_deleted).strip() != '':
        d_ok = str(is_deleted).strip() in ('0', 'False', 'false')
    if is_enable is not None and str(is_enable).strip() != '':
        e_ok = str(is_enable).strip() in ('1', 'True', 'true')
    return d_ok and e_ok


def _sanitize_local_part(s: str) -> str:
    s = re.sub(r'[^a-zA-Z0-9._+-]+', '_', (s or '')[:200])
    return s.strip('_') or 'user'


def _split_real_name(real_name: str) -> tuple[str, str]:
    s = (real_name or '').strip()
    if not s:
        return '', ''
    parts = s.split(None, 1)
    if len(parts) == 1:
        return parts[0], ''
    return parts[0], parts[1]


def _truncate(s: str, max_len: int) -> str:
    if s is None:
        return ''
    return s[:max_len]


def _resolve_email(pu: PubUser) -> str:
    raw = (pu.email or '').strip()
    if raw:
        return User.objects.normalize_email(raw)
    ln = _sanitize_local_part(pu.login_name or '')
    return f'{ln}.{pu.id}@pub-sync.local'


def _ensure_unique_email(want: str, user_pk: int | None) -> str:
    """保证与 htx_user.email 唯一约束不冲突（排除当前用户）。"""
    qs = User.objects.filter(email=want)
    if user_pk is not None:
        qs = qs.exclude(pk=user_pk)
    if not qs.exists():
        return want
    base, _, domain = want.partition('@')
    if not domain:
        domain = 'pub-sync.local'
        base = want
    suffix = 1
    while suffix < 10000:
        candidate = f'{base}+dup{suffix}@{domain}'
        qs2 = User.objects.filter(email=candidate)
        if user_pk is not None:
            qs2 = qs2.exclude(pk=user_pk)
        if not qs2.exists():
            return candidate
        suffix += 1
    raise RuntimeError('无法生成唯一 email')


def sync_pub_directory(
    *,
    dry_run: bool = False,
    prune_memberships: bool = False,
) -> dict[str, int]:
    """
    顺序：组织 -> 用户 -> 成员关系。
    写入始终在 Django default 连接；读取 pub_* 使用 settings.PUB_DIRECTORY_DB。
    dry_run 时在单事务内执行并回滚，统计仍反映「本会执行」的次数。
    """
    pdb = pub_directory_db()
    if pdb not in settings.DATABASES:
        raise ValueError(f'PUB_DIRECTORY_DB={pdb!r} 不在 DATABASES 中')

    stats: dict[str, int] = {
        'orgs_created': 0,
        'orgs_updated': 0,
        'users_created': 0,
        'users_updated': 0,
        'members_created': 0,
        'members_revived': 0,
        'members_pruned': 0,
    }

    org_qs = PubOrg.objects.using(pdb).all()
    user_qs = PubUser.objects.using(pdb).all()

    active_orgs: dict[str, PubOrg] = {}
    for po in org_qs.iterator(chunk_size=500):
        if _is_active_row(po.is_deleted, po.is_enable):
            active_orgs[po.id] = po

    active_users: dict[str, PubUser] = {}
    for pu in user_qs.iterator(chunk_size=500):
        if _is_active_row(pu.is_deleted, pu.is_enable):
            active_users[pu.id] = pu

    def do_writes() -> None:
        # 1) Organizations
        for oid, po in active_orgs.items():
            title = _truncate((po.name or po.code or oid).strip() or oid, 1000)
            existing = Organization.objects.filter(external_org_id=oid).first()
            if existing:
                if existing.title != title:
                    existing.title = title
                    existing.save(update_fields=['title', 'updated_at'])
                    stats['orgs_updated'] += 1
            else:
                Organization.objects.create(
                    title=title,
                    external_org_id=oid,
                    created_by=None,
                )
                stats['orgs_created'] += 1

        org_by_ext = {
            o.external_org_id: o
            for o in Organization.objects.exclude(external_org_id__isnull=True).exclude(external_org_id__exact='')
        }

        # 2) Users
        for uid, pu in active_users.items():
            first_name, last_name = _split_real_name(pu.real_name or '')
            username = _truncate((pu.login_name or f'pub_{uid}').strip() or f'pub_{uid}', 256)

            u = User.objects.filter(external_user_id=uid).first()
            if u is None:
                cand = _resolve_email(pu)
                u = User.objects.filter(email=cand).first()
            is_new = u is None
            if u is None:
                u = User(username=username)
                u.set_unusable_password()

            final_email = _ensure_unique_email(_resolve_email(pu), u.pk)
            u.external_user_id = uid
            u.email = final_email
            u.username = username
            u.first_name = _truncate(first_name, 256)
            u.last_name = _truncate(last_name, 256)
            u.is_active = True
            u.save()
            if is_new:
                stats['users_created'] += 1
            else:
                stats['users_updated'] += 1

        user_by_ext = {
            u.external_user_id: u
            for u in User.objects.exclude(external_user_id__isnull=True).exclude(external_user_id__exact='')
        }

        # 3) 有效关系对（与父平台一致）
        valid_pairs: set[tuple[str, str]] = set()
        for rel in PubUserOrg.objects.using(pdb).all().iterator(chunk_size=500):
            if rel.user_id not in active_users or rel.org_id not in active_orgs:
                continue
            valid_pairs.add((rel.user_id, rel.org_id))

        for rel in PubUserOrg.objects.using(pdb).all().iterator(chunk_size=500):
            if rel.user_id not in active_users or rel.org_id not in active_orgs:
                continue
            o = org_by_ext.get(rel.org_id)
            u = user_by_ext.get(rel.user_id)
            if not o or not u:
                continue
            om = OrganizationMember.objects.filter(user=u, organization=o).first()
            if om is None:
                OrganizationMember.objects.create(user=u, organization=o)
                stats['members_created'] += 1
            elif om.deleted_at:
                om.deleted_at = None
                om.save(update_fields=['deleted_at', 'updated_at'])
                stats['members_revived'] += 1

        # 4) active_organization
        for u in user_by_ext.values():
            if u.active_organization_id:
                continue
            first_org = (
                Organization.objects.filter(
                    organizationmember__user=u,
                    organizationmember__deleted_at__isnull=True,
                )
                .order_by('pk')
                .first()
            )
            if first_org:
                u.active_organization = first_org
                u.save(update_fields=['active_organization'])

        # 5) 父平台已禁用用户 -> LS 置为不可用
        for pu in user_qs.iterator(chunk_size=500):
            if pu.id in active_users:
                continue
            u = User.objects.filter(external_user_id=pu.id).first()
            if u and u.is_active:
                u.is_active = False
                u.save(update_fields=['is_active'])

        # 6) prune
        if prune_memberships:
            for om in OrganizationMember.objects.filter(
                user__external_user_id__isnull=False,
                organization__external_org_id__isnull=False,
            ).select_related('user', 'organization'):
                pair = (om.user.external_user_id, om.organization.external_org_id)
                if pair not in valid_pairs and not om.deleted_at:
                    om.soft_delete()
                    stats['members_pruned'] += 1

    with transaction.atomic():
        do_writes()
        if dry_run:
            transaction.set_rollback(True)

    return stats


def sync_pub_directory_counts() -> dict[str, int]:
    """只读统计（不写库）。"""
    pdb = pub_directory_db()
    org_n = sum(1 for o in PubOrg.objects.using(pdb).iterator(chunk_size=500) if _is_active_row(o.is_deleted, o.is_enable))
    user_n = sum(1 for u in PubUser.objects.using(pdb).iterator(chunk_size=500) if _is_active_row(u.is_deleted, u.is_enable))
    rel_n = PubUserOrg.objects.using(pdb).count()
    return {'pub_org_active': org_n, 'pub_user_active': user_n, 'pub_user_org_rows': rel_n}
