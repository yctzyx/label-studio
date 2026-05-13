"""Projects Django App Configuration"""

import logging

from django.apps import AppConfig

logger = logging.getLogger(__name__)


class ProjectsConfig(AppConfig):
    name = 'projects'

    def ready(self):
        """
        Projects app initialization.

        Note: FSM transitions are now registered centrally in fsm/apps.py.
        Do NOT import transitions here to avoid duplicate registration.
        """
        # Project team allocation side effects (e.g. creator as admin row on create)
        from projects import receivers_project_team  # noqa: F401
