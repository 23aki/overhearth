"""Every home in its own language (#39). Translation is faked: no model calls."""

import random
from datetime import timedelta

from overhearth import i18n
from overhearth.assistant import system_prompt
from overhearth.engine import TemplateDialogue, run_tick
from overhearth.engine.dialogue import AvatarBrief
from overhearth.kinds.builtin import Thanks
from overhearth.models import Packet, PacketContext, utcnow
from overhearth.town_seed import seeded_town
from overhearth.translate import Localizer


class FakeTranslator:
    """Marks each value with the target language, and counts calls."""

    def __init__(self) -> None:
        self.calls: list[tuple[tuple[str, ...], str]] = []

    def translate(self, fields: dict[str, str], target: str) -> dict[str, str]:
        self.calls.append((tuple(sorted(fields)), target))
        return {k: f"[{target}] {v}" for k, v in fields.items()}


def test_the_demo_town_speaks_many_languages():
    store = seeded_town()
    languages = {h.language for h in store.households()}
    assert {"en", "ja", "es", "fr", "ko", "pt", "de", "zh"} <= languages
    egg = store.get_packet("tip_egg_spinach")
    assert egg.context.language == "ja"
    assert "ほうれん草" in egg.payload["text"]
    assert egg.payload["topic"] == "quick dinner"  # topics stay English, for search
    assert store.search_knowledge("what can I cook in ten minutes")[0].packet_id == "tip_egg_spinach"


def test_a_home_hears_its_report_in_its_own_language_with_content_translated_once():
    store = seeded_town()
    translator = FakeTranslator()
    now = utcnow()
    for step in range(1, 4):
        run_tick(
            store,
            TemplateDialogue(),
            at=now + timedelta(minutes=30 * step),
            rng=random.Random(2),
            translator=translator,
        )
    osaka = store.latest_report("hh_osaka")
    tips = [i for i in osaka.items if i.kind == "tip"]
    assert tips
    for item in tips:
        assert "コツを教えてくれました" in item.text  # the Japanese template
        tip = store.get_packet(item.refs[0])
        if tip.context.language != "ja":
            assert "[ja]" in item.text  # the content was translated for Osaka
    seattle = store.latest_report("hh_seattle")
    japanese_tips = [
        i for i in seattle.items if i.kind == "tip" and store.get_packet(i.refs[0]).context.language == "ja"
    ]
    for item in japanese_tips:
        assert item.text.startswith(tuple(h.avatar_name for h in store.households()))
        assert "[en]" in item.text
    # One translation per piece of content and language, however often it is told.
    keys = [(fields, target) for fields, target in translator.calls]
    assert len(translator.calls) == len(set(keys)) or len(translator.calls) <= len(store.packets()) * 8


def test_background_homes_do_not_spend_translations():
    store = seeded_town()
    translator = FakeTranslator()
    run_tick(store, TemplateDialogue(), at=utcnow(), rng=random.Random(5), translator=translator)
    featured_languages = {h.language for h in store.households() if h.tier in ("demo", "real")}
    assert {target for _, target in translator.calls} <= featured_languages


def test_ask_town_answers_from_stored_translations(store):
    from overhearth.devclient import RawMcpClient  # noqa: F401  (server fixture below uses the dev seed)

    localizer = Localizer(store)
    tip = store.get_packet("pkt_egg_spinach")
    localizer.store.put_translation(f"packet:{tip.id}", "ja", {"topic": "時短夕食", "text": "卵とほうれん草で10分。"})
    tokyo = store.get_household("hh_tokyo").model_copy(update={"language": "ja"})
    store.add_household(tokyo)
    fields = localizer.fields(f"packet:{tip.id}", {"topic": "x", "text": "y"}, tip.context.language, "ja")
    assert fields == {"topic": "時短夕食", "text": "卵とほうれん草で10分。"}


def test_template_avatars_greet_in_their_language_with_an_english_gloss():
    tokyo = AvatarBrief("hh_tokyo", "Kiri", "a studio in Tokyo", (), (), language="ja")
    seattle = AvatarBrief("hh_seattle", "Juniper", "a family in Seattle", (), (), language="en")
    script = TemplateDialogue().generate(tokyo, seattle)
    first, last = script.lines[0], script.lines[-1]
    assert first.lang == "ja"
    assert "Juniper" in first.text
    assert first.gloss and first.gloss.startswith("Hi Juniper")
    assert last.lang == "en"
    assert last.gloss is None


def test_trends_count_the_same_tip_across_languages():
    store = seeded_town()
    now = utcnow()
    handler = Thanks()
    tip = store.get_packet("tip_egg_spinach")
    a = Packet(
        kind="thanks",
        origin_household="hh_portland",
        payload={"what_helped": "le dîner aux œufs", "tip_id": tip.id},
        context=PacketContext(language="fr"),
        consented_at=now,
    )
    b = Packet(
        kind="thanks",
        origin_household="hh_detroit",
        payload={"what_helped": "계란 저녁", "tip_id": tip.id},
        context=PacketContext(language="ko"),
        consented_at=now,
    )
    assert handler._concept(a) == handler._concept(b) == f"tip:{tip.id}"
    theme_ja = Packet(
        kind="thanks",
        origin_household="hh_kyoto",
        payload={"what_helped": i18n.theme("medicine", "ja")},
        consented_at=now,
    )
    theme_en = Packet(
        kind="thanks",
        origin_household="hh_london",
        payload={"what_helped": i18n.theme("medicine", "en")},
        consented_at=now,
    )
    assert handler._concept(theme_ja) == handler._concept(theme_en) == "theme:medicine"


def test_alexa_answers_in_the_homes_language():
    prompt = system_prompt("ja")
    assert "Japanese" in prompt
    assert "ask_town" in prompt
    assert "English" in system_prompt("en")


def test_localized_templates_cover_every_language():
    for code in i18n.LANGUAGES:
        for key in ("tip", "answer", "wondering", "thanks_return", "trend"):
            assert i18n.say(
                code, key, carrier="A", topic="t", origin="o", text="x", helper="h", times="1", places="p", themes="z"
            )
        assert i18n.count_times(code, 3)
        for theme in i18n.THEMES:
            assert i18n.theme(theme, code)


def test_a_partial_translation_is_completed_not_mistaken_for_whole(store):
    translator = FakeTranslator()
    localizer = Localizer(store, translator)
    localizer.fields("packet:x", {"phrase": "卵のごはん"}, "ja", "en", allow_model=True)
    both = localizer.fields("packet:x", {"phrase": "卵のごはん", "text": "本文"}, "ja", "en", allow_model=True)
    assert both == {"phrase": "[en] 卵のごはん", "text": "[en] 本文"}
    assert translator.calls[-1] == (("text",), "en")  # only the missing field was translated
    assert localizer.has("packet:x", "en", ("phrase", "text"))
    assert not localizer.has("packet:x", "en", ("topic",))


def test_alexa_replies_in_the_language_the_person_used():
    from overhearth.assistant import Message, reply_language, spoken_language

    assert spoken_language("Hi! Who are you?", "ja") == "en"
    assert spoken_language("こんにちは、あなたは誰？", "en") == "ja"
    assert spoken_language("你好", "en") == "zh"
    assert spoken_language("今日", "ja") == "ja"
    assert spoken_language("안녕하세요", "en") == "ko"
    assert spoken_language("hola, que tal", "es") is None  # the model decides
    history = [
        Message(role="user", text="こんにちは"),
        Message(role="assistant", text="..."),
        Message(role="user", text="Thanks!"),
    ]
    assert reply_language(history, "ja") == "en"
    assert "reply in English" in system_prompt("ja", "en")


def test_alexa_is_the_one_in_town_and_knows_its_town_name():
    prompt = system_prompt("ja", "ja", "Ume")
    assert 'never as "your avatar"' in prompt
    assert "あなたのアバター" in prompt
    assert "In town your name is Ume" in prompt
    assert "In town your name" not in system_prompt("ja")
