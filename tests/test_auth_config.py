import firebase_admin
from firebase_admin import credentials
import pytest

from auth import initialize_firebase


def test_firebase_accepts_raw_service_account_json(monkeypatch):
    monkeypatch.setattr(firebase_admin, "_apps", {})
    certificate_inputs = []
    initialized_with = []
    monkeypatch.setattr(
        credentials,
        "Certificate",
        lambda value: certificate_inputs.append(value) or "credential",
    )
    monkeypatch.setattr(firebase_admin, "initialize_app", initialized_with.append)

    initialized = initialize_firebase(
        False,
        "",
        '{"type":"service_account","project_id":"test-project"}',
    )

    assert initialized is True
    assert certificate_inputs == [{"type": "service_account", "project_id": "test-project"}]
    assert initialized_with == ["credential"]


def test_firebase_keeps_service_account_path_support(monkeypatch):
    monkeypatch.setattr(firebase_admin, "_apps", {})
    certificate_inputs = []
    monkeypatch.setattr(
        credentials,
        "Certificate",
        lambda value: certificate_inputs.append(value) or "credential",
    )
    monkeypatch.setattr(firebase_admin, "initialize_app", lambda credential: None)

    assert initialize_firebase(False, "service-account.json", "") is True
    assert certificate_inputs == ["service-account.json"]


def test_firebase_requires_credentials_outside_dev_mode():
    with pytest.raises(RuntimeError, match="Firebase Admin could not be initialized"):
        initialize_firebase(False, "", "")


def test_firebase_is_optional_in_dev_mode():
    assert initialize_firebase(True, "", "") is False


def test_sentry_disabled_without_dsn(monkeypatch):
    import sentry_sdk
    from main import configure_sentry

    initialized = []
    monkeypatch.setattr(sentry_sdk, "init", initialized.append)
    configure_sentry("")
    assert initialized == []


def test_sentry_excludes_pii_and_request_bodies(monkeypatch):
    import sentry_sdk
    from main import configure_sentry

    initialized = []
    monkeypatch.setattr(sentry_sdk, "init", lambda **options: initialized.append(options))
    configure_sentry("https://public@example.invalid/1")
    assert initialized == [{
        "dsn": "https://public@example.invalid/1",
        "send_default_pii": False,
        "max_request_body_size": "never",
    }]
