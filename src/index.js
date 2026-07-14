import 'dotenv/config';
import { createRedis } from './redis.js';
import { producer, createConsumer } from './kafka.js';
import { log } from './logger.js';
import { startTimer, stopTimer, pauseTimer, resumeTimer, hasActiveTimer } from './TimerManager.js';

export const redis = createRedis();
await redis.connect();

await producer.connect();
log.info('kafka producer conectado');

// ── Leader Election (DOMF1303) ────────────────────────────────────────────────
// Solo el leader ejecuta timers reales; el resto solo compite por el lease cada 500ms.
// Si el leader muere, su TTL de 1s expira y otra instancia lo toma — failover ~1.5s.
const ME = `timer-${process.pid}`;
let isLeader = false;

async function tryBecomeLeader() {
  const acquired = await redis.set('timer:leader', ME, 'NX', 'EX', 1);
  if (acquired) {
    isLeader = true;
    log.info(`${ME} es leader`);
  }
}

setInterval(async () => {
  if (isLeader) {
    const renewed = await redis.set('timer:leader', ME, 'XX', 'EX', 1);
    if (!renewed) isLeader = false; // perdió el lease — vuelve a competir
  } else {
    await tryBecomeLeader();
  }
}, 500);

// ── Publicación a evt.timer ───────────────────────────────────────────────────

async function publishTick(codigo, tipo, remaining) {
  await producer.send({
    topic: 'evt.timer',
    messages: [{ key: codigo, value: JSON.stringify({
      type: 'TimerTick', source: 'timer', timestamp: Date.now(),
      data: { codigo, tipo, remaining },
    }) }],
  });
}

async function publishEnd(codigo, tipo) {
  await producer.send({
    topic: 'evt.timer',
    messages: [{ key: codigo, value: JSON.stringify({
      type: 'TimerEnd', source: 'timer', timestamp: Date.now(),
      data: { codigo, tipo },
    }) }],
  });
  log.info(`sala ${codigo} — timer ${tipo} expiró`);
}

// ── Enrutamiento de eventos entrantes a TimerManager ──────────────────────────

const TIMER_PARA_FASE = { TURNOS: 'TURNO', SALVA: 'SALVA' };

function handleMessage(msg) {
  if (!isLeader) return; // los no-líderes ignoran los eventos, no gestionan timers

  if (msg.type === 'RoomReady') {
    startTimer(msg.data.codigo, 'COLOCACION', publishTick, publishEnd);
    log.info(`sala ${msg.data.codigo} → timer COLOCACION iniciado`);
    return;
  }

  if (msg.type === 'PhaseChanged') {
    const { codigo, to } = msg.data;
    const tipo = TIMER_PARA_FASE[to];
    if (tipo) {
      startTimer(codigo, tipo, publishTick, publishEnd);
      log.info(`sala ${codigo} → timer ${tipo} iniciado`);
    } else {
      stopTimer(codigo); // ej. to === 'FIN'
    }
    return;
  }

  if (msg.type === 'GameEnded') {
    stopTimer(msg.data.codigo);
    return;
  }

  if (msg.type === 'TurnStarted') {
    // Rotación normal de turno dentro de TURNOS (no cambia de fase, por eso no llega
    // como PhaseChanged) — reinicia el reloj de 30s para el nuevo jugador activo.
    startTimer(msg.data.codigo, 'TURNO', publishTick, publishEnd);
    log.info(`sala ${msg.data.codigo} → timer TURNO reiniciado (nuevo turno)`);
    return;
  }

  if (msg.type === 'PlayerDisconnectedFromRoom') {
    if (hasActiveTimer(msg.data.codigo)) {
      pauseTimer(msg.data.codigo);
      log.info(`sala ${msg.data.codigo} — timer pausado por desconexión`);
    }
    return;
  }

  if (msg.type === 'PlayerReconnected') {
    if (hasActiveTimer(msg.data.codigo)) {
      resumeTimer(msg.data.codigo);
      log.info(`sala ${msg.data.codigo} — timer reanudado por reconexión`);
    }
  }
}

// ── Kafka consumer ─────────────────────────────────────────────────────────────

const TOPICS = ['evt.room', 'evt.game'];

async function dispatch({ message }) {
  try {
    const msg = JSON.parse(message.value.toString());
    handleMessage(msg);
  } catch (err) {
    log.error('error procesando mensaje —', err.message);
  }
}

async function startConsumer() {
  // groupId único por proceso (no "timer-group" compartido): con groupId compartido, Kafka
  // reparte las particiones entre instancias y cada mensaje llega a UNA sola — que podría no
  // ser la que tiene el lease de líder en Redis, perdiendo el evento en silencio. Cada réplica
  // debe ver el stream completo; isLeader (arriba) decide cuál de ellas actúa.
  const consumer = createConsumer(`timer-${ME}`);
  await consumer.connect();
  await consumer.subscribe({ topics: TOPICS, fromBeginning: false });

  consumer.on(consumer.events.CRASH, async () => {
    log.warn('kafka consumer crasheó — reconectando en 5s...');
    setTimeout(async () => {
      try {
        await consumer.disconnect();
        await startConsumer();
      } catch (err) {
        log.error('error al reconectar consumer —', err.message);
      }
    }, 5000);
  });

  await consumer.run({ eachMessage: dispatch });
  log.info(`kafka consumer listo — ${TOPICS.join(', ')}`);
}

await startConsumer();
log.info(`${ME} — timer service iniciado`);
