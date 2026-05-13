"""Compatibility patch for Django MySQL backend.

Oracle MySQL before 8.0.2 does not support ``ALTER TABLE ... RENAME COLUMN``.
Django's MySQL schema editor only substitutes ``CHANGE`` for old MariaDB versions;
MySQL 5.7 therefore receives invalid SQL. This mirrors Django's MariaDB branch.
"""

from django.db.backends.base.schema import BaseDatabaseSchemaEditor


def apply_mysql_rename_column_patch():
    from django.db.backends.mysql.schema import DatabaseSchemaEditor

    @property
    def sql_rename_column(self):
        conn = self.connection
        is_mariadb = conn.mysql_is_mariadb
        if is_mariadb and conn.mysql_version < (10, 5, 2):
            return (
                'ALTER TABLE %(table)s CHANGE %(old_column)s %(new_column)s %(type)s'
            )
        if not is_mariadb and conn.mysql_version < (8, 0, 2):
            return (
                'ALTER TABLE %(table)s CHANGE %(old_column)s %(new_column)s %(type)s'
            )
        return BaseDatabaseSchemaEditor.sql_rename_column

    DatabaseSchemaEditor.sql_rename_column = sql_rename_column
