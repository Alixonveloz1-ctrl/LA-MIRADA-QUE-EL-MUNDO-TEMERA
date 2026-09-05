// La copia local del estado. El bucket es la única verdad; esto es una copia.
//
// Todo lo que se ha aprobado —anclas, escenarios, keyframes, clips elegidos,
// audio, la cola y el gasto— vive en `estado.json` dentro del bucket del usuario
// (docs/contrato.md §5). Aquí se guarda una copia en memoria para pintar sin ir
// a la nube en cada repintado, y se escribe de vuelta con la generación que se
// leyó.
//
// POR QUÉ `cambiar(fn)` RECIBE UNA FUNCIÓN Y NO UN ESTADO. Dos pestañas abiertas,
// o dos trabajos de la cola terminando a la vez, escriben sobre la misma copia. Si
// se mandara el estado ya calculado, el segundo pisaría lo que hizo el primero: se
// aprobaría un keyframe y desaparecería un clip elegido sin que nadie lo notara.
// Mandando la FUNCIÓN, cuando el bucket contesta 409 se recarga el estado fresco
// —el que ya trae el cambio del otro— y se vuelve a APLICAR la función encima. El
// resultado calculado sobre el estado viejo se tira: no se reintenta la escritura,
// se rehace el cambio.
//
// POR QUÉ LAS ESCRITURAS VAN EN FILA. Si dos `cambiar()` salieran a la vez desde
// esta misma pestaña, los dos leerían la misma generación y uno de los dos se
// comería un 409 seguro. Se encolan: cuesta unos milisegundos y ahorra una carrera
// que además se resolvería mal.
//
// POR QUÉ AQUÍ SE FUNDEN LOS PESOS. La función mide cada respuesta y
// `app/api.js` se queda con el máximo por modo, pero eso vive en memoria y se
// pierde al cerrar el móvil. Cada vez que se escribe el estado se funden esas
// medidas en `estado.pesos`, quedándose con el máximo: sin una sola petición de
// más, la pantalla de Salud puede enseñar lo que ha llegado a pesar cada modo
// aunque la medida se tomara la semana pasada.

import { ErrorDeCara, llamar, pesos } from './api.js';

/** Cuántas veces se rehace el cambio ante un 409 antes de rendirse. */
const INTENTOS = 5;

/** La primera espera entre reintentos, en milisegundos. Después se dobla. */
const ESPERA_BASE = 150;

/** La copia en memoria. Null hasta el primer `cargar()`. */
let copia = null;

/** La generación de esa copia: con ella se escribe, y por ella salta el 409. */
let generacion = null;

/** Quién quiere enterarse de que el estado ha cambiado. */
const suscritos = new Set();

/** La cola de escrituras: cada `cambiar()` espera a que termine el anterior. */
let ultimaEscritura = Promise.resolve();

// ---------------------------------------------------------------------------
// Leer
// ---------------------------------------------------------------------------

/**
 * Trae el estado del bucket y lo deja como copia local.
 * @returns {Promise<object>} el estado recién traído
 */
export async function cargar() {
  const traido = await llamar('estado-leer');

  if (!traido || typeof traido.estado !== 'object' || traido.estado === null) {
    throw new ErrorDeCara(
      'El estado de la producción ha llegado del bucket con una forma que no se entiende. No se ' +
        'toca nada hasta saber qué pasa: ahí dentro está todo lo aprobado hasta ahora. Mira la ' +
        'pantalla de Salud para ver si el bucket se lee y se escribe bien.',
      { reintentable: false, http: 500 }
    );
  }

  copia = traido.estado;
  generacion = String(traido.generacion ?? '0');
  avisar();
  return copia;
}

/**
 * La copia en memoria. Nunca es null después de un `cargar()` que haya ido bien.
 * @returns {object}
 */
export function actual() {
  if (copia === null) {
    throw new ErrorDeCara(
      'Se ha pedido el estado de la producción antes de traerlo del bucket. Es un fallo del propio ' +
        'estudio, no de tu cuenta: una pantalla se ha pintado antes de tiempo. Recarga la página.',
      { reintentable: false, http: 500 }
    );
  }
  return copia;
}

// ---------------------------------------------------------------------------
// Escribir
// ---------------------------------------------------------------------------

/**
 * Aplica un cambio sobre el estado y lo guarda en el bucket.
 *
 * `fn` recibe una COPIA del estado y puede cambiarla a su gusto (o devolver un
 * estado nuevo, si le resulta más cómodo). Puede llamarse más de una vez: si
 * alguien más ha escrito mientras tanto, se vuelve a aplicar sobre el estado
 * fresco. Por eso `fn` tiene que ser un cambio, no un efecto: nada de lanzar
 * generaciones ni de cobrar nada dentro.
 *
 * @param {(estado:object) => (object|void|Promise<object|void>)} fn
 * @returns {Promise<object>} el estado ya guardado
 */
export async function cambiar(fn) {
  if (typeof fn !== 'function') {
    throw new ErrorDeCara(
      'Se ha intentado cambiar el estado de la producción sin decir qué cambiar. Es un fallo del ' +
        'propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  // En fila: el turno empieza cuando el anterior acaba, haya ido bien o mal.
  const turno = ultimaEscritura.then(() => aplicarYGuardar(fn), () => aplicarYGuardar(fn));
  ultimaEscritura = turno.then(
    () => undefined,
    () => undefined
  );
  return turno;
}

/**
 * El trabajo de verdad: aplicar, escribir, y ante un 409 rehacerlo sobre lo
 * fresco. Hasta `INTENTOS` veces, con la espera doblándose.
 * @param {Function} fn
 * @returns {Promise<object>}
 */
async function aplicarYGuardar(fn) {
  if (copia === null) await cargar();

  let ultimo = null;

  for (let intento = 1; intento <= INTENTOS; intento += 1) {
    const trabajo = clonar(copia);
    const devuelto = await fn(trabajo);
    const propuesta = devuelto && typeof devuelto === 'object' ? devuelto : trabajo;

    fundirPesos(propuesta);

    try {
      const guardado = await llamar('estado-escribir', { estado: propuesta, generacion });
      copia = propuesta;
      generacion = String(guardado.generacion ?? generacion);
      avisar();
      return copia;
    } catch (fallo) {
      if (!(fallo instanceof ErrorDeCara) || fallo.http !== 409) throw fallo;

      ultimo = fallo;
      await refrescarDesde(fallo);

      // El estado ya está fresco; solo se espera para no chocar otra vez de
      // frente con quien esté escribiendo al mismo ritmo desde otro sitio.
      if (intento < INTENTOS) await esperar(ESPERA_BASE * 2 ** (intento - 1));
    }
  }

  throw new ErrorDeCara(
    `Se ha intentado guardar el cambio ${INTENTOS} veces y cada vez había alguien más escribiendo el ` +
      'estado de la producción. No se ha perdido nada: el bucket sigue como estaba y tu cambio no se ' +
      'ha aplicado. Suele ser otra pestaña abierta con la misma herramienta; ciérrala y vuelve a ' +
      'intentarlo.',
    {
      detalle: ultimo ? ultimo.detalle : null,
      reintentable: true,
      http: 409
    }
  );
}

/**
 * Recoge el estado fresco que viaja dentro del 409. La función lo manda al lado
 * del error justamente para esto (docs/contrato.md §2): si no viniera, se pide.
 * @param {ErrorDeCara} fallo
 * @returns {Promise<void>}
 */
async function refrescarDesde(fallo) {
  const extra = fallo && typeof fallo.extra === 'object' && fallo.extra ? fallo.extra : null;

  if (extra && extra.estado && typeof extra.estado === 'object') {
    copia = extra.estado;
    generacion = String(extra.generacion ?? generacion);
    avisar();
    return;
  }

  // Sin acompañante no queda otra que ir a buscarlo. `cargar()` avisa por su
  // cuenta y deja la copia y la generación al día.
  await cargar();
}

/**
 * Funde en el estado lo que ha medido `app/api.js`, quedándose con el máximo por
 * modo. Nunca baja un número: el peso que interesa es el peor visto.
 * @param {object} estado
 */
function fundirPesos(estado) {
  const medidos = pesos();
  const nombres = Object.keys(medidos);
  if (!nombres.length) return;

  if (!estado.pesos || typeof estado.pesos !== 'object') estado.pesos = {};

  for (const modo of nombres) {
    const antes = Number(estado.pesos[modo]) || 0;
    const ahora = Number(medidos[modo]) || 0;
    if (ahora > antes) estado.pesos[modo] = ahora;
  }
}

// ---------------------------------------------------------------------------
// Avisar a las pantallas
// ---------------------------------------------------------------------------

/**
 * Apunta a alguien para que se entere de cada cambio del estado.
 * @param {(estado:object) => void} cb
 * @returns {() => void} llamarla desapunta
 */
export function alCambiar(cb) {
  if (typeof cb !== 'function') {
    throw new ErrorDeCara(
      'Se ha intentado escuchar los cambios del estado con algo que no es una función. Es un fallo ' +
        'del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }
  suscritos.add(cb);
  return () => {
    suscritos.delete(cb);
  };
}

/**
 * Avisa a todos. Una pantalla que se rompa al repintarse no puede impedir que
 * las demás se enteren, así que cada aviso va por su cuenta.
 */
function avisar() {
  if (copia === null) return;
  for (const cb of [...suscritos]) {
    try {
      cb(copia);
    } catch (fallo) {
      // Se cuenta por consola y se sigue: quien se rompió ya se enterará al
      // pintarse, y el resto de la aplicación no puede quedarse a medias por eso.
      console.error('Una pantalla ha fallado al repintarse', fallo);
    }
  }
}

// ---------------------------------------------------------------------------
// El gasto
// ---------------------------------------------------------------------------

/**
 * Suma gasto en el estado. No es un límite, es información: con 400 planos,
 * saber por dónde se va el dinero cambia decisiones (plan §8).
 *
 * Se llama SIEMPRE dentro de un `cambiar()`, sobre el estado que llega ahí:
 *
 *   await cambiar((e) => { anotarGasto(e, 'imagen', 'calidad', 1); });
 *
 * `imagen` y `video_s` se apuntan por nivel (`calidad`, `medio`, `economico`).
 * `musica_s` y `voz_s` son un número suelto y no llevan clave.
 *
 * @param {object} estado el estado que se está cambiando
 * @param {string} tipo `imagen` | `video_s` | `musica_s` | `voz_s`
 * @param {string|null} clave el nivel, cuando el tipo lo lleva
 * @param {number} cantidad imágenes, o segundos
 * @returns {number} el total acumulado después de sumar
 */
export function anotarGasto(estado, tipo, clave, cantidad) {
  if (!estado || typeof estado !== 'object') {
    throw new ErrorDeCara(
      'Se ha intentado apuntar un gasto fuera del estado de la producción. Es un fallo del propio ' +
        'estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  const nombre = String(tipo ?? '').trim();
  if (!nombre) {
    throw new ErrorDeCara(
      'Se ha intentado apuntar un gasto sin decir de qué. Es un fallo del propio estudio, no de tu ' +
        'cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  const cuanto = Number(cantidad);
  if (!Number.isFinite(cuanto)) {
    throw new ErrorDeCara(
      `Se ha intentado apuntar como gasto de «${nombre}» algo que no es un número. Es un fallo del ` +
        'propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  if (!estado.gasto || typeof estado.gasto !== 'object') estado.gasto = {};
  const gasto = estado.gasto;
  const rama = gasto[nombre];
  const nivel = clave == null ? '' : String(clave).trim();

  // Un número suelto: `musica_s`, `voz_s`. La clave sobra y se ignora.
  if (typeof rama === 'number' || (rama === undefined && !nivel)) {
    gasto[nombre] = (Number(rama) || 0) + cuanto;
    return gasto[nombre];
  }

  // Un reparto por niveles: `imagen`, `video_s`.
  if (rama === undefined || (rama && typeof rama === 'object' && !Array.isArray(rama))) {
    if (!nivel) {
      throw new ErrorDeCara(
        `El gasto de «${nombre}» se apunta por nivel (calidad, medio o económico) y no se ha dicho ` +
          'cuál. Es un fallo del propio estudio, no de tu cuenta.',
        { reintentable: false, http: 500 }
      );
    }
    const mapa = rama === undefined ? (gasto[nombre] = {}) : rama;
    mapa[nivel] = (Number(mapa[nivel]) || 0) + cuanto;
    return mapa[nivel];
  }

  throw new ErrorDeCara(
    `El gasto de «${nombre}» está guardado con una forma que no se entiende, así que no se suma nada ` +
      'para no estropearlo. Es un fallo del propio estudio, no de tu cuenta.',
    { reintentable: false, http: 500 }
  );
}

// ---------------------------------------------------------------------------
// Menudencias
// ---------------------------------------------------------------------------

/**
 * Una copia entera y suelta del estado. Se trabaja siempre sobre la copia: si el
 * cambio falla o hay que rehacerlo, la copia buena se queda intacta.
 * @param {object} valor
 * @returns {object}
 */
function clonar(valor) {
  if (typeof structuredClone === 'function') return structuredClone(valor);
  return JSON.parse(JSON.stringify(valor));
}

/**
 * Espera. Con un pellizco al azar para que dos pestañas que chocan no vuelvan a
 * chocar exactamente a la vez.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function esperar(ms) {
  const cuanto = Math.max(0, Number(ms) || 0) + Math.floor(Math.random() * 120);
  return new Promise((sigue) => setTimeout(sigue, cuanto));
}
