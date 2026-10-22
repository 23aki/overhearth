"""Alexa's voice through Amazon Polly (#54). Polly itself is faked."""

from starlette.testclient import TestClient

from overhearth import i18n
from overhearth.asgi import create_app
from overhearth.dev_seed import seeded_store
from overhearth.speech import VOICES, PollySpeaker

MP3 = b"ID3fake-mp3"


class FakeSpeaker:
    def __init__(self, audio: bytes | None = MP3) -> None:
        self.audio = audio
        self.calls: list[tuple[str, str]] = []

    def speak(self, text: str, language: str) -> bytes | None:
        self.calls.append((text, language))
        return self.audio


def _client(monkeypatch, speaker):
    monkeypatch.setattr("overhearth.asgi.speaker_from_env", lambda: speaker)
    return TestClient(create_app(seeded_store()), base_url="http://localhost:8000")


def test_every_home_language_has_a_voice():
    assert set(VOICES) >= set(i18n.LANGUAGES)


def test_a_reply_comes_back_as_audio_in_its_language(monkeypatch):
    speaker = FakeSpeaker()
    with _client(monkeypatch, speaker) as client:
        response = client.post(
            "/assistant/speech",
            json={"text": "町にパン屋ができました。", "language": "ja"},
            headers={"Authorization": "Bearer demo-osaka"},
        )
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/mpeg"
    assert response.content == MP3
    assert speaker.calls == [("町にパン屋ができました。", "ja")]


def test_speech_needs_a_linked_home_and_sane_text(monkeypatch):
    with _client(monkeypatch, FakeSpeaker()) as client:
        assert client.post("/assistant/speech", json={"text": "hi"}).status_code == 401
        auth = {"Authorization": "Bearer demo-tokyo"}
        assert client.post("/assistant/speech", json={"text": ""}, headers=auth).status_code == 400
        assert client.post("/assistant/speech", json={"text": "x" * 5000}, headers=auth).status_code == 400
        assert client.post("/assistant/speech", content=b"not json", headers=auth).status_code == 400


def test_without_a_voice_the_browser_speaks(monkeypatch):
    with _client(monkeypatch, None) as client:
        response = client.post("/assistant/speech", json={"text": "hi"}, headers={"Authorization": "Bearer demo-tokyo"})
    assert response.status_code == 404
    with _client(monkeypatch, FakeSpeaker(audio=None)) as client:
        response = client.post("/assistant/speech", json={"text": "hi"}, headers={"Authorization": "Bearer demo-tokyo"})
    assert response.status_code == 502


def test_polly_is_asked_once_per_line(monkeypatch):
    class Stream:
        def read(self) -> bytes:
            return MP3

    class Polly:
        calls: list[dict] = []

        def synthesize_speech(self, **kwargs):
            self.calls.append(kwargs)
            return {"AudioStream": Stream()}

    speaker = PollySpeaker.__new__(PollySpeaker)
    speaker._client = Polly()
    speaker._cache = __import__("collections").OrderedDict()
    speaker._cache_size = 4
    assert speaker.speak("Hello", "en") == MP3
    assert speaker.speak("Hello", "en") == MP3
    assert speaker.speak("안녕하세요", "ko") == MP3
    calls = speaker._client.calls
    assert len(calls) == 2
    assert calls[0]["VoiceId"] == "Danielle" and calls[0]["Engine"] == "neural"
    assert calls[1]["VoiceId"] == "Seoyeon" and calls[1]["LanguageCode"] == "ko-KR"
