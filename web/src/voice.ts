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

/** Listen for one utterance. Resolves with the transcript, or "" if nothing was heard. */
export function listenOnce(lang = "en-US"): Promise<string> {
  const Ctor = recognitionCtor();
  if (!Ctor) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const recognition = new Ctor();
    recognition.lang = lang;
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

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  return voices.find((v) => /natural|neural/i.test(v.name)) ?? voices.find((v) => v.lang === "en-US") ?? voices[0];
}

export function speak(text: string): Promise<void> {
  if (!("speechSynthesis" in window) || !text) return Promise.resolve();
  speechSynthesis.cancel();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
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
