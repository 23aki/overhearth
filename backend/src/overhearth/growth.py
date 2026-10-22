# ruff: noqa: E501  (a catalog: one translation per line reads best)
"""The town grows with thanks.

Town XP comes from what happens in it: thanks (x2), know-how shared (x3), questions (x1) and
every chat between avatars (x1). Each level builds a landmark, and which one depends on what
the town has thanked most: a town that thanks cooking tips gets a bakery, one that thanks
kids' tips gets a playground. Once every landmark stands (and the festival lanterns hang),
each level makes one bigger, again the most thanked first. So the town's character comes
from what its people found helpful.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime
from typing import Any

from overhearth import i18n
from overhearth.models import Packet, ReportItem, TownEvent
from overhearth.text import words

LEVELS = [
    *[0, 150, 350, 600, 900, 1250, 1650, 2100, 2600, 3150, 3750, 4400, 5100],
    *[5950, 6910, 7980, 9160, 10450, 11850, 13360, 14980, 16710, 18550, 20500],
]
"""XP needed for each level. Level 1 is the start. Levels 2-13 build the eleven landmarks and
then the festival lanterns; levels 14-24 make each landmark bigger. With a few dozen homes
chatting every half hour (~600 XP a day), every landmark stands after about a week, and the
last one grows about four weeks after that."""

XP = {"thanks": 2, "tip": 3, "question": 1}

# kind: (search words, {language: (landmark name, what people thanked)})
LANDMARKS: dict[str, tuple[set[str], dict[str, tuple[str, str]]]] = {
    "bakery": (
        {
            "cook",
            "dinner",
            "meal",
            "recipe",
            "bake",
            "baking",
            "egg",
            "rice",
            "food",
            "breakfast",
            "kitchen",
            "fish",
            "tea",
            "supper",
            "lunch",
        },
        {
            "en": ("a bakery", "cooking tips"),
            "ja": ("パン屋", "料理のコツ"),
            "es": ("una panadería", "los consejos de cocina"),
            "fr": ("une boulangerie", "les astuces de cuisine"),
            "ko": ("빵집", "요리 팁"),
            "pt": ("uma padaria", "dicas de cozinha"),
            "de": ("eine Bäckerei", "Kochtipps"),
            "zh": ("面包店", "做饭的窍门"),
        },
    ),
    "playground": (
        {"kid", "child", "children", "toddler", "school", "homework", "tidy", "rainy", "picky", "baby", "toy", "game"},
        {
            "en": ("a playground", "tips for kids"),
            "ja": ("公園の遊び場", "子育てのコツ"),
            "es": ("un parque infantil", "los consejos para niños"),
            "fr": ("une aire de jeux", "les astuces pour les enfants"),
            "ko": ("놀이터", "아이 키우기 팁"),
            "pt": ("um parquinho", "dicas para crianças"),
            "de": ("ein Spielplatz", "Tipps für Kinder"),
            "zh": ("儿童乐园", "带孩子的窍门"),
        },
    ),
    "library": (
        {"read", "reading", "book", "library", "study", "studying", "learn", "note"},
        {
            "en": ("a library", "reading and study tips"),
            "ja": ("図書館", "読書や勉強のコツ"),
            "es": ("una biblioteca", "los consejos de lectura y estudio"),
            "fr": ("une bibliothèque", "les astuces de lecture et d'étude"),
            "ko": ("도서관", "독서와 공부 팁"),
            "pt": ("uma biblioteca", "dicas de leitura e estudo"),
            "de": ("eine Bibliothek", "Lese- und Lerntipps"),
            "zh": ("图书馆", "读书和学习的窍门"),
        },
    ),
    "garden": (
        {
            "plant",
            "garden",
            "onion",
            "regrow",
            "flower",
            "outdoor",
            "walk",
            "active",
            "stretch",
            "exercise",
            "sun",
            "summer",
            "winter",
            "lamp",
        },
        {
            "en": ("a garden", "tips for staying active and growing things"),
            "ja": ("庭園", "体を動かすことや植物のコツ"),
            "es": ("un jardín", "los consejos para moverse y cultivar"),
            "fr": ("un jardin", "les astuces pour bouger et faire pousser"),
            "ko": ("정원", "몸을 움직이고 식물을 키우는 팁"),
            "pt": ("um jardim", "dicas para se mexer e cultivar"),
            "de": ("ein Garten", "Tipps zu Bewegung und Pflanzen"),
            "zh": ("花园", "运动和种植的窍门"),
        },
    ),
    "clinic": (
        {"medicine", "pill", "doctor", "health", "care", "caregiver", "parent", "nurse", "visit"},
        {
            "en": ("a clinic", "tips for health and caring"),
            "ja": ("診療所", "健康や介護のコツ"),
            "es": ("una clínica", "los consejos de salud y cuidado"),
            "fr": ("un cabinet médical", "les astuces de santé et de soin"),
            "ko": ("작은 병원", "건강과 돌봄 팁"),
            "pt": ("uma clínica", "dicas de saúde e cuidado"),
            "de": ("eine Praxis", "Tipps zu Gesundheit und Pflege"),
            "zh": ("诊所", "健康和照护的窍门"),
        },
    ),
    "cafe": (
        {
            "friend",
            "call",
            "connected",
            "family",
            "homesick",
            "talk",
            "touch",
            "neighbor",
            "neighborhood",
            "newcomer",
            "city",
        },
        {
            "en": ("a café", "tips for staying in touch"),
            "ja": ("カフェ", "人とつながるコツ"),
            "es": ("un café", "los consejos para mantenerse en contacto"),
            "fr": ("un café", "les astuces pour garder le lien"),
            "ko": ("카페", "사람과 이어지는 팁"),
            "pt": ("um café", "dicas para manter contato"),
            "de": ("ein Café", "Tipps, in Kontakt zu bleiben"),
            "zh": ("咖啡馆", "保持联系的窍门"),
        },
    ),
    "bathhouse": (
        {"sleep", "bedtime", "relax", "recharge", "myself", "night", "rest", "shift", "calm", "tired"},
        {
            "en": ("a bathhouse", "tips for rest and sleep"),
            "ja": ("銭湯", "休息や睡眠のコツ"),
            "es": ("una casa de baños", "los consejos para descansar y dormir"),
            "fr": ("un bain public", "les astuces de repos et de sommeil"),
            "ko": ("목욕탕", "휴식과 잠 팁"),
            "pt": ("uma casa de banhos", "dicas de descanso e sono"),
            "de": ("ein Badehaus", "Tipps zu Ruhe und Schlaf"),
            "zh": ("澡堂", "休息和睡眠的窍门"),
        },
    ),
    "stage": (
        {"music", "song", "dance", "dancing", "guitar", "practice", "instrument"},
        {
            "en": ("a music stage", "tips about music and dancing"),
            "ja": ("野外ステージ", "音楽やダンスのコツ"),
            "es": ("un escenario", "los consejos de música y baile"),
            "fr": ("une scène", "les astuces de musique et de danse"),
            "ko": ("야외 무대", "음악과 춤 팁"),
            "pt": ("um palco", "dicas de música e dança"),
            "de": ("eine Bühne", "Tipps zu Musik und Tanz"),
            "zh": ("露天舞台", "音乐和跳舞的窍门"),
        },
    ),
    "market": (
        {"grocery", "groceries", "budget", "shopping", "list", "bean", "save", "money", "shared", "fridge", "cheap"},
        {
            "en": ("a market", "tips for shopping and saving"),
            "ja": ("市場", "買い物や節約のコツ"),
            "es": ("un mercado", "los consejos de compras y ahorro"),
            "fr": ("un marché", "les astuces de courses et d'économies"),
            "ko": ("시장", "장보기와 절약 팁"),
            "pt": ("uma feira", "dicas de compras e economia"),
            "de": ("ein Markt", "Tipps zum Einkaufen und Sparen"),
            "zh": ("集市", "购物和省钱的窍门"),
        },
    ),
    "workshop": (
        {
            "fix",
            "repair",
            "tool",
            "laundry",
            "iron",
            "shirt",
            "desk",
            "work",
            "office",
            "moving",
            "box",
            "photo",
            "commute",
        },
        {
            "en": ("a workshop", "tips for fixing and working"),
            "ja": ("工房", "修理や仕事のコツ"),
            "es": ("un taller", "los consejos para arreglar y trabajar"),
            "fr": ("un atelier", "les astuces pour réparer et travailler"),
            "ko": ("공방", "수리와 일 팁"),
            "pt": ("uma oficina", "dicas para consertar e trabalhar"),
            "de": ("eine Werkstatt", "Tipps zum Reparieren und Arbeiten"),
            "zh": ("工坊", "修理和工作的窍门"),
        },
    ),
    "petpark": (
        {"dog", "pet", "cat", "chew", "walk"},
        {
            "en": ("a dog park", "tips for pets"),
            "ja": ("ドッグラン", "ペットのコツ"),
            "es": ("un parque para perros", "los consejos para mascotas"),
            "fr": ("un parc à chiens", "les astuces pour les animaux"),
            "ko": ("반려견 놀이터", "반려동물 팁"),
            "pt": ("um parque para cães", "dicas para pets"),
            "de": ("eine Hundewiese", "Tipps für Haustiere"),
            "zh": ("狗狗公园", "养宠物的窍门"),
        },
    ),
    "lanterns": (
        set(),
        {
            "en": ("festival lanterns over the plaza", "every kind of know-how"),
            "ja": ("広場のお祭りの提灯", "あらゆる知恵"),
            "es": ("farolillos de fiesta en la plaza", "todo tipo de consejos"),
            "fr": ("des lampions de fête sur la place", "toutes sortes d'astuces"),
            "ko": ("광장의 축제 등불", "온갖 지혜"),
            "pt": ("lanternas de festa na praça", "todo tipo de dica"),
            "de": ("Festlaternen über dem Platz", "allerlei Wissen"),
            "zh": ("广场上的节日灯笼", "各种各样的窍门"),
        },
    ),
}

THEMES = {
    "call_family": "cafe",
    "medicine": "clinic",
    "bedtime": "bathhouse",
    "water_plants": "garden",
    "rainy": "playground",
}

# What a landmark is called once it is known ("the bakery"). Japanese, Korean and Chinese use the name as is.
THE: dict[str, dict[str, str]] = {
    "bakery": {
        "en": "the bakery",
        "es": "la panadería",
        "fr": "la boulangerie",
        "pt": "a padaria",
        "de": "die Bäckerei",
    },
    "playground": {
        "en": "the playground",
        "es": "el parque infantil",
        "fr": "l'aire de jeux",
        "pt": "o parquinho",
        "de": "der Spielplatz",
    },
    "library": {
        "en": "the library",
        "es": "la biblioteca",
        "fr": "la bibliothèque",
        "pt": "a biblioteca",
        "de": "die Bibliothek",
    },
    "garden": {"en": "the garden", "es": "el jardín", "fr": "le jardin", "pt": "o jardim", "de": "der Garten"},
    "clinic": {
        "en": "the clinic",
        "es": "la clínica",
        "fr": "le cabinet médical",
        "pt": "a clínica",
        "de": "die Praxis",
    },
    "cafe": {"en": "the café", "es": "el café", "fr": "le café", "pt": "o café", "de": "das Café"},
    "bathhouse": {
        "en": "the bathhouse",
        "es": "la casa de baños",
        "fr": "le bain public",
        "pt": "a casa de banhos",
        "de": "das Badehaus",
    },
    "stage": {"en": "the music stage", "es": "el escenario", "fr": "la scène", "pt": "o palco", "de": "die Bühne"},
    "market": {"en": "the market", "es": "el mercado", "fr": "le marché", "pt": "a feira", "de": "der Markt"},
    "workshop": {"en": "the workshop", "es": "el taller", "fr": "l'atelier", "pt": "a oficina", "de": "die Werkstatt"},
    "petpark": {
        "en": "the dog park",
        "es": "el parque para perros",
        "fr": "le parc à chiens",
        "pt": "o parque para cães",
        "de": "die Hundewiese",
    },
}

BUILT = {
    "en": "{name} opened in town! It grew from all the thanks for {what}.",
    "ja": "町に{name}ができました！{what}への感謝がきっかけです。",
    "es": "¡Se abrió {name} en el pueblo! Todo empezó con los agradecimientos por {what}.",
    "fr": "Nouveau en ville : {name} ! Tout est parti des remerciements pour {what}.",
    "ko": "동네에 {name}{subject} 생겼어요! {what}에 대한 감사가 계기가 됐어요.",
    "pt": "Abriu {name} na cidade! Tudo começou com os agradecimentos por {what}.",
    "de": "Neu in der Stadt: {name}! Alles begann mit dem Dank für {what}.",
    "zh": "小镇上开了{name}！起因是大家感谢{what}。",
}

GREW = {
    "en": "{name} got bigger! The thanks for {what} keep coming.",
    "ja": "{name}が大きくなりました！{what}への感謝が続いています。",
    "es": "¡{name} creció! Siguen llegando agradecimientos por {what}.",
    "fr": "Agrandissement pour {name} ! Les remerciements pour {what} continuent.",
    "ko": "{name}{subject} 더 커졌어요! {what}에 대한 감사가 계속되고 있어요.",
    "pt": "{name} cresceu! Os agradecimentos por {what} continuam.",
    "de": "{name} ist gewachsen! Der Dank für {what} reißt nicht ab.",
    "zh": "{name}扩建了！大家还在不断感谢{what}。",
}

FESTIVAL = {
    "en": "Festival lanterns now hang over the plaza! The town has every kind of place now, all grown from thanks.",
    "ja": "広場にお祭りの提灯が灯りました！感謝から育った町に、すべての施設がそろいました。",
    "es": "¡Ya cuelgan farolillos de fiesta en la plaza! El pueblo ya tiene de todo, y todo nació de los agradecimientos.",
    "fr": "Des lampions de fête brillent sur la place ! La ville a maintenant de tout, et tout est né des remerciements.",
    "ko": "광장에 축제 등불이 켜졌어요! 감사로 자란 동네에 모든 시설이 갖춰졌어요.",
    "pt": "Lanternas de festa iluminam a praça! A cidade já tem de tudo, e tudo nasceu dos agradecimentos.",
    "de": "Über dem Platz leuchten Festlaternen! Die Stadt hat jetzt alles, und alles ist aus Dank gewachsen.",
    "zh": "广场上挂起了节日灯笼！在感谢中成长的小镇，所有设施都齐了。",
}


def _korean_subject(word: str) -> str:
    """이 after a final consonant, 가 after a vowel."""
    last = ord(word[-1]) - 0xAC00
    return "이" if 0 <= last < 11172 and last % 28 else "가"


def announce(kind: str, language: str, *, upgrade: bool = False) -> str:
    """The news of a new (or bigger) landmark, in a home's language."""
    language = language if language in BUILT else "en"
    if kind == "lanterns":
        return FESTIVAL[language]
    name, what = LANDMARKS[kind][1].get(language, LANDMARKS[kind][1]["en"])
    if upgrade:
        name = THE[kind].get(language, name)
    template = (GREW if upgrade else BUILT)[language]
    text = template.format(name=name, what=what, subject=_korean_subject(name))
    if text.startswith("¡"):
        return "¡" + text[1].upper() + text[2:]
    return text[0].upper() + text[1:]


def level_for(xp: int) -> int:
    return max(i + 1 for i, need in enumerate(LEVELS) if xp >= need)


def category(text: str, keywords: list[str] | None = None) -> str | None:
    """Which landmark a tip or a thanks belongs to, from its English topic and keywords."""
    found = words(" ".join([text, *(keywords or [])]))
    scores = {
        kind: len(found & words(" ".join(vocabulary))) for kind, (vocabulary, _) in LANDMARKS.items() if vocabulary
    }
    best = max(scores, key=lambda k: scores[k], default=None)
    return best if best and scores[best] > 0 else None


def xp_and_categories(packets: list[Packet]) -> tuple[int, Counter[str]]:
    by_id = {p.id: p for p in packets}
    xp = sum(XP.get(p.kind, 0) for p in packets)
    thanked: Counter[str] = Counter()
    for p in packets:
        if p.kind != "thanks":
            continue
        tip = by_id.get(p.payload.get("tip_id") or "")
        if tip is not None:
            kind = category(tip.payload.get("topic", ""), tip.payload.get("keywords"))
        else:
            theme = i18n.theme_key(p.payload.get("what_helped", ""))
            kind = THEMES.get(theme) if theme else category(p.payload.get("what_helped", ""))
        if kind:
            thanked[kind] += 1
    return xp, thanked


def next_landmark(thanked: Counter[str], built: list[str]) -> str:
    for kind, _ in thanked.most_common():
        if kind not in built:
            return kind
    remaining = [k for k in LANDMARKS if k not in built and k != "lanterns"]
    return remaining[0] if remaining else "lanterns"


def next_step(thanked: Counter[str], built: list[str], upgraded: list[str]) -> tuple[str, bool]:
    """What the next level brings: (landmark, whether it is an upgrade of a built one).

    Every landmark (and the lanterns) comes first; then the landmarks grow bigger, the most
    thanked topic first.
    """
    if len(built) < len(LANDMARKS):
        return next_landmark(thanked, built), False
    for kind, _ in thanked.most_common():
        if kind in LANDMARKS and kind != "lanterns" and kind not in upgraded:
            return kind, True
    return next(k for k in LANDMARKS if k != "lanterns" and k not in upgraded), True


def _steps(thanked: Counter[str], record: dict[str, Any], levels: range, at: str) -> list[tuple[str, bool, int]]:
    """Apply the steps for `levels` to `record` (in place) and return them."""
    record.setdefault("landmarks", [])
    record.setdefault("upgrades", [])
    steps = []
    for n in levels:
        built = [lm["kind"] for lm in record["landmarks"]]
        upgraded = [lm["kind"] for lm in record["upgrades"]]
        kind, upgrade = next_step(thanked, built, upgraded)
        record["upgrades" if upgrade else "landmarks"].append({"kind": kind, "level": n, "at": at})
        steps.append((kind, upgrade, n))
    return steps


def summary(packets: list[Packet], record: dict[str, Any] | None) -> dict[str, Any]:
    """What the town view shows: level, progress to the next step, the landmarks and upgrades."""
    xp, thanked = xp_and_categories(packets)
    xp += (record or {}).get("chats", 0)
    level = (record or {}).get("level") or level_for(xp)
    if record is None:
        record = {}
        _steps(thanked, record, range(2, level + 1), "")
    current = LEVELS[min(level, len(LEVELS)) - 1]
    upcoming = LEVELS[level] if level < len(LEVELS) else None
    return {
        "level": level,
        "xp": xp,
        "level_xp": current,
        "next_xp": upcoming,
        "landmarks": record.get("landmarks", []),
        "upgrades": record.get("upgrades", []),
        "leading": thanked.most_common(1)[0][0] if thanked else None,
    }


def grow(store, at: datetime, tick: int, *, chats: int = 0) -> tuple[list[TownEvent], dict[str, list[ReportItem]]]:
    """Build (or enlarge) the landmarks the town has earned, counting this tick's `chats`.

    The first time (no record yet), the town quietly starts with what its history earned.
    """
    packets = store.packets()
    xp, thanked = xp_and_categories(packets)
    record = store.get_growth()
    chats += (record or {}).get("chats", 0)
    level = level_for(xp + chats)
    if record is None:
        record = {}
        _steps(thanked, record, range(2, level + 1), at.isoformat())
        store.put_growth({**record, "level": level, "chats": chats})
        return [], {}
    if level <= record["level"]:
        store.put_growth({**record, "chats": chats})
        return [], {}
    events: list[TownEvent] = []
    lines: dict[str, list[ReportItem]] = {}
    homes = [h for h in store.households() if h.tier in ("demo", "real")]
    for kind, upgrade, n in _steps(thanked, record, range(record["level"] + 1, level + 1), at.isoformat()):
        detail: dict[str, Any] = {"landmark": kind, "level": n}
        if upgrade:
            detail["upgrade"] = True
        events.append(
            TownEvent(tick=tick, at=at, type="town", summary=announce(kind, "en", upgrade=upgrade), detail=detail)
        )
        key = f"growth:{kind}:bigger" if upgrade else f"growth:{kind}"
        for home in homes:
            text = announce(kind, i18n.normalize(home.language), upgrade=upgrade)
            lines.setdefault(home.id, []).append(ReportItem(kind="growth", text=text, key=key))
    store.put_growth({**record, "level": level, "chats": chats})
    return events, lines


def describe(record: dict[str, Any] | None) -> str | None:
    """One line on how far the town has grown, for Alexa to answer "how is the town doing?"."""
    if not record:
        return None
    name = lambda kind: LANDMARKS[kind][1]["en"][0]  # noqa: E731
    built = [name(lm["kind"]) for lm in record.get("landmarks", []) if lm["kind"] in LANDMARKS]
    bigger = [THE[u["kind"]]["en"] for u in record.get("upgrades", []) if u["kind"] in THE]
    parts = [f"The town is at level {record['level']} of {len(LEVELS)}."]
    if built:
        parts.append(f"Built with thanks so far, oldest first: {', '.join(built)}.")
    else:
        parts.append("No landmark has been built yet; the first one comes with the next level.")
    if bigger:
        parts.append(f"Grown bigger since: {', '.join(bigger)}.")
    if record["level"] >= len(LEVELS):
        parts.append("The town is complete.")
    return " ".join(parts)
