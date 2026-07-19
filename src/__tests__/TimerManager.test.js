import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startTimer, stopTimer, pauseTimer, resumeTimer,
  hasActiveTimer, getRemaining, DURATIONS, _resetAll,
} from '../TimerManager.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  _resetAll();
  vi.useRealTimers();
});

describe('startTimer', () => {
  it('rechaza un tipo desconocido y no arranca nada', () => {
    const onTick = vi.fn();
    const onEnd  = vi.fn();
    expect(startTimer('S1', 'INEXISTENTE', onTick, onEnd)).toBe(false);
    expect(hasActiveTimer('S1')).toBe(false);
  });

  it('emite ticks periódicos con el tiempo restante decreciendo', () => {
    const onTick = vi.fn();
    startTimer('S1', 'SALVA', onTick, vi.fn());

    vi.advanceTimersByTime(300);
    expect(onTick).toHaveBeenCalled();
    const remainings = onTick.mock.calls.map((c) => c[2]);
    expect(remainings[0]).toBeGreaterThan(remainings.at(-1));
  });

  it('llama a onEnd exactamente al agotarse la duración y limpia el timer', () => {
    const onEnd = vi.fn();
    startTimer('S1', 'SALVA', vi.fn(), onEnd);

    vi.advanceTimersByTime(DURATIONS.SALVA - 1);
    expect(onEnd).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledWith('S1', 'SALVA');
    expect(hasActiveTimer('S1')).toBe(false);
  });

  it('arrancar un timer nuevo para la misma sala reemplaza al anterior (no dispara el onEnd viejo)', () => {
    const onEndViejo = vi.fn();
    const onEndNuevo = vi.fn();
    startTimer('S1', 'TURNO', vi.fn(), onEndViejo);
    startTimer('S1', 'SALVA', vi.fn(), onEndNuevo);

    vi.advanceTimersByTime(DURATIONS.SALVA); // agota el nuevo (SALVA), no el viejo (TURNO)
    expect(onEndNuevo).toHaveBeenCalledWith('S1', 'SALVA');
    expect(onEndViejo).not.toHaveBeenCalled();
  });
});

describe('stopTimer', () => {
  it('cancela el timer y no llama a onEnd', () => {
    const onEnd = vi.fn();
    startTimer('S1', 'SALVA', vi.fn(), onEnd);
    stopTimer('S1');

    vi.advanceTimersByTime(DURATIONS.SALVA + 1000);
    expect(onEnd).not.toHaveBeenCalled();
    expect(hasActiveTimer('S1')).toBe(false);
  });

  it('no falla si se llama sobre una sala sin timer activo', () => {
    expect(() => stopTimer('sala-inexistente')).not.toThrow();
  });
});

describe('pauseTimer / resumeTimer', () => {
  it('congela el tiempo restante mientras está en pausa', () => {
    const onEnd = vi.fn();
    startTimer('S1', 'TURNO', vi.fn(), onEnd);

    vi.advanceTimersByTime(10_000);
    pauseTimer('S1');
    const restante = getRemaining('S1');

    vi.advanceTimersByTime(60_000); // muy por encima de la duración total
    expect(onEnd).not.toHaveBeenCalled();
    expect(getRemaining('S1')).toBe(restante);
  });

  it('reanuda desde el tiempo restante y termina en el momento correcto', () => {
    const onEnd = vi.fn();
    startTimer('S1', 'TURNO', vi.fn(), onEnd);

    vi.advanceTimersByTime(10_000);
    pauseTimer('S1');
    vi.advanceTimersByTime(5_000); // tiempo "congelado", no debe contar
    resumeTimer('S1');

    vi.advanceTimersByTime(DURATIONS.TURNO - 10_000 - 1);
    expect(onEnd).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onEnd).toHaveBeenCalledWith('S1', 'TURNO');
  });

  it('pausar/reanudar sobre una sala sin timer no hace nada', () => {
    expect(() => pauseTimer('sala-x')).not.toThrow();
    expect(() => resumeTimer('sala-x')).not.toThrow();
  });

  it('pausar dos veces seguidas es un no-op', () => {
    startTimer('S1', 'TURNO', vi.fn(), vi.fn());
    vi.advanceTimersByTime(5_000);
    pauseTimer('S1');
    const restante = getRemaining('S1');
    pauseTimer('S1'); // no debería recalcular de nuevo
    expect(getRemaining('S1')).toBe(restante);
  });
});

describe('getRemaining', () => {
  it('devuelve null si no hay timer activo', () => {
    expect(getRemaining('sala-x')).toBeNull();
  });
});
