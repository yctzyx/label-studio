from django.db.utils import OperationalError

from parent_integration.scheduler_utils import is_retryable_db_error


def test_retryable_mysql_connection_errors():
    assert is_retryable_db_error(OperationalError(2002, "Can't connect to server on '192.168.1.75' (10061)"))
    assert is_retryable_db_error(OperationalError(2006, 'MySQL server has gone away'))
    assert is_retryable_db_error(OperationalError(2013, 'Lost connection to MySQL server during query'))


def test_non_retryable_db_errors():
    assert not is_retryable_db_error(OperationalError(1146, "Table 'db.foo' doesn't exist"))
    assert not is_retryable_db_error(ValueError('not a db error'))
