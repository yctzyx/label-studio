"""This file and its contents are licensed under the Apache License 2.0. Please see the included NOTICE for copyright information and LICENSE for a copy of the license.
"""
import logging
import time
from datetime import timedelta
from uuid import uuid4

import ujson as json
from core.utils.contextlog import ContextLog
from csp.middleware import CSPMiddleware
from django.conf import settings
from django.contrib.auth import logout
from django.core.exceptions import MiddlewareNotUsed
from django.core.handlers.base import BaseHandler
from django.http import HttpResponsePermanentRedirect
from django.middleware.common import CommonMiddleware
from django.utils.deprecation import MiddlewareMixin
from django.utils.http import escape_leading_slashes
from rest_framework.permissions import SAFE_METHODS

logger = logging.getLogger(__name__)


def enforce_csrf_checks(func):
    """Enable csrf for specified view func"""
    # USE_ENFORCE_CSRF_CHECKS=False is for tests
    if settings.USE_ENFORCE_CSRF_CHECKS:

        def wrapper(request, *args, **kwargs):
            return func(request, *args, **kwargs)

        wrapper._dont_enforce_csrf_checks = False
        return wrapper
    else:
        return func


# CORS headers to strip when request came through gateway (to avoid duplicate with gateway's CORS)
_CORS_HEADER_NAMES = (
    "Access-Control-Allow-Origin",
    "Access-Control-Allow-Credentials",
    "Access-Control-Allow-Methods",
    "Access-Control-Allow-Headers",
    "Access-Control-Max-Age",
    "Access-Control-Expose-Headers",
)


# 网关 path 前缀：网关转发 /api/label-studio/xxx 时，LS 需将 path 重写为 /api/xxx 才能匹配路由
GATEWAY_PATH_PREFIX = "/api/label-studio"


class RewriteGatewayPath(MiddlewareMixin):
    """
    当请求 path 以 /api/label-studio/ 开头时，重写以匹配 LS 的 URL 路由。
    - /api/label-studio/static/xxx -> /static/xxx（静态资源）
    - /api/label-studio/current-user/xxx 等 -> /api/xxx（API 路由）
    """

    def process_request(self, request):
        path = getattr(request, "path_info", None) or getattr(request, "path", "")
        if not path.startswith(GATEWAY_PATH_PREFIX + "/"):
            return None
        rest = path[len(GATEWAY_PATH_PREFIX) + 1 :]
        if rest.startswith("static/"):
            new_path = "/" + rest
        elif rest.startswith("data/upload/"):
            new_path = "/" + rest
        elif rest.startswith("api/"):
            new_path = "/" + rest
        else:
            new_path = "/api/" + rest
        request.path_info = new_path
        request.path = new_path
        return None


class StripCorsWhenProxied(MiddlewareMixin):
    """
    当请求经网关/代理转发（存在 X-Forwarded-Host）时，移除 LS 添加的 CORS 头，
    避免与网关的 CORS 头重复导致浏览器报错 "multiple values"。
    直连 LS 的请求（如 embed）保留 CORS 头。
    """

    def process_response(self, request, response):
        if not getattr(request, "META", None):
            return response
        if request.META.get("HTTP_X_FORWARDED_HOST") or request.META.get("HTTP_X_FORWARDED_FOR"):
            for name in _CORS_HEADER_NAMES:
                if response.has_header(name):
                    del response[name]
        return response


class DisableCSRF(MiddlewareMixin):
    # disable csrf for api requests
    def process_view(self, request, callback, *args, **kwargs):
        if hasattr(callback, '_dont_enforce_csrf_checks'):
            setattr(request, '_dont_enforce_csrf_checks', callback._dont_enforce_csrf_checks)
        elif request.GET.get('enforce_csrf_checks'):  # _dont_enforce_csrf_checks is for test
            setattr(request, '_dont_enforce_csrf_checks', False)
        else:
            setattr(request, '_dont_enforce_csrf_checks', True)


class HttpSmartRedirectResponse(HttpResponsePermanentRedirect):
    pass


class CommonMiddlewareAppendSlashWithoutRedirect(CommonMiddleware):
    """This class converts HttpSmartRedirectResponse to the common response
    of Django view, without redirect. This is necessary to match status_codes
    for urls like /url?q=1 and /url/?q=1. If you don't use it, you will have 302
    code always on pages without slash.
    """

    response_redirect_class = HttpSmartRedirectResponse

    def __init__(self, *args, **kwargs):
        # create django request resolver
        self.handler = BaseHandler()

        # prevent recursive includes
        old = settings.MIDDLEWARE
        name = self.__module__ + '.' + self.__class__.__name__
        settings.MIDDLEWARE = [i for i in settings.MIDDLEWARE if i != name]

        self.handler.load_middleware()

        settings.MIDDLEWARE = old
        super(CommonMiddlewareAppendSlashWithoutRedirect, self).__init__(*args, **kwargs)

    def get_full_path_with_slash(self, request):
        """Return the full path of the request with a trailing slash appended
        without Exception in Debug mode
        """
        new_path = request.get_full_path(force_append_slash=True)
        # Prevent construction of scheme relative urls.
        new_path = escape_leading_slashes(new_path)
        return new_path

    def process_response(self, request, response):
        response = super(CommonMiddlewareAppendSlashWithoutRedirect, self).process_response(request, response)

        request.editor_keymap = settings.EDITOR_KEYMAP

        if isinstance(response, HttpSmartRedirectResponse):
            if not request.path.endswith('/'):
                # remove prefix SCRIPT_NAME
                path = request.path[len(settings.FORCE_SCRIPT_NAME) :] if settings.FORCE_SCRIPT_NAME else request.path
                request.path = path + '/'
            # we don't need query string in path_info because it's in request.GET already
            request.path_info = request.path
            response = self.handler.get_response(request)

        return response

    def should_redirect_with_slash(self, request):
        """
        Override the original method to keep global APPEND_SLASH setting false
        """
        if not request.path_info.endswith('/'):
            return True
        return False


class SetSessionUIDMiddleware(CommonMiddleware):
    def process_request(self, request):
        if 'uid' not in request.session:
            request.session['uid'] = str(uuid4())


class ContextLogMiddleware(CommonMiddleware):
    def __init__(self, get_response):
        self.get_response = get_response
        self.log = ContextLog()

    def __call__(self, request):
        body = None
        try:
            body = json.loads(request.body)
        except:  # noqa: E722
            try:
                body = request.body.decode('utf-8')
            except:  # noqa: E722
                pass

        if 'server_id' not in request:
            setattr(request, 'server_id', self.log._get_server_id())

        response = self.get_response(request)
        self.log.send(request=request, response=response, body=body)

        return response

    def process_request(self, request):
        if 'server_id' not in request:
            setattr(request, 'server_id', self.log._get_server_id())


class DatabaseIsLockedRetryMiddleware(CommonMiddleware):
    """Workaround for sqlite performance issues
    we wait and retry request if database is locked"""

    def __init__(self, get_response):
        if settings.DJANGO_DB != settings.DJANGO_DB_SQLITE:
            raise MiddlewareNotUsed()
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        retries_number = 0
        sleep_time = 1
        backoff = 1.5
        while (
            response.status_code == 500
            and hasattr(response, 'content')
            and b'database-is-locked-error' in response.content
            and retries_number < 15
        ):
            time.sleep(sleep_time)
            response = self.get_response(request)
            retries_number += 1
            sleep_time *= backoff
        return response


class XApiKeySupportMiddleware:
    """Middleware that adds support for the X-Api-Key header, by having its value supersede
    anything that's set in the Authorization header."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if 'HTTP_X_API_KEY' in request.META:
            request.META['HTTP_AUTHORIZATION'] = f'Token {request.META["HTTP_X_API_KEY"]}'
            del request.META['HTTP_X_API_KEY']

        return self.get_response(request)


class UpdateLastActivityMiddleware(CommonMiddleware):
    def process_view(self, request, view_func, view_args, view_kwargs):
        if hasattr(request, 'user') and request.method not in SAFE_METHODS:
            if request.user.is_authenticated:
                request.user.update_last_activity()


class InactivitySessionTimeoutMiddleWare(CommonMiddleware):
    """Log the user out if they have been logged in for too long
    or inactive for too long"""

    # paths that don't count as user activity
    NOT_USER_ACTIVITY_PATHS = []

    def process_request(self, request) -> None:
        if (
            not hasattr(request, 'session')
            or request.session.is_empty()
            or not hasattr(request, 'user')
            or not request.user.is_authenticated
            or
            # scim assign request.user implicitly, check CustomSCIMAuthCheckMiddleware
            (hasattr(request, 'is_scim') and request.is_scim)
            or (hasattr(request, 'is_jwt') and request.is_jwt)
        ):
            return

        current_time = time.time()
        last_login = request.session['last_login'] if 'last_login' in request.session else 0

        active_org = request.user.active_organization
        if active_org:
            org_max_session_age = timedelta(minutes=active_org.session_timeout_policy.max_session_age).total_seconds()
            max_time_between_activity = timedelta(
                minutes=active_org.session_timeout_policy.max_time_between_activity
            ).total_seconds()

            if (current_time - last_login) > org_max_session_age:
                logger.info(
                    f'Request is too far from last login {current_time - last_login:.0f} > {settings.MAX_SESSION_AGE}; logout'
                )
                logout(request)

        else:
            max_time_between_activity = settings.MAX_TIME_BETWEEN_ACTIVITY
            # Check if this request is too far from when the login happened
            if (current_time - last_login) > settings.MAX_SESSION_AGE:
                logger.info(
                    f'Request is too far from last login {current_time - last_login:.0f} > {settings.MAX_SESSION_AGE}; logout'
                )
                logout(request)

        # Push the expiry to the max every time a new request is made to a url that indicates user activity
        # but only if it's not a URL we want to ignore
        for path in self.NOT_USER_ACTIVITY_PATHS:
            if isinstance(path, str) and path == str(request.path_info):
                return
            elif 'query' in path:
                parts = str(request.path_info).split('?')
                if len(parts) == 2 and path['query'] in parts[1]:
                    return
        request.session.set_expiry(max_time_between_activity if request.session.get('keep_me_logged_in', True) else 0)


class HumanSignalCspMiddleware(CSPMiddleware):
    """
    Extend CSPMiddleware to support switching report-only CSP to regular CSP.

    For use with core.decorators.override_report_only_csp.
    """

    def process_response(self, request, response):
        response = super().process_response(request, response)
        if getattr(response, '_override_report_only_csp', False):
            if csp_policy := response.get('Content-Security-Policy-Report-Only'):
                response['Content-Security-Policy'] = csp_policy
                del response['Content-Security-Policy-Report-Only']
            delattr(response, '_override_report_only_csp')
        return response
