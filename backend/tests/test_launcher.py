from fastapi.testclient import TestClient

from backend.main import app
from run import reserve_listener


def test_busy_port_reserves_different_address_without_displacing_previous_copy():
    with reserve_listener(0) as old_copy:
        old_port = old_copy.getsockname()[1]
        with reserve_listener(old_port) as new_copy:
            assert new_copy.getsockname()[1] != old_port
            assert old_copy.getsockname()[1] == old_port
            with reserve_listener(new_copy.getsockname()[1]) as third_copy:
                assert third_copy.getsockname()[1] not in (old_port, new_copy.getsockname()[1])


def test_launcher_keeps_requested_port_when_available():
    with reserve_listener(0) as listener:
        port = listener.getsockname()[1]
    with reserve_listener(port) as listener:
        assert listener.getsockname()[1] == port


def test_front_page_is_not_cached_after_update():
    response = TestClient(app).get('/')
    assert response.status_code == 200
    assert response.headers['cache-control'] == 'no-store'
