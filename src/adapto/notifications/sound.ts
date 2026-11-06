// ============================================================
// Som de mensagem nova.
//
// Três decisões que valem registro, porque cada uma evita um erro comum:
//
// 1. O arquivo é gerado com a Web Audio API, não baixado. Um `.mp3` no
//    repositório seria um binário de licença duvidosa (o som do WhatsApp é
//    marca registrada), e um `fetch` para um CDN quebraria em instalação
//    sem internet de saída. Duas notas geradas aqui não têm nenhuma das
//    duas dependências.
//
// 2. O `AudioContext` só nasce depois de um gesto do usuário. Navegador
//    bloqueia áudio criado antes de qualquer clique — é a "política de
//    autoplay" — e um contexto criado cedo demais fica suspenso para
//    sempre. O hook destrava no primeiro clique/tecla e a partir daí está
//    pronto.
//
// 3. Preferência por DISPOSITIVO (`localStorage`), não por conta: se cada
//    atendente tem um fone, o som não deveria ser decisão da conta
//    inteira. É a mesma escolha já feita para as notificações.
// ============================================================

/** Nome do evento disparado quando a preferência muda, para sincronizar abas. */
export const SOUND_CHANGE_EVENT = 'adapto:sound-pref-change';

const STORAGE_KEY = 'adapto.notify.sound.v1';

/**
 * Volume padrão. Deliberadamente baixo: o som toca a cada mensagem recebida,
 * e um alerta alto o dia inteiro vira motivo para desligar o recurso.
 */
const DEFAULT_VOLUME = 0.12;

/** Pede a preferência salva. Padrão: LIGADO. */
export function readSoundPref(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    // Ausente = ligado: o recurso foi pedido e o uso pretendido é receber
    // o aviso. Quem não quiser desliga.
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeSoundPref(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
    window.dispatchEvent(new Event(SOUND_CHANGE_EVENT));
  } catch {
    // Sem storage a preferência vale só para esta sessão.
  }
}

export function subscribeSoundPref(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(SOUND_CHANGE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(SOUND_CHANGE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

// ------------------------------------------------------------
// O tom
// ------------------------------------------------------------

/**
 * Contexto único, criado sob demanda.
 *
 * Um `AudioContext` por som estouraria o limite do navegador (~6 por aba)
 * depois de poucas mensagens. Este é reaproveitado e só retomado se o
 * navegador o tiver suspendido.
 */
let context: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;

  if (!context) {
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  return context;
}

/**
 * Destrava o áudio no primeiro gesto do usuário.
 *
 * Chamado uma vez pelo listener de notificações. Sem isto, o primeiro som
 * chegaria mudo: o navegador mantém o contexto suspenso até um gesto real.
 */
export function primeAudio(): void {
  const ctx = getContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }
}

/**
 * Toca o aviso: duas notas curtas, ascendentes.
 *
 * Duas notas soam "mensagem" sem imitar nenhum produto específico, e a
 * duração total (~220ms) é curta o bastante para não competir com uma
 * conversa por voz.
 */
export function playNotificationSound(volume = DEFAULT_VOLUME): void {
  const ctx = getContext();
  if (!ctx) return;

  // Suspenso significa que ainda não houve gesto; tentar mesmo assim não
  // produz som, então a tentativa é registrada e seguimos.
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }

  const now = ctx.currentTime;
  const gain = ctx.createGain();
  gain.gain.value = Math.min(Math.max(volume, 0), 1);
  gain.connect(ctx.destination);

  // Frequências escolhidas para soar "claro" sem ser estridente:
  // 880Hz (lá) e 1174Hz (ré), intervalo de quinta.
  const notes = [
    { at: 0, frequency: 880, duration: 0.09 },
    { at: 0.11, frequency: 1174, duration: 0.11 },
  ];

  for (const note of notes) {
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.value = note.frequency;

    // Ataque e queda curtos: sem o envelope, o corte seco do oscilador
    // produz um "click" audível no fim da nota.
    envelope.gain.setValueAtTime(0, now + note.at);
    envelope.gain.linearRampToValueAtTime(1, now + note.at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(
      0.001,
      now + note.at + note.duration
    );

    osc.connect(envelope);
    envelope.connect(gain);

    osc.start(now + note.at);
    osc.stop(now + note.at + note.duration + 0.02);
  }
}
