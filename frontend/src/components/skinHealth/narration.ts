import type { EducationLocale } from './catalog.ts';

export type NarrationState = 'idle' | 'playing' | 'paused' | 'error';

export interface NarrationAdapter {
  state(): NarrationState;
  subscribe(listener: () => void): () => void;
  subscribeAvailability(listener: () => void): () => void;
  available(locale: EducationLocale): boolean;
  play(locale: EducationLocale, text: string): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface AudioElementLike {
  src: string;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
  onended: HTMLAudioElement['onended'];
  onerror: HTMLAudioElement['onerror'];
}

export function selectLocalVoice(voices: SpeechSynthesisVoice[], locale: EducationLocale) {
  const requested = locale.toLowerCase();
  const local = voices.filter((voice) => voice.localService === true);
  const tag = (voice: SpeechSynthesisVoice) => (voice.lang || '').trim().toLowerCase().replaceAll('_', '-');
  return (
    local.find((voice) => tag(voice) === requested) ??
    local.find((voice) => {
      const language = tag(voice);
      if (locale === 'hi-Latn') return language.startsWith('hi-latn-');
      return (
        language.startsWith(requested + '-') &&
        (locale === 'en' || !language.split('-').includes('latn'))
      );
    })
  );
}

export function createBrowserNarrator(
  synth = typeof window === 'undefined' ? undefined : window.speechSynthesis,
  Utterance = typeof window === 'undefined' ? undefined : window.SpeechSynthesisUtterance,
): NarrationAdapter {
  const listeners = new Set<() => void>();
  const availabilityListeners = new Set<() => void>();
  let cleanupSynthListener: (() => void) | null = null;
  let state: NarrationState = 'idle';
  let active: SpeechSynthesisUtterance | null = null;

  function update(next: NarrationState) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  function stop() {
    const started = active !== null;
    active = null;
    if (started) synth?.cancel();
    update('idle');
  }

  function ensureSynthListener() {
    if (cleanupSynthListener || !synth) return;

    const prevHandler = synth.onvoiceschanged;

    const onVoicesChanged = (e?: Event) => {
      if (prevHandler && typeof prevHandler === 'function') {
        const evt = e || (typeof Event !== 'undefined' ? new Event('voiceschanged') : ({} as Event));
        prevHandler.call(synth, evt);
      }
      availabilityListeners.forEach((listener) => listener());
    };

    synth.addEventListener?.('voiceschanged', onVoicesChanged);
    synth.onvoiceschanged = onVoicesChanged;

    cleanupSynthListener = () => {
      synth.removeEventListener?.('voiceschanged', onVoicesChanged);
      if (synth.onvoiceschanged === onVoicesChanged) {
        synth.onvoiceschanged = prevHandler ?? null;
      }
      cleanupSynthListener = null;
    };
  }

  return {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeAvailability(listener) {
      if (!synth) return () => {};
      availabilityListeners.add(listener);
      ensureSynthListener();
      return () => {
        availabilityListeners.delete(listener);
        if (availabilityListeners.size === 0) {
          cleanupSynthListener?.();
        }
      };
    },
    available(locale) {
      return Boolean(synth && Utterance && selectLocalVoice(synth.getVoices(), locale));
    },
    play(locale, text) {
      if (active || !synth || !Utterance) return;
      const voice = selectLocalVoice(synth.getVoices(), locale);
      if (!voice || !text.trim()) return;
      const utterance = new Utterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      const finish = (next: NarrationState) => {
        if (active !== utterance) return;
        active = null;
        update(next);
      };
      utterance.onend = () => finish('idle');
      utterance.onerror = () => finish('error');
      active = utterance;
      update('playing');
      try {
        synth.speak(utterance);
      } catch {
        finish('error');
      }
    },
    pause() {
      if (!active || state !== 'playing') return;
      synth?.pause();
      update('paused');
    },
    resume() {
      if (!active || state !== 'paused') return;
      synth?.resume();
      update('playing');
    },
    stop,
  };
}

export function createVerifiedBlobAudioPlayer(
  createAudio: (url: string) => AudioElementLike = (url) => new Audio(url),
) {
  const listeners = new Set<() => void>();
  let state: NarrationState = 'idle';
  let activeUrl: string | null = null;
  let audio: AudioElementLike | null = null;

  function emit(next: NarrationState) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  function releaseAudio() {
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
        audio.currentTime = 0;
        audio.src = '';
      } catch {
        // Ignore teardown errors on partially initialized media elements.
      }
      audio = null;
    }
  }

  return {
    state: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setSource(url: string | null) {
      releaseAudio();
      activeUrl = url;
      emit('idle');
    },
    play() {
      if (!activeUrl || audio) return;
      const currentUrl = activeUrl;
      const element = createAudio(currentUrl);
      audio = element;
      element.onended = () => {
        if (audio !== element) return;
        releaseAudio();
        emit('idle');
      };
      element.onerror = () => {
        if (audio !== element) return;
        releaseAudio();
        emit('error');
      };
      emit('playing');
      try {
        const result = element.play();
        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch(() => {
            if (audio !== element) return;
            releaseAudio();
            emit('error');
          });
        }
      } catch {
        if (audio === element) {
          releaseAudio();
          emit('error');
        }
      }
    },
    pause() {
      if (!audio || state !== 'playing') return;
      audio.pause();
      emit('paused');
    },
    resume() {
      if (!audio || state !== 'paused') return;
      emit('playing');
      try {
        const result = audio.play();
        if (result && typeof (result as Promise<void>).catch === 'function') {
          void (result as Promise<void>).catch(() => {
            releaseAudio();
            emit('error');
          });
        }
      } catch {
        releaseAudio();
        emit('error');
      }
    },
    stop() {
      releaseAudio();
      emit('idle');
    },
  };
}
