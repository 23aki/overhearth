/** Browser speech in and out (Web Speech API). Falls back to typing when unavailable. */

interface RecognitionResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const canListen = (): boolean => recognitionCtor() !== undefined;

/** BCP 47 tags for the languages homes can speak. */
const LOCALES: Record<string, string> = {
  en: "en-US",
  ja: "ja-JP",
  es: "es-MX",
  fr: "fr-FR",
  ko: "ko-KR",
  pt: "pt-BR",
  de: "de-DE",
  zh: "zh-CN",
};

export const locale = (lang: string): string => LOCALES[lang] ?? "en-US";

/** Listen for one utterance. Resolves with the transcript, or "" if nothing was heard. */
export function listenOnce(lang = "en"): Promise<string> {
  const Ctor = recognitionCtor();
  if (!Ctor) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const recognition = new Ctor();
    recognition.lang = locale(lang);
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    let heard = "";
    recognition.onresult = (event) => {
      heard = event.results[0]?.[0]?.transcript ?? "";
    };
    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") resolve("");
      else reject(new Error(event.error));
    };
    recognition.onend = () => resolve(heard);
    recognition.start();
  });
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(lang));
  return voices.find((v) => /natural|neural/i.test(v.name)) ?? voices.find((v) => v.lang === locale(lang)) ?? voices[0];
}

/**
 * The language a reply is actually in. Alexa answers in the language the person spoke, which
 * may not be the home's, so the voice follows the text: script for Japanese, Chinese and Korean,
 * plain ASCII for English, the home's language otherwise.
 */
function spokenLanguage(text: string, home: string): string {
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\u4e00-\u9fff]/.test(text)) return home === "ja" ? "ja" : "zh";
  if (/^[\x00-\x7f\s]*$/.test(text)) return "en";
  return home;
}

/** Speak a reply, in the voice of the language it is in. */
export function speak(text: string, lang = "en"): Promise<void> {
  if (!("speechSynthesis" in window) || !text) return Promise.resolve();
  speechSynthesis.cancel();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const spoken = spokenLanguage(text, lang);
    utterance.lang = locale(spoken);
    const voice = pickVoice(spoken);
    if (voice) utterance.voice = voice;
    utterance.rate = 1.02;
    // Some browsers never fire onend (no voices installed); don't hang the conversation.
    const giveUp = setTimeout(resolve, 2000 + text.length * 80);
    const done = () => {
      clearTimeout(giveUp);
      resolve();
    };
    utterance.onend = done;
    utterance.onerror = done;
    speechSynthesis.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
