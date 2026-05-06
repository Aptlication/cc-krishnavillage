import { Platform } from "react-native";

function getAudioContext(): AudioContext | null {
  if (Platform.OS !== "web") return null;
  try {
    const Ctx =
      window.AudioContext ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    return Ctx ? new Ctx() : null;
  } catch {
    return null;
  }
}

function playTone(
  ctx: AudioContext,
  freq: number,
  startTime: number,
  duration: number,
  peak: number,
  type: OscillatorType = "sine",
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}

/**
 * Plays a gentle two-note chime — used when a new notification arrives.
 */
export function playNotificationChime() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  // Rising interval: E5 → B5
  playTone(ctx, 659, t, 0.5, 0.18);
  playTone(ctx, 988, t + 0.18, 0.5, 0.12);
  setTimeout(() => ctx.close().catch(() => {}), 1200);
}

/**
 * Plays a short ascending three-note arpeggio — used for successful actions
 * (e.g. notification sent, maintenance report submitted).
 */
export function playSuccessChime() {
  const ctx = getAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  // C5 → E5 → G5
  const notes = [523, 659, 784];
  notes.forEach((freq, i) => {
    playTone(ctx, freq, t + i * 0.09, 0.3, 0.14);
  });
  setTimeout(() => ctx.close().catch(() => {}), 1000);
}
