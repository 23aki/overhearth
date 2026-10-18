import pytest
from pydantic import ValidationError

from overhearth import kinds


def test_builtin_kinds_are_registered():
    assert kinds.all_kinds() == ["question", "thanks", "tip"]


def test_unknown_kind_is_rejected():
    with pytest.raises(ValueError, match="unknown kind"):
        kinds.get("gossip")


def test_validate_scrubs_contact_details():
    payload = kinds.get("tip").validate(
        {"topic": "rice", "text": "Mail me at a.b@example.com or call +81 90-1234-5678, see https://x.example"}
    )
    assert "example.com" not in payload["text"]
    assert "1234" not in payload["text"]
    assert "https://" not in payload["text"]


def test_validate_enforces_schema():
    with pytest.raises(ValidationError):
        kinds.get("thanks").validate({"what_helped": ""})


def test_duplicate_registration_fails():
    with pytest.raises(ValueError, match="already registered"):
        kinds.register(kinds.get("tip"))
