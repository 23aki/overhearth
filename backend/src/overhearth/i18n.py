# ruff: noqa: E501  (a message catalog: one translation per line reads best)
"""Languages of the town, and the report lines each home hears in its own language.

Know-how keeps its original language. A home hears report lines from these templates, with the
content translated for it when a translation is available (see `overhearth.translate`).
"""

from __future__ import annotations

LANGUAGES: dict[str, tuple[str, str]] = {
    "en": ("English", "English"),
    "ja": ("Japanese", "日本語"),
    "es": ("Spanish", "Español"),
    "fr": ("French", "Français"),
    "ko": ("Korean", "한국어"),
    "pt": ("Portuguese", "Português"),
    "de": ("German", "Deutsch"),
    "zh": ("Chinese", "中文"),
}
"""Code → (English name, native name)."""

DEFAULT_LANGUAGE = "en"


def language_name(code: str) -> str:
    return LANGUAGES.get(code, LANGUAGES[DEFAULT_LANGUAGE])[0]


def normalize(code: str | None) -> str:
    code = (code or "").split("-")[0].lower()
    return code if code in LANGUAGES else DEFAULT_LANGUAGE


_TEMPLATES: dict[str, dict[str, str]] = {
    "en": {
        "tip": "{carrier} passed on a tip about {topic} from {origin}: {text}",
        "answer": "You wondered about {topic}. {helper} knew something from {origin}: {text}",
        "wondering": "Someone from {origin} is wondering about {topic}: {text} If you know, tell me and I'll take it to town.",
        "thanks_return": "Your tip about {topic} was thanked {times} in {places} since we last talked.",
        "trend": "Around town lately, people have been thankful for {themes}.",
        "once": "once",
        "times": "{n} times",
        "one_home": "one home",
        "homes": "{n} homes",
        "and": " and ",
        "diary_ready": "I drew today's picture diary. Want to see it?",
    },
    "ja": {
        "tip": "{carrier}が、{origin}の「{topic}」のコツを教えてくれました：{text}",
        "answer": "「{topic}」が気になっていましたね。{helper}が{origin}の知恵を知っていました：{text}",
        "wondering": "{origin}の人が「{topic}」について知りたがっています：{text} 知っていたら教えてください。町に持っていきます。",
        "thanks_return": "あなたの「{topic}」のコツが、前回お話ししてから{places}で{times}感謝されました。",
        "trend": "最近の町では、{themes}に感謝している人が多いようです。",
        "once": "1回",
        "times": "{n}回",
        "one_home": "1軒の家",
        "homes": "{n}軒の家",
        "and": "や",
        "diary_ready": "今日の絵日記を描いたよ。見る？",
    },
    "es": {
        "tip": "{carrier} trajo un consejo sobre {topic} de {origin}: {text}",
        "answer": "Te preguntabas sobre {topic}. {helper} sabía algo de {origin}: {text}",
        "wondering": "Alguien de {origin} se pregunta sobre {topic}: {text} Si lo sabes, dímelo y lo llevaré al pueblo.",
        "thanks_return": "Tu consejo sobre {topic} fue agradecido {times} en {places} desde la última vez que hablamos.",
        "trend": "Últimamente en el pueblo, la gente agradece {themes}.",
        "once": "una vez",
        "times": "{n} veces",
        "one_home": "un hogar",
        "homes": "{n} hogares",
        "and": " y ",
        "diary_ready": "Dibujé el diario ilustrado de hoy. ¿Quieres verlo?",
    },
    "fr": {
        "tip": "{carrier} a rapporté une astuce sur {topic} de {origin} : {text}",
        "answer": "Vous vous posiez des questions sur {topic}. {helper} connaissait une astuce de {origin} : {text}",
        "wondering": "Quelqu'un de {origin} se pose une question sur {topic} : {text} Si vous savez, dites-le-moi et je l'apporterai en ville.",
        "thanks_return": "Votre astuce sur {topic} a été remerciée {times} dans {places} depuis notre dernière conversation.",
        "trend": "Ces derniers temps en ville, on est reconnaissant pour {themes}.",
        "once": "une fois",
        "times": "{n} fois",
        "one_home": "un foyer",
        "homes": "{n} foyers",
        "and": " et ",
        "diary_ready": "J'ai dessiné le journal illustré d'aujourd'hui. Tu veux le voir ?",
    },
    "ko": {
        "tip": "{carrier}가 {origin}의 '{topic}' 팁을 알려 줬어요: {text}",
        "answer": "'{topic}'이(가) 궁금하셨죠. {helper}가 {origin}의 지혜를 알고 있었어요: {text}",
        "wondering": "{origin}의 누군가가 '{topic}'에 대해 궁금해해요: {text} 아시면 알려 주세요. 동네에 전해 줄게요.",
        "thanks_return": "지난번 이야기 이후로 '{topic}' 팁이 {places}에서 {times} 감사받았어요.",
        "trend": "요즘 동네에서는 {themes}에 감사하는 사람이 많아요.",
        "once": "한 번",
        "times": "{n}번",
        "one_home": "한 집",
        "homes": "{n}집",
        "and": ", ",
        "diary_ready": "오늘의 그림일기를 그렸어요. 볼래요?",
    },
    "pt": {
        "tip": "{carrier} trouxe uma dica sobre {topic} de {origin}: {text}",
        "answer": "Você queria saber sobre {topic}. {helper} conhecia algo de {origin}: {text}",
        "wondering": "Alguém de {origin} quer saber sobre {topic}: {text} Se você souber, me conte e eu levo para a cidade.",
        "thanks_return": "Sua dica sobre {topic} foi agradecida {times} em {places} desde a nossa última conversa.",
        "trend": "Ultimamente na cidade, as pessoas agradecem por {themes}.",
        "once": "uma vez",
        "times": "{n} vezes",
        "one_home": "uma casa",
        "homes": "{n} casas",
        "and": " e ",
        "diary_ready": "Desenhei o diário ilustrado de hoje. Quer ver?",
    },
    "de": {
        "tip": "{carrier} hat einen Tipp zu {topic} von {origin} mitgebracht: {text}",
        "answer": "Du wolltest etwas über {topic} wissen. {helper} kannte etwas von {origin}: {text}",
        "wondering": "Jemand von {origin} fragt sich etwas zu {topic}: {text} Wenn du es weißt, sag es mir, dann bringe ich es in die Stadt.",
        "thanks_return": "Seit unserem letzten Gespräch wurde dein Tipp zu {topic} {times} in {places} gedankt.",
        "trend": "In letzter Zeit sind die Leute in der Stadt dankbar für {themes}.",
        "once": "einmal",
        "times": "{n}-mal",
        "one_home": "einem Zuhause",
        "homes": "{n} Haushalten",
        "and": " und ",
        "diary_ready": "Ich habe das heutige Bildtagebuch gemalt. Willst du es sehen?",
    },
    "zh": {
        "tip": "{carrier}带回了{origin}关于「{topic}」的小窍门：{text}",
        "answer": "你一直想知道「{topic}」。{helper}知道{origin}的一个办法：{text}",
        "wondering": "{origin}的人想知道「{topic}」：{text} 如果你知道，告诉我，我会带去小镇。",
        "thanks_return": "自从我们上次聊天以来，你关于「{topic}」的窍门在{places}被感谢了{times}。",
        "trend": "最近小镇上，很多人都很感谢{themes}。",
        "once": "1次",
        "times": "{n}次",
        "one_home": "1个家庭",
        "homes": "{n}个家庭",
        "and": "和",
        "diary_ready": "我画好了今天的图画日记。要看看吗？",
    },
}

THEMES: dict[str, dict[str, str]] = {
    "call_family": {
        "en": "reminders to call family",
        "ja": "家族に電話するリマインダー",
        "es": "los recordatorios para llamar a la familia",
        "fr": "les rappels pour appeler la famille",
        "ko": "가족에게 전화하라는 알림",
        "pt": "os lembretes para ligar para a família",
        "de": "Erinnerungen, die Familie anzurufen",
        "zh": "提醒给家人打电话",
    },
    "medicine": {
        "en": "help keeping track of medicine",
        "ja": "薬の飲み忘れを防ぐ手助け",
        "es": "la ayuda para llevar el control de los medicamentos",
        "fr": "l'aide pour suivre les médicaments",
        "ko": "약 챙기기 도움",
        "pt": "a ajuda para controlar os remédios",
        "de": "Hilfe beim Überblick über Medikamente",
        "zh": "帮忙记着按时吃药",
    },
    "bedtime": {
        "en": "a calm bedtime routine",
        "ja": "落ち着いた寝る前の習慣",
        "es": "una rutina tranquila para dormir",
        "fr": "une routine du coucher apaisante",
        "ko": "차분한 잠자리 루틴",
        "pt": "uma rotina tranquila na hora de dormir",
        "de": "eine ruhige Abendroutine",
        "zh": "平静的睡前习惯",
    },
    "water_plants": {
        "en": "reminders to water the plants",
        "ja": "植物の水やりのリマインダー",
        "es": "los recordatorios para regar las plantas",
        "fr": "les rappels pour arroser les plantes",
        "ko": "화분에 물 주라는 알림",
        "pt": "os lembretes para regar as plantas",
        "de": "Erinnerungen, die Pflanzen zu gießen",
        "zh": "提醒给植物浇水",
    },
    "rainy": {
        "en": "rainy-day ideas for the kids",
        "ja": "雨の日の子ども向けの遊びのアイデア",
        "es": "las ideas para los niños en días de lluvia",
        "fr": "les idées pour les enfants les jours de pluie",
        "ko": "비 오는 날 아이들과 할 거리",
        "pt": "as ideias para as crianças em dias de chuva",
        "de": "Ideen für Regentage mit Kindern",
        "zh": "雨天陪孩子玩的点子",
    },
}


def say(language: str, key: str, **values: object) -> str:
    template = _TEMPLATES.get(normalize(language), _TEMPLATES[DEFAULT_LANGUAGE])[key]
    return template.format(**values)


def count_times(language: str, n: int) -> str:
    return say(language, "once") if n == 1 else say(language, "times", n=n)


def count_homes(language: str, n: int) -> str:
    return say(language, "one_home") if n == 1 else say(language, "homes", n=n)


def join(language: str, items: list[str]) -> str:
    return say(language, "and").join(items)


def theme(key: str, language: str) -> str | None:
    """A gratitude theme in a language, if it is one of the town's common themes."""
    entry = THEMES.get(key)
    return entry.get(normalize(language)) if entry else None


def theme_key(text: str) -> str | None:
    """Which common theme a 'what helped' phrase is, in any language."""
    needle = text.strip().rstrip(".").lower()
    for key, translations in THEMES.items():
        if any(needle == t.lower() for t in translations.values()):
            return key
    return None
