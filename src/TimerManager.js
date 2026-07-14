export const DURATIONS = {
  COLOCACION: 90_000,
  TURNO:      30_000,
  SALVA:       8_000,
  // CONTRAMEDIDA (5s) se gestiona con setTimeout local en battlecaos-game, no aquí.
};

const TICK_MS = 100;

// Un solo timer activo por sala (codigo) — arrancar uno nuevo reemplaza al anterior.
const timers = {};

export function startTimer(codigo, tipo, onTick, onEnd) {
  const duration = DURATIONS[tipo];
  if (!duration) return false;

  stopTimer(codigo);
  timers[codigo] = { tipo, onTick, onEnd, paused: false };
  run(codigo, duration);
  return true;
}

function run(codigo, remaining) {
  const state = timers[codigo];
  if (!state) return;

  state.remaining = remaining;
  state.startedAt = Date.now();

  state.intervalId = setInterval(() => {
    const left = Math.max(0, remaining - (Date.now() - state.startedAt));
    state.onTick(codigo, state.tipo, left);
  }, TICK_MS);

  state.timeoutId = setTimeout(() => {
    clearInterval(state.intervalId);
    delete timers[codigo];
    state.onEnd(codigo, state.tipo);
  }, remaining);
}

export function stopTimer(codigo) {
  const state = timers[codigo];
  if (!state) return;
  clearInterval(state.intervalId);
  clearTimeout(state.timeoutId);
  delete timers[codigo];
}

export function pauseTimer(codigo) {
  const state = timers[codigo];
  if (!state || state.paused) return;
  state.paused    = true;
  state.remaining = Math.max(0, state.remaining - (Date.now() - state.startedAt));
  clearInterval(state.intervalId);
  clearTimeout(state.timeoutId);
}

export function resumeTimer(codigo) {
  const state = timers[codigo];
  if (!state || !state.paused) return;
  state.paused = false;
  run(codigo, state.remaining);
}

export function hasActiveTimer(codigo) {
  return !!timers[codigo];
}

export function getRemaining(codigo) {
  const state = timers[codigo];
  if (!state) return null;
  return state.paused ? state.remaining : Math.max(0, state.remaining - (Date.now() - state.startedAt));
}

// Solo para tests: limpia todo el estado del módulo entre casos.
export function _resetAll() {
  for (const codigo of Object.keys(timers)) stopTimer(codigo);
}
