// Audio: la música de Lyria y las voces de Gemini TTS, con reproductor.
//
// La regla que gobierna esta pantalla entera está escrita en el plan §11 y en el
// contrato §9: **nada suena en un montaje sin haber sonado antes aquí**. De ahí
// sale todo lo que parece manía y no lo es:
//
//   1. NO HAY BOTÓN DE APROBAR SIN HABER OÍDO. Cada tarjeta trae su `<audio
//      controls>` con la pista entera, y el botón de aprobar aparece apagado —con
//      su motivo escrito— hasta que ese audio se ha reproducido en esta pantalla.
//      Aprobar de una lista, por el nombre del archivo, es exactamente lo que
//      esta pantalla existe para impedir.
//
//   2. LA UNIDAD DE LA VOZ ES EL BLOQUE, NO LA LÍNEA. Un bloque es una sola
//      llamada al modelo con todas sus líneas dentro y hasta dos hablantes, y es
//      la única defensa real contra la deriva de tono (plan §5, contrato §2). Por
//      eso el botón de rehacer es del bloque. La línea suelta tiene su botón,
//      sí —el usuario va a querer rehacer la línea que le suena mal, y un botón
//      que no existe no explica nada—, pero lo que hace es contarle por qué no se
//      hace así y ofrecerle rehacer el bloque entero.
//
//   3. LOS TIEMPOS SE MIDEN, NO SE ESTIMAN. El subtítulo español se quema con la
//      entrada y la salida REALES de cada intervención japonesa, medidas sobre el
//      audio ya generado. Por eso hay un botón de medir por bloque, y por eso
//      cuando un tramo sale repartido a ojo —el reconocimiento vuelve corto— la
//      tarjeta lo dice con palabras en vez de dar por bueno un número que nadie
//      ha medido.
//
//   4. UN BLOQUE DE UN PERSONAJE SIN VOZ ELEGIDA NO SE GENERA. Se dice quién es,
//      se dice dónde se elige y se pone el enlace a la pantalla de Voces al lado.
//      Generarlo igualmente saldría con la voz por defecto del modelo y habría
//      que pagarlo dos veces.
//
// POR QUÉ LOS BLOQUES SE ARMAN AQUÍ TAMBIÉN. Quien agrupa las líneas en bloques
// es la función (`bloquesDeVoz()` en api/_lib/datos.js), y el criterio está en el
// contrato §2: un bloque por personaje en una pieza corta, uno por escena en un
// episodio. Esta pantalla necesita la misma lista para poder pintar una tarjeta
// por bloque antes de haber generado nada, así que aplica el mismo criterio sobre
// los mismos datos. No es una segunda fuente: es la misma regla leída del mismo
// archivo, y si alguna vez dejaran de coincidir, la función se planta con su
// frase en español diciendo qué bloques hay de verdad.
//
// FALTA EN EL CONTRATO: docs/contrato.md §12 no da ningún módulo de datos para el
// navegador, y ya van tres archivos —app/cola.js, app/pantallas/voces.js y este—
// bajando datos/serie.json por su cuenta. Lo suyo sería un `app/datos.js`
// compartido con `bloquesDeVoz()` dentro. Que se revise.

import { ErrorDeCara, llamar } from '../api.js';
import { actual, alCambiar, cambiar } from '../estado.js';
import { encolar, encolarVarios } from '../cola.js';
import {
  aviso,
  barra,
  boton,
  confirmar,
  espera,
  filtro,
  h,
  pantalla,
  seccion,
  tarjeta,
  vaciar
} from '../ui.js';
import { plural, segundos } from '../formato.js';

// ---------------------------------------------------------------------------
// Números y palabras fijas de esta pantalla
// ---------------------------------------------------------------------------

/** Cuántas rutas caben en una sola llamada a `firmar` (docs/contrato.md §2). */
const MAXIMO_POR_FIRMA = 200;

/**
 * Cuánto se da por buena una URL firmada. La función las hace de seis horas y
 * aquí se tiran a las cinco, para que no caduque un enlace justo mientras se
 * está escuchando la pista que hay que juzgar.
 */
const VIDA_DE_URL_MS = 5 * 60 * 60 * 1000;

/**
 * Cuánto se espera, tras pausar un audio, antes de repintar con lo que haya
 * llegado mientras tanto. Repintar borra el `<audio>` y con él el punto donde se
 * había parado; esperar unos segundos deja volver atrás sin que se mueva nada.
 */
const ESPERA_TRAS_PAUSA_MS = 4000;

/** Cuántos caracteres del encargo de Lyria se enseñan sin desplegar. */
const LARGO_DEL_ENCARGO = 230;

/**
 * El fundido con el que se unen dos piezas de música seguidas en un episodio.
 * Está escrito en `episodios.musica` de datos/serie.json y en el plan §5: con
 * fundidos más cortos el relevo se oye como un tajo. Aquí solo se dice; quien lo
 * aplica es el montador.
 */
const FUNDIDO_ENTRE_PIEZAS_S = 2.5;

/** Los tres minutos de Lyria, si datos/serie.json no dijera otra cosa. */
const MAXIMO_DE_LYRIA_S = 180;

// ---------------------------------------------------------------------------
// Lo que esta pantalla recuerda mientras la aplicación está abierta
// ---------------------------------------------------------------------------

/** `datos/serie.json`, pedido una sola vez. */
let promesaDeLaSerie = null;

/** Ruta lógica → `{ url, hasta }`. Las URL firmadas se reaprovechan. */
const enlaces = new Map();

/** Rutas por las que ya se preguntó y no hay enlace: no se insiste solo. */
const sinEnlace = new Set();

/** Si hay una petición de firmas en marcha ahora mismo. */
let pidiendoEnlaces = false;

/** Por qué no se han podido conseguir los enlaces, si es que no se han podido. */
let quejaDeEnlaces = null;

/** El último fallo de una acción de esta pantalla, para pintarlo arriba. */
let queja = null;

/** Las rutas que se han llegado a reproducir aquí. Sin esto no se aprueba nada. */
const oidos = new Set();

/** Los audios que están sonando ahora mismo: mientras haya uno, no se repinta. */
const sonando = new Set();

/** Si ha llegado un cambio del estado mientras sonaba algo. */
let repintadoPendiente = false;

/** El reloj del repintado diferido. */
let relojDeRepintado = null;

/** Qué bloques se están midiendo ahora mismo: `«pieza/bloque»`. */
const midiendo = new Set();

/**
 * Lo que hay que hacer cuando un audio se pausa o se acaba. Lo pone `montar()` y
 * lo llaman los reproductores; fuera de un montaje vale null.
 * @type {(() => void)|null}
 */
let alSoltarUnAudio = null;

/** Para el reloj del repintado diferido, si estaba puesto. */
function pararElReloj() {
  if (relojDeRepintado) {
    clearTimeout(relojDeRepintado);
    relojDeRepintado = null;
  }
}

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

export default {
  id: 'audio',
  titulo: 'Audio',
  icono: '\u{1F3A7}',

  /**
   * Pinta la música y las voces de la pieza activa dentro de `raiz` y se queda
   * escuchando el estado.
   * @param {HTMLElement} raiz
   * @returns {Promise<() => void>} cómo desapuntarse al cambiar de pestaña
   */
  async montar(raiz) {
    const marco = h('div', { clase: 'audio' });
    raiz.appendChild(marco);

    /** Cómo desapuntarse de lo que esté montado ahora mismo. */
    let soltar = null;

    const arrancar = async () => {
      if (typeof soltar === 'function') soltar();
      soltar = null;
      vaciar(marco);

      marco.appendChild(espera('Trayendo la música y las líneas de la pieza…'));

      let serie;
      try {
        serie = await laSerie();
      } catch (fallo) {
        const error = comoErrorDeCara(fallo);
        vaciar(marco);
        marco.appendChild(
          pantalla(
            'Audio',
            seccion(
              null,
              aviso(error.mensaje, { tono: 'error', detalle: error.detalle }),
              h(
                'div',
                { clase: 'tarjeta-acciones' },
                boton(
                  'Volver a intentarlo',
                  () => {
                    promesaDeLaSerie = null;
                    arrancar();
                  },
                  { tono: 'principal' }
                )
              )
            )
          )
        );
        return;
      }

      /**
       * El repintado de verdad, el que se hace cuando el usuario toca algo.
       *
       * Rehacer la pantalla se lleva por delante los `<audio>` que hubiera, así
       * que lo primero es olvidarse de los que estuvieran sonando: esos nodos ya
       * no existen y nunca van a avisar de que se han pausado.
       */
      const repintar = () => {
        sonando.clear();
        repintadoPendiente = false;
        pararElReloj();
        vaciar(marco);
        marco.appendChild(construir(serie, repintar, pedirRepintado));
      };

      /**
       * El repintado que espera a que termine lo que se está escuchando. Por
       * aquí pasa solo lo que NO ha pedido el usuario: los cambios de estado que
       * escribe la cola y la llegada de las URL firmadas. Cortar una pista a
       * mitad mientras se está juzgando es lo único que esta pantalla no puede
       * hacer.
       */
      const pedirRepintado = () => {
        if (sonando.size) {
          repintadoPendiente = true;
          return;
        }
        repintar();
      };

      alSoltarUnAudio = () => {
        if (!repintadoPendiente || sonando.size) return;
        pararElReloj();
        relojDeRepintado = setTimeout(() => {
          relojDeRepintado = null;
          if (!sonando.size && repintadoPendiente) pedirRepintado();
        }, ESPERA_TRAS_PAUSA_MS);
      };

      const desapuntar = alCambiar(pedirRepintado);
      soltar = () => {
        desapuntar();
        sonando.clear();
        repintadoPendiente = false;
        pararElReloj();
        alSoltarUnAudio = null;
      };

      vaciar(marco);
      repintar();
    };

    await arrancar();

    return () => {
      if (typeof soltar === 'function') soltar();
      soltar = null;
    };
  }
};

// ---------------------------------------------------------------------------
// datos/serie.json, del lado del navegador
// ---------------------------------------------------------------------------

/**
 * `datos/serie.json`, bajado una vez y guardado. De ahí salen los encargos de
 * Lyria, las líneas de cada pieza y el reparto de voces.
 * @returns {Promise<object>}
 */
function laSerie() {
  if (!promesaDeLaSerie) {
    promesaDeLaSerie = bajarLaSerie().catch((fallo) => {
      // Una caída de red no puede dejar la pantalla sin datos para siempre.
      promesaDeLaSerie = null;
      throw fallo;
    });
  }
  return promesaDeLaSerie;
}

/**
 * Baja el archivo. La dirección se calcula desde la de este módulo, así que da
 * igual si la aplicación cuelga de la raíz o de una subcarpeta.
 * @returns {Promise<object>}
 */
async function bajarLaSerie() {
  const direccion = new URL('../../datos/serie.json', import.meta.url).href;

  let respuesta;
  try {
    respuesta = await fetch(direccion, { cache: 'no-cache' });
  } catch (fallo) {
    throw new ErrorDeCara(
      'No se ha podido leer datos/serie.json, que es donde están escritos los encargos de música y ' +
        'las líneas de voz de cada pieza. Sin él esta pantalla no tiene nada que enseñar. Comprueba ' +
        'la conexión del teléfono; si tienes cobertura, es que el despliegue está a medias.',
      { detalle: loQueDijo(fallo), reintentable: true, http: 0 }
    );
  }

  if (!respuesta.ok) {
    throw new ErrorDeCara(
      `No se ha podido leer datos/serie.json: el servidor ha contestado con un ${respuesta.status}. ` +
        'Ese archivo va dentro del repositorio, así que si no está es que el despliegue no ha subido ' +
        'entero.',
      {
        detalle: `HTTP ${respuesta.status}`,
        reintentable: respuesta.status >= 500,
        http: respuesta.status
      }
    );
  }

  try {
    return await respuesta.json();
  } catch (fallo) {
    throw new ErrorDeCara(
      'datos/serie.json se ha bajado pero no se entiende: no es un JSON válido. Es un fallo del ' +
        'propio estudio, no de tu cuenta.',
      { detalle: loQueDijo(fallo), reintentable: false, http: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// El estado
// ---------------------------------------------------------------------------

/** El estado, o uno vacío si todavía no ha llegado del bucket. */
function leerEstado() {
  try {
    return actual() || {};
  } catch {
    return { audio: { musica: {}, voz: {} }, voces: {}, cola: [], pieza_activa: null };
  }
}

/** Lo guardado de una pieza de música, con la forma del contrato §5. */
function musicaGuardada(estado, idMusica) {
  const audio = esObjeto(estado.audio) ? estado.audio : {};
  const mapa = esObjeto(audio.musica) ? audio.musica : {};
  const entrada = esObjeto(mapa[idMusica]) ? mapa[idMusica] : {};
  return {
    ruta: rutaSiVale(entrada.ruta),
    durS: numeroSiVale(entrada.dur_s),
    aprobada: entrada.aprobada === true,
    intentos: soloRutas(entrada.intentos)
  };
}

/** Lo guardado de un bloque de voz, con la forma del contrato §5. */
function vozGuardada(estado, clave) {
  const audio = esObjeto(estado.audio) ? estado.audio : {};
  const mapa = esObjeto(audio.voz) ? audio.voz : {};
  const entrada = esObjeto(mapa[clave]) ? mapa[clave] : {};
  const lineas = Array.isArray(entrada.lineas) ? entrada.lineas : [];
  return {
    ruta: rutaSiVale(entrada.ruta),
    durS: numeroSiVale(entrada.dur_s),
    aprobada: entrada.aprobada === true,
    intentos: soloRutas(entrada.intentos),
    tramos: lineas.map((tramo) => ({
      inicio: Number(tramo && tramo.inicio) || 0,
      fin: Number(tramo && tramo.fin) || 0,
      // `estimado` solo viene cuando la medida se ha pedido desde aquí: la cola
      // guarda únicamente inicio y fin. Sin el campo no se sabe, y eso también
      // se dice con palabras en vez de darlo por medido.
      estimado:
        tramo && typeof tramo.estimado === 'boolean' ? tramo.estimado : null
    }))
  };
}

/** La entrada de música dentro del estado que se cambia, creada si no estaba. */
function entradaDeMusica(estado, idMusica) {
  if (!esObjeto(estado.audio)) estado.audio = { musica: {}, voz: {} };
  if (!esObjeto(estado.audio.musica)) estado.audio.musica = {};
  if (!esObjeto(estado.audio.musica[idMusica])) {
    estado.audio.musica[idMusica] = { ruta: null, dur_s: 0, aprobada: false, intentos: [] };
  }
  return estado.audio.musica[idMusica];
}

/** La entrada de un bloque de voz dentro del estado que se cambia. */
function entradaDeVoz(estado, clave) {
  if (!esObjeto(estado.audio)) estado.audio = { musica: {}, voz: {} };
  if (!esObjeto(estado.audio.voz)) estado.audio.voz = {};
  if (!esObjeto(estado.audio.voz[clave])) {
    estado.audio.voz[clave] = { ruta: null, dur_s: 0, aprobada: false, lineas: [], intentos: [] };
  }
  return estado.audio.voz[clave];
}

/** La voz elegida de un personaje en la pantalla de Voces, o null. */
function vozElegidaDe(estado, idPersonaje) {
  const voces = esObjeto(estado.voces) ? estado.voces : {};
  const entrada = esObjeto(voces[idPersonaje]) ? voces[idPersonaje] : {};
  return rutaSiVale(entrada.voz_id);
}

/**
 * Qué está haciendo la cola con cada pieza de música y con cada bloque, para
 * poder pintar «generando» y, sobre todo, POR QUÉ falló lo que falló sin tener
 * que cambiar de pestaña.
 * @param {object} estado
 * @returns {Map<string, {estado:string, error:string|null, detalle:string|null}>}
 */
function indexarCola(estado) {
  const indice = new Map();
  const cola = Array.isArray(estado.cola) ? estado.cola : [];

  for (const trabajo of cola) {
    if (!trabajo) continue;
    const tipo = String(trabajo.tipo || '');
    if (tipo !== 'musica' && tipo !== 'voz' && tipo !== 'alinear') continue;

    const args = esObjeto(trabajo.args) ? trabajo.args : {};
    const pieza = soloTexto(args.pieza);
    if (!pieza) continue;

    const cual = tipo === 'musica' ? soloTexto(args.id) : soloTexto(args.bloque);
    if (!cual) continue;

    const familia = tipo === 'alinear' ? 'alinear' : tipo;
    const clave = `${familia}:${pieza}/${cual}`;
    const anterior = indice.get(clave);
    // De un trabajo revivido solo interesa lo último que le ha pasado.
    if (anterior && mandaSobre(anterior.estado, trabajo.estado)) continue;

    indice.set(clave, {
      estado: String(trabajo.estado || ''),
      error: soloTexto(trabajo.error) || null,
      detalle: soloTexto(trabajo.detalle) || null
    });
  }

  return indice;
}

/** Cuál de dos estados de trabajo manda cuando hay dos para lo mismo. */
function mandaSobre(anterior, nuevo) {
  const peso = { en_curso: 4, pendiente: 3, fallido: 2, detenido: 1, hecho: 0 };
  return (peso[anterior] ?? 0) >= (peso[String(nuevo || '')] ?? 0);
}

/** Si la cola está haciendo algo con esto ahora mismo. */
function estaEnMarcha(trabajo) {
  return Boolean(trabajo && (trabajo.estado === 'en_curso' || trabajo.estado === 'pendiente'));
}

// ---------------------------------------------------------------------------
// Las piezas, la música y los bloques
// ---------------------------------------------------------------------------

/** Todas las piezas escritas en datos/serie.json, con su id y su título. */
function piezasDeLaSerie(serie) {
  const piezas = esObjeto(serie.piezas) ? serie.piezas : {};
  return Object.keys(piezas)
    .filter((id) => esObjeto(piezas[id]))
    .map((id) => ({
      id,
      titulo: soloTexto(piezas[id].titulo) || id,
      datos: piezas[id]
    }));
}

/** La pieza que se está produciendo: la del estado, o la primera de la serie. */
function piezaActiva(serie, estado) {
  const todas = piezasDeLaSerie(serie);
  const dicha = soloTexto(estado.pieza_activa);
  return todas.find((una) => una.id === dicha) || todas[0] || null;
}

/**
 * Las piezas de música de una pieza de la serie.
 *
 * FALTA EN EL CONTRATO: `musica.piezas` de datos/serie.json es una lista global y
 * ninguna entrada dice a qué pieza pertenece; lo único que las relaciona es el id
 * («teaser-lecho», «teaser-canto»). Así que aquí se emparejan por ese prefijo, y
 * si no hay ninguna que empiece por el id de la pieza se dice con palabras en vez
 * de colgarle a un episodio la música del teaser. Conviene añadir un campo
 * `pieza` a cada entrada de `musica.piezas`.
 *
 * @param {object} serie
 * @param {string} idPieza
 * @param {number} cuantasPiezas cuántas piezas tiene la serie en total
 * @returns {{lista:object[], porPrefijo:boolean}}
 */
function musicaDeLaPieza(serie, idPieza, cuantasPiezas) {
  const musica = esObjeto(serie.musica) ? serie.musica : {};
  const todas = (Array.isArray(musica.piezas) ? musica.piezas : []).filter(
    (una) => esObjeto(una) && soloTexto(una.id)
  );

  const suyas = todas.filter(
    (una) => una.id === idPieza || String(una.id).startsWith(`${idPieza}-`)
  );
  if (suyas.length) return { lista: suyas, porPrefijo: true };

  // Con una sola pieza en toda la serie no hay ambigüedad posible: la música que
  // haya escrita es la suya, se llame como se llame.
  if (cuantasPiezas === 1) return { lista: todas, porPrefijo: false };

  return { lista: [], porPrefijo: true };
}

/** El máximo que admite Lyria por pieza, tal como está escrito en la serie. */
function maximoDeLyria(serie) {
  const musica = esObjeto(serie.musica) ? serie.musica : {};
  const modelo = esObjeto(musica.modelo) ? musica.modelo : {};
  const dicho = Number(modelo.maximo_s);
  return Number.isFinite(dicho) && dicho > 0 ? dicho : MAXIMO_DE_LYRIA_S;
}

/**
 * Las líneas de voz de una pieza, en orden y limpias.
 * @param {object} pieza la entrada de `piezas` de datos/serie.json
 * @returns {{quien:string, ja:string, es:string, t:number, hasta:number, intencion:string|null}[]}
 */
export function lineasDeVoz(pieza) {
  const audio = esObjeto(pieza.audio) ? pieza.audio : {};
  const lineas = Array.isArray(audio.voz) ? audio.voz : [];

  return lineas
    .filter((linea) => esObjeto(linea) && soloTexto(linea.quien))
    .map((linea) => ({
      quien: soloTexto(linea.quien),
      ja: soloTexto(linea.ja),
      es: soloTexto(linea.es),
      t: Number(linea.t),
      hasta: Number(linea.hasta),
      escena: linea.escena === undefined || linea.escena === null ? null : String(linea.escena),
      intencion: soloTexto(linea.intencion) || null
    }))
    .filter((linea) => Number.isFinite(linea.t) && Number.isFinite(linea.hasta))
    .sort((a, b) => a.t - b.t);
}

/**
 * Agrupa las líneas de una pieza en bloques, con el mismo criterio que
 * `bloquesDeVoz()` de api/_lib/datos.js (docs/contrato.md §2):
 *
 *   · Pieza corta —la que no tiene tomas con escena, como el teaser—: un bloque
 *     por personaje, con sus líneas en orden. El id es el nombre del personaje.
 *   · Pieza de episodio: un bloque por escena; si en la escena hablan más de dos,
 *     se parte en bloques consecutivos de como mucho dos hablantes, sin
 *     desordenar las líneas. El id es «esc-{n}», y «esc-{n}-{k}» al partirse.
 *
 * @param {object} pieza
 * @returns {{id:string, personajes:string[], lineas:object[], escena:string|null}[]}
 */
export function bloquesDeVoz(pieza) {
  const lineas = lineasDeVoz(pieza);
  if (!lineas.length) return [];

  const tomas = Array.isArray(pieza.tomas) ? pieza.tomas : [];
  const conEscena = tomas.filter(
    (una) => esObjeto(una) && una.escena !== undefined && una.escena !== null
  );

  if (!conEscena.length) {
    const porPersonaje = new Map();
    for (const linea of lineas) {
      if (!porPersonaje.has(linea.quien)) porPersonaje.set(linea.quien, []);
      porPersonaje.get(linea.quien).push(linea);
    }
    return [...porPersonaje.entries()].map(([quien, suyas]) => ({
      id: quien,
      personajes: [quien],
      lineas: suyas,
      escena: null
    }));
  }

  const escenas = new Map();
  for (const linea of lineas) {
    const escena = escenaDeLinea(linea, conEscena);
    if (!escenas.has(escena)) escenas.set(escena, { escena, lineas: [] });
    escenas.get(escena).lineas.push(linea);
  }

  const bloques = [];
  for (const grupo of escenas.values()) {
    const trozos = [];
    let actual = null;
    for (const linea of grupo.lineas) {
      const yaEstaba = actual && actual.personajes.includes(linea.quien);
      const cabe = actual && (yaEstaba || actual.personajes.length < 2);
      if (!cabe) {
        actual = { personajes: [], lineas: [] };
        trozos.push(actual);
      }
      if (!actual.personajes.includes(linea.quien)) actual.personajes.push(linea.quien);
      actual.lineas.push(linea);
    }
    trozos.forEach((trozo, i) => {
      bloques.push({
        id: trozos.length === 1 ? `esc-${grupo.escena}` : `esc-${grupo.escena}-${i + 1}`,
        personajes: trozo.personajes,
        lineas: trozo.lineas,
        escena: grupo.escena
      });
    });
  }
  return bloques;
}

/** En qué escena cae una línea: la que dice, o la de la toma que está en pantalla. */
function escenaDeLinea(linea, tomas) {
  if (linea.escena !== null) return linea.escena;

  let ultima = null;
  for (const toma of tomas) {
    const inicio = Number(toma.inicio);
    const dur = Number(toma.dur);
    if (!Number.isFinite(inicio)) continue;
    if (linea.t >= inicio && linea.t < inicio + (Number.isFinite(dur) ? dur : 0)) {
      return String(toma.escena);
    }
    if (linea.t >= inicio) ultima = toma;
  }
  if (ultima) return String(ultima.escena);
  return tomas.length ? String(tomas[0].escena) : '';
}

/** Cómo se llama un personaje en pantalla. */
function nombreDePersonaje(serie, id) {
  const personajes = esObjeto(serie.personajes) ? serie.personajes : {};
  const ficha = esObjeto(personajes[id]) ? personajes[id] : null;
  const nombre = ficha ? soloTexto(ficha.nombre) : '';
  if (nombre) return nombre;
  return primeraMayuscula(String(id).replace(/-/g, ' '));
}

/** La intención con la que se eligió la voz de un personaje, si la tiene escrita. */
function intencionDeLaMuestra(serie, id) {
  const voces = esObjeto(serie.voces) ? serie.voces : {};
  const reparto = Array.isArray(voces.reparto) ? voces.reparto : [];
  const ficha = reparto.find((una) => esObjeto(una) && una.personaje === id);
  const muestra = ficha && esObjeto(ficha.muestra) ? ficha.muestra : null;
  return muestra ? soloTexto(muestra.intencion) || null : null;
}

// ---------------------------------------------------------------------------
// Las URL firmadas
// ---------------------------------------------------------------------------

/** El enlace de una ruta, si lo hay y todavía sirve. */
function enlaceDe(ruta) {
  const guardado = enlaces.get(ruta);
  if (!guardado) return null;
  if (guardado.hasta <= Date.now()) {
    enlaces.delete(ruta);
    return null;
  }
  return guardado.url;
}

/**
 * Pide de una vez los enlaces que falten, en lotes de 200 —el tope de `firmar`—,
 * y repinta cuando los tenga. Una pantalla de audio no puede ser una petición de
 * firma por pista.
 * @param {string[]} rutas
 * @param {() => void} repintar
 */
function pedirEnlacesQueFalten(rutas, repintar) {
  if (pidiendoEnlaces) return;

  const faltan = [...new Set(rutas)].filter((ruta) => !enlaceDe(ruta) && !sinEnlace.has(ruta));
  if (!faltan.length) return;

  pidiendoEnlaces = true;
  quejaDeEnlaces = null;

  (async () => {
    for (let i = 0; i < faltan.length; i += MAXIMO_POR_FIRMA) {
      const lote = faltan.slice(i, i + MAXIMO_POR_FIRMA);
      const respuesta = await llamar('firmar', { rutas: lote });
      const dadas = esObjeto(respuesta) && esObjeto(respuesta.urls) ? respuesta.urls : {};
      for (const ruta of lote) {
        const url = dadas[ruta];
        if (typeof url === 'string' && url) {
          enlaces.set(ruta, { url, hasta: Date.now() + VIDA_DE_URL_MS });
        } else {
          sinEnlace.add(ruta);
        }
      }
    }
  })()
    .catch((fallo) => {
      quejaDeEnlaces = comoErrorDeCara(fallo);
      for (const ruta of faltan) if (!enlaceDe(ruta)) sinEnlace.add(ruta);
    })
    .finally(() => {
      pidiendoEnlaces = false;
      repintar();
    });
}

/** Tira todos los enlaces guardados y vuelve a pedirlos. */
function olvidarEnlaces(repintar) {
  enlaces.clear();
  sinEnlace.clear();
  quejaDeEnlaces = null;
  repintar();
}

// ---------------------------------------------------------------------------
// La pantalla entera
// ---------------------------------------------------------------------------

/**
 * @param {object} serie
 * @param {() => void} repintar el repintado inmediato: lo que toca el usuario
 * @param {() => void} repintarLuego el que espera a que acabe lo que suena
 * @returns {HTMLElement}
 */
function construir(serie, repintar, repintarLuego) {
  const estado = leerEstado();
  const pieza = piezaActiva(serie, estado);

  if (!pieza) {
    return pantalla(
      'Audio',
      seccion(
        null,
        aviso(
          'No hay ninguna pieza en datos/serie.json, así que no hay música ni voces que generar. El ' +
            'teaser viene escrito en el repositorio, de modo que si falta es que el despliegue subió ' +
            'a medias.',
          { tono: 'error' }
        )
      )
    );
  }

  const todas = piezasDeLaSerie(serie);
  const musica = musicaDeLaPieza(serie, pieza.id, todas.length);
  const bloques = bloquesDeVoz(pieza.datos);

  const ctx = {
    serie,
    estado,
    pieza,
    todas,
    musica,
    bloques,
    trabajos: indexarCola(estado),
    repintar,
    repintarLuego
  };

  // Las firmas llegan solas, sin que nadie las pida a mano, y su repintado es de
  // los que esperan a que termine lo que se esté escuchando.
  const rutas = [];
  for (const una of musica.lista) {
    const guardado = musicaGuardada(estado, una.id);
    if (guardado.ruta) rutas.push(guardado.ruta);
  }
  for (const bloque of bloques) {
    const guardado = vozGuardada(estado, `${pieza.id}/${bloque.id}`);
    if (guardado.ruta) rutas.push(guardado.ruta);
  }
  pedirEnlacesQueFalten(rutas, repintarLuego);

  return pantalla(
    'Audio',
    seccionCabecera(ctx),
    seccionMusica(ctx),
    seccionVoces(ctx)
  );
}

// ---------------------------------------------------------------------------
// La cabecera
// ---------------------------------------------------------------------------

/**
 * Lo de arriba: la pieza que se está produciendo, la regla de la pantalla y los
 * fallos que haya que contar.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionCabecera(ctx) {
  const { pieza, todas, repintar } = ctx;
  const partes = [];

  if (queja) {
    partes.push(
      aviso(queja.mensaje, { tono: 'error', detalle: queja.detalle }),
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton('Quitar este aviso', () => {
          queja = null;
          repintar();
        })
      )
    );
  }

  if (quejaDeEnlaces) {
    partes.push(
      aviso(
        `${quejaDeEnlaces.mensaje} Sin esos enlaces no se puede oír nada, y aquí no se aprueba nada ` +
          'sin haberlo oído.',
        { tono: 'error', detalle: quejaDeEnlaces.detalle }
      ),
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton('Volver a pedir los enlaces', () => olvidarEnlaces(repintar), { tono: 'principal' })
      )
    );
  }

  partes.push(
    h(
      'p',
      { clase: 'tarjeta-texto suave' },
      todas.length > 1
        ? 'Pieza que se está produciendo. Todo lo de abajo es de la pieza puesta.'
        : `Pieza que se está produciendo: ${pieza.titulo}. Cuando se desglose un episodio aparecerá ` +
          'aquí al lado, con esta misma pantalla.'
    )
  );

  if (todas.length > 1) {
    partes.push(
      filtro(
        todas.map((una) => ({ id: una.id, texto: una.titulo })),
        pieza.id,
        (id) => cambiarDePieza(id, ctx)
      )
    );
  }

  partes.push(
    h(
      'p',
      { clase: 'tenue' },
      'Nada suena en un montaje sin haber sonado antes aquí: hasta que una pista no se ha ' +
        'reproducido en esta pantalla, su botón de aprobar está apagado. Lo aprobado es lo único ' +
        'que la pantalla de Montaje deja mezclar.'
    )
  );

  return seccion(null, partes);
}

/**
 * Cambia la pieza activa. Se guarda en el bucket para que al volver a abrir siga
 * puesta la misma en todas las pantallas.
 * @param {string} id
 * @param {object} ctx
 */
function cambiarDePieza(id, ctx) {
  cambiar((borrador) => {
    borrador.pieza_activa = id;
  }).catch((fallo) => {
    queja = comoErrorDeCara(fallo);
    ctx.repintar();
  });
}

// ---------------------------------------------------------------------------
// Música
// ---------------------------------------------------------------------------

/**
 * La sección de música: una tarjeta por pieza de Lyria, con su encargo resumido,
 * su duración pedida, su duración real y su reproductor.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionMusica(ctx) {
  const { serie, estado, pieza, musica } = ctx;
  const partes = [];
  const maximo = maximoDeLyria(serie);

  partes.push(
    h(
      'p',
      { clase: 'suave' },
      `Lyria no pasa de ${segundos(maximo)} por pieza, así que un episodio de veintidós minutos no ` +
        'es una pieza larga: son varias, una por acto o por bloque, que el montador une con ' +
        `fundidos de ${segundos(FUNDIDO_ENTRE_PIEZAS_S)}. Los fundidos más cortos suenan a tajo.`
    ),
    h(
      'p',
      { clase: 'tenue' },
      'El lecho instrumental y el canto van como piezas separadas a propósito: solo así se puede ' +
        'colocar el canto en su segundo exacto y mezclarlo a su propio nivel. Y el encargo va en ' +
        'inglés porque Lyria rechaza la petición entera en cualquier otro idioma.'
    )
  );

  if (!musica.lista.length) {
    partes.push(
      aviso(
        `No hay ninguna pieza de música escrita para «${pieza.id}». En datos/serie.json la música ` +
          'vive en «musica.piezas», y lo único que une una pieza de música con una pieza de la ' +
          `serie es su id: las de esta se llamarían «${pieza.id}-lecho», «${pieza.id}-canto» o ` +
          `cualquier otro nombre que empiece por «${pieza.id}-».`,
        { tono: 'nota' }
      )
    );
    return seccion('Música', partes);
  }

  if (!musica.porPrefijo) {
    partes.push(
      aviso(
        'Ninguna pieza de música lleva el id de esta pieza por delante, pero como en toda la serie ' +
          'solo hay una pieza, la música escrita es la suya. En cuanto se desglose un episodio hará ' +
          `falta que cada entrada de «musica.piezas» empiece por el id de su pieza.`,
        { tono: 'nota' }
      )
    );
  }

  const aprobadas = musica.lista.filter((una) => musicaGuardada(estado, una.id).aprobada).length;
  partes.push(barra(aprobadas, musica.lista.length, { etiqueta: 'Música aprobada' }));

  for (const una of musica.lista) partes.push(tarjetaDeMusica(ctx, una, maximo));

  return seccion('Música', partes);
}

/**
 * Una pieza de Lyria: lo que se le pidió, lo que ha salido, y el reproductor.
 * @param {object} ctx
 * @param {object} laMusica la entrada de `musica.piezas`
 * @param {number} maximo el tope de Lyria en segundos
 * @returns {HTMLElement}
 */
function tarjetaDeMusica(ctx, laMusica, maximo) {
  const { estado, pieza, trabajos, repintar } = ctx;
  const id = String(laMusica.id);
  const guardado = musicaGuardada(estado, id);
  const enLaCola = trabajos.get(`musica:${pieza.id}/${id}`) || null;
  const trabajando = estaEnMarcha(enLaCola);

  const pedida = Number(laMusica.duracion_s);
  const url = guardado.ruta ? enlaceDe(guardado.ruta) : null;

  const notaDelEnlace = h('p', {
    clase: 'tenue',
    estilo: { margin: '4px 0 0', 'font-size': '12px' }
  });

  const acciones = h('div', { clase: 'tarjeta-acciones' });

  /** Repinta solo los botones: rehacer la tarjeta cortaría lo que esté sonando. */
  const pintarAcciones = () => {
    vaciar(acciones);

    if (trabajando) {
      acciones.appendChild(
        boton('Generando…', () => {}, {
          desactivado: 'Lyria ya está componiendo esta pieza. Se paga una vez.'
        })
      );
    } else {
      acciones.appendChild(
        boton(
          guardado.ruta ? 'Rehacer esta pieza' : 'Generar esta pieza',
          () => generarMusica(ctx, laMusica),
          { tono: guardado.ruta ? 'suave' : 'principal' }
        )
      );
    }

    if (guardado.aprobada) {
      acciones.appendChild(
        boton('Quitar el visto bueno', () => aprobarMusica(ctx, id, false), { tono: 'suave' })
      );
    } else {
      acciones.appendChild(
        boton('Aprobar', () => aprobarMusica(ctx, id, true), {
          tono: 'principal',
          desactivado: motivoParaNoAprobar(guardado.ruta, url, oidos.has(guardado.ruta || ''))
        })
      );
    }
  };

  pintarAcciones();

  const media = url
    ? reproductor(guardado.ruta, url, `Música: ${id}`, notaDelEnlace, pintarAcciones)
    : null;

  const pie = h('div', null);

  pie.appendChild(
    h(
      'p',
      { clase: 'suave', estilo: { margin: '0' } },
      `Pista: ${soloTexto(laMusica.pista) || 'sin decir'} · pedida ${segundos(pedida)} · `,
      h(
        'span',
        { clase: 'numero' },
        guardado.durS === null
          ? 'todavía sin generar'
          : `salida ${segundos(guardado.durS)}`
      )
    )
  );

  if (Number.isFinite(pedida) && pedida > maximo) {
    pie.appendChild(
      aviso(
        `Esta pieza pide ${segundos(pedida)} y Lyria no pasa de ${segundos(maximo)}: la petición se ` +
          'rechazaría entera. Hay que partirla en varias piezas más cortas en «musica.piezas» de ' +
          'datos/serie.json y unirlas en el montaje con fundidos.',
        { tono: 'error' }
      )
    );
  } else if (guardado.durS !== null && Number.isFinite(pedida) && Math.abs(guardado.durS - pedida) > 1) {
    pie.appendChild(
      h(
        'p',
        { clase: 'tenue', estilo: { margin: '4px 0 0', 'font-size': '13px' } },
        `Se pidieron ${segundos(pedida)} y han salido ${segundos(guardado.durS)}. En el montaje ` +
          'manda la duración real, que es la que se mide del archivo: los segundos escritos son lo ' +
          'que se encargó, no lo que se ha recibido.'
      )
    );
  }

  pie.appendChild(notaDelEnlace);
  pie.appendChild(pintarElEncargo(laMusica));

  if (soloTexto(laMusica.nota)) {
    pie.appendChild(
      h(
        'p',
        { clase: 'tenue', estilo: { margin: '8px 0 0', 'font-size': '13px' } },
        soloTexto(laMusica.nota)
      )
    );
  }

  if (guardado.intentos.length > 1) {
    pie.appendChild(
      h(
        'p',
        { clase: 'tenue', estilo: { margin: '8px 0 0', 'font-size': '12px' } },
        `${plural(guardado.intentos.length, 'versión generada', 'versiones generadas')}. La que ` +
          'suena es la última: rehacerla vuelve a escribir encima de la misma ruta.'
      )
    );
  }

  if (!guardado.ruta && !trabajando) {
    pie.appendChild(
      h(
        'p',
        { clase: 'tenue', estilo: { margin: '8px 0 0', 'font-size': '13px' } },
        'Todavía no se ha generado. En cuanto esté, aparece aquí el reproductor con la pista entera ' +
          'y se puede aprobar.'
      )
    );
  }

  if (enLaCola && enLaCola.error) {
    pie.appendChild(aviso(enLaCola.error, { tono: 'error', detalle: enLaCola.detalle }));
  }

  if (trabajando) pie.appendChild(espera('Lyria está componiendo esta pieza…'));

  return tarjeta({
    titulo: id,
    media,
    estado: estadoDeMusica(guardado, trabajando),
    pie,
    acciones
  });
}

/** El punto de estado de una pieza de música. */
function estadoDeMusica(guardado, trabajando) {
  if (trabajando) return { tipo: 'generando', texto: 'Componiéndose' };
  if (!guardado.ruta) return { tipo: 'pendiente', texto: 'Sin generar' };
  if (guardado.aprobada) return { tipo: 'aprobada', texto: 'Aprobada' };
  return { tipo: 'por-aprobar', texto: 'Por aprobar' };
}

/**
 * El encargo que se le manda a Lyria, resumido, y entero si se despliega. Va en
 * inglés y se enseña tal cual: es lo único que explica por qué suena como suena,
 * y aquí no se traduce para que se pueda comparar con lo que se oye.
 * @param {object} laMusica
 * @returns {HTMLElement}
 */
function pintarElEncargo(laMusica) {
  const encargo = soloTexto(laMusica.encargo);
  const negativo = soloTexto(laMusica.negativo);

  if (!encargo) {
    return aviso(
      'Esta pieza no tiene encargo escrito en «musica.piezas» de datos/serie.json, y el encargo es ' +
        'el prompt entero: sin él no hay nada que pedirle a Lyria.',
      { tono: 'error' }
    );
  }

  const caja = h('div', {
    estilo: {
      'margin-top': '10px',
      padding: '10px 12px',
      background: 'var(--fondo-hundido)',
      border: '1px solid var(--borde)',
      'border-radius': 'var(--radio-chico)'
    }
  });

  caja.appendChild(
    h(
      'p',
      { clase: 'tenue', estilo: { margin: '0 0 4px', 'font-size': '12px' } },
      'Lo que se le pide a Lyria, en inglés porque no admite otro idioma'
    )
  );

  caja.appendChild(
    h('p', { estilo: { margin: '0', 'font-size': '14px' } }, recortar(encargo, LARGO_DEL_ENCARGO))
  );

  if (encargo.length > LARGO_DEL_ENCARGO) {
    caja.appendChild(
      h(
        'details',
        { clase: 'aviso-detalle', estilo: { 'margin-top': '6px' } },
        h('summary', { clase: 'aviso-resumen' }, 'Ver el encargo entero'),
        h('p', { estilo: { margin: '6px 0 0', 'font-size': '14px' } }, encargo)
      )
    );
  }

  if (negativo) {
    caja.appendChild(
      h(
        'p',
        { clase: 'tenue', estilo: { margin: '6px 0 0', 'font-size': '12px' } },
        `Y lo que no se quiere oír: ${negativo}`
      )
    );
  }

  return caja;
}

// ---------------------------------------------------------------------------
// Voces
// ---------------------------------------------------------------------------

/**
 * La sección de voces: una tarjeta por BLOQUE, nunca por línea.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionVoces(ctx) {
  const { estado, pieza, bloques } = ctx;
  const partes = [];

  partes.push(
    h(
      'p',
      { clase: 'suave' },
      'Un bloque es una sola llamada al modelo con todas sus líneas dentro y hasta dos hablantes. Se ' +
        'genera así a propósito: entre dos llamadas el timbre no cambia —es la voz elegida— pero la ' +
        'entrega sí, y eso no se arregla pidiéndolo mejor. Lo único que funciona es llamar menos ' +
        'veces y meter más texto en cada llamada.'
    ),
    h(
      'p',
      { clase: 'tenue' },
      'En una pieza corta el bloque es un personaje con todas sus frases; en un episodio es una ' +
        'escena. El audio va en japonés y el subtítulo en español, así que lo que se mide de cada ' +
        'línea es su entrada y su salida, nunca palabra a palabra: el número de palabras no ' +
        'coincide.'
    )
  );

  if (!bloques.length) {
    partes.push(
      aviso(
        `La pieza «${pieza.id}» no tiene ni una línea de voz escrita en datos/serie.json ` +
          `(piezas.${pieza.id}.audio.voz), así que aquí no hay bloques que grabar. Si la pieza es ` +
          'muda, esto es lo correcto.',
        { tono: 'nota' }
      )
    );
    return seccion('Voces', partes);
  }

  const aprobados = bloques.filter(
    (bloque) => vozGuardada(estado, `${pieza.id}/${bloque.id}`).aprobada
  ).length;

  partes.push(barra(aprobados, bloques.length, { etiqueta: 'Bloques de voz aprobados' }));

  const sinVoz = personajesSinVoz(ctx);
  if (sinVoz.length) {
    partes.push(avisoDeVocesSinElegir(ctx, sinVoz));
  }

  const faltanPorGrabar = bloques.filter(
    (bloque) => !vozGuardada(estado, `${pieza.id}/${bloque.id}`).ruta
  );
  if (faltanPorGrabar.length > 1 && !sinVoz.length) {
    partes.push(
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton(
          `Grabar los ${faltanPorGrabar.length} bloques que faltan`,
          () => generarLosQueFaltan(ctx, faltanPorGrabar),
          { tono: 'principal' }
        )
      )
    );
  }

  for (const bloque of bloques) partes.push(tarjetaDeBloque(ctx, bloque));

  return seccion('Voces', partes);
}

/** Los personajes que hablan en la pieza y todavía no tienen voz elegida. */
function personajesSinVoz(ctx) {
  const { estado, bloques } = ctx;
  const sinVoz = [];
  for (const bloque of bloques) {
    for (const quien of bloque.personajes) {
      if (!vozElegidaDe(estado, quien) && !sinVoz.includes(quien)) sinVoz.push(quien);
    }
  }
  return sinVoz;
}

/** El aviso de que falta elegir voces, con el enlace a la pantalla que las elige. */
function avisoDeVocesSinElegir(ctx, sinVoz) {
  const { serie } = ctx;
  const nombres = sinVoz.map((id) => nombreDePersonaje(serie, id));

  const cartel = aviso(
    `${nombres.length === 1 ? 'Todavía no tiene voz elegida' : 'Todavía no tienen voz elegida'}: ` +
      `${enumerar(nombres, 6)}. Sin voz elegida no se graba su bloque: saldría con la voz que le ` +
      'toque al modelo y habría que pagarlo dos veces. La voz se elige escuchándola, en la ' +
      'pantalla de Voces.',
    { tono: 'error' }
  );

  cartel.appendChild(
    h(
      'div',
      { clase: 'tarjeta-acciones', estilo: { 'margin-top': '10px' } },
      h('a', { clase: 'boton boton-principal', href: '#voces' }, 'Ir a elegir las voces')
    )
  );

  return cartel;
}

/**
 * La tarjeta de un bloque: sus líneas con su texto español, su hora en la pieza y
 * su intención; el reproductor del bloque entero; y los tiempos medidos.
 * @param {object} ctx
 * @param {object} bloque
 * @returns {HTMLElement}
 */
function tarjetaDeBloque(ctx, bloque) {
  const { serie, estado, pieza, trabajos } = ctx;
  const clave = `${pieza.id}/${bloque.id}`;
  const guardado = vozGuardada(estado, clave);

  const enLaCola = trabajos.get(`voz:${clave}`) || null;
  const alineando = trabajos.get(`alinear:${clave}`) || null;
  const grabando = estaEnMarcha(enLaCola);
  const midiendoAhora = midiendo.has(clave) || estaEnMarcha(alineando);

  const url = guardado.ruta ? enlaceDe(guardado.ruta) : null;
  const medida = comoEstaMedido(bloque, guardado);

  const faltanVoces = bloque.personajes.filter((quien) => !vozElegidaDe(estado, quien));

  const notaDelEnlace = h('p', {
    clase: 'tenue',
    estilo: { margin: '4px 0 0', 'font-size': '12px' }
  });

  const acciones = h('div', { clase: 'tarjeta-acciones' });

  const pintarAcciones = () => {
    vaciar(acciones);

    if (grabando) {
      acciones.appendChild(
        boton('Grabando…', () => {}, {
          desactivado: 'El modelo ya está diciendo este bloque. Se paga una vez.'
        })
      );
    } else if (faltanVoces.length) {
      acciones.appendChild(
        boton(guardado.ruta ? 'Rehacer el bloque' : 'Grabar el bloque', () => {}, {
          desactivado:
            `Falta elegir la voz de ${enumerar(
              faltanVoces.map((quien) => nombreDePersonaje(serie, quien)),
              3
            )}. Se elige escuchando, en la pantalla de Voces.`
        })
      );
    } else {
      acciones.appendChild(
        boton(
          guardado.ruta ? 'Rehacer el bloque entero' : 'Grabar el bloque',
          () => generarBloque(ctx, bloque),
          { tono: guardado.ruta ? 'suave' : 'principal' }
        )
      );
    }

    if (midiendoAhora) {
      acciones.appendChild(
        boton('Midiendo…', () => {}, {
          desactivado: 'Se están midiendo los tiempos de este bloque ahora mismo.'
        })
      );
    } else {
      acciones.appendChild(
        boton(
          medida.hayTiempos ? 'Volver a medir los tiempos' : 'Medir los tiempos',
          () => alinearBloque(ctx, bloque),
          {
            desactivado: guardado.ruta
              ? false
              : 'Todavía no hay grabación, así que no hay nada que medir. Primero se graba el ' +
                'bloque y después se miden sus tiempos.'
          }
        )
      );
    }

    if (guardado.aprobada) {
      acciones.appendChild(
        boton('Quitar el visto bueno', () => aprobarBloque(ctx, clave, false), { tono: 'suave' })
      );
    } else {
      acciones.appendChild(
        boton('Aprobar', () => aprobarBloque(ctx, clave, true), {
          tono: 'principal',
          desactivado: motivoParaNoAprobar(guardado.ruta, url, oidos.has(guardado.ruta || ''))
        })
      );
    }
  };

  pintarAcciones();

  const media = url
    ? reproductor(
        guardado.ruta,
        url,
        `Bloque de voz ${bloque.id} de la pieza ${pieza.id}`,
        notaDelEnlace,
        pintarAcciones
      )
    : null;

  const pie = h('div', null);

  pie.appendChild(
    h(
      'p',
      { clase: 'suave', estilo: { margin: '0' } },
      `${plural(bloque.lineas.length, 'línea', 'líneas')} · ` +
        `${bloque.personajes.length === 1 ? 'habla' : 'hablan'} ` +
        `${enumerar(bloque.personajes.map((quien) => nombreDePersonaje(serie, quien)), 3)}` +
        (guardado.durS === null ? '' : ` · el archivo dura ${segundos(guardado.durS)}`)
    )
  );

  pie.appendChild(notaDelEnlace);

  if (faltanVoces.length) {
    pie.appendChild(avisoDeVocesSinElegir(ctx, faltanVoces));
  }

  pie.appendChild(pintarLasLineas(ctx, bloque, guardado, medida));

  if (guardado.ruta && !medida.hayTiempos) {
    pie.appendChild(
      aviso(
        'Este bloque está grabado pero sus tiempos no se han medido todavía, así que los subtítulos ' +
          'no se pueden quemar con la entrada y la salida reales de cada línea. Pulsa «Medir los ' +
          'tiempos»: es una sola llamada y no vuelve a generar nada.',
        { tono: 'nota' }
      )
    );
  }

  if (medida.algunoEstimado) {
    pie.appendChild(
      aviso(
        `${
          medida.cuantosEstimados === 1
            ? 'Un tramo se ha repartido a ojo'
            : `${medida.cuantosEstimados} tramos se han repartido a ojo`
        } en vez de medirse: el reconocimiento de voz volvió con menos palabras que líneas, así que ` +
          'la duración total se repartió en proporción a lo que ocupa cada frase en japonés. Sirve ' +
          'para montar, pero el subtítulo puede entrar o salir un poco desplazado. Volver a medir ' +
          'suele arreglarlo; si no, rehacer el bloque también.',
        { tono: 'nota' }
      )
    );
  }

  if (medida.sinMarca && medida.hayTiempos) {
    pie.appendChild(
      h(
        'p',
        { clase: 'tenue', estilo: { margin: '8px 0 0', 'font-size': '12px' } },
        'Estos tiempos los midió la cola, que guarda el número pero no si algún tramo hubo que ' +
          'estimarlo. Si quieres saberlo, vuelve a medirlos desde aquí: es una llamada y no ' +
          'regenera nada.'
      )
    );
  }

  if (guardado.intentos.length > 1) {
    pie.appendChild(
      h(
        'p',
        { clase: 'tenue', estilo: { margin: '8px 0 0', 'font-size': '12px' } },
        `${plural(guardado.intentos.length, 'toma grabada', 'tomas grabadas')} de este bloque. La ` +
          'que suena es la última: rehacerlo escribe encima de la misma ruta.'
      )
    );
  }

  if (enLaCola && enLaCola.error) {
    pie.appendChild(aviso(enLaCola.error, { tono: 'error', detalle: enLaCola.detalle }));
  }
  if (alineando && alineando.error) {
    pie.appendChild(aviso(alineando.error, { tono: 'error', detalle: alineando.detalle }));
  }

  if (grabando) pie.appendChild(espera('El modelo está diciendo este bloque entero…'));
  else if (midiendoAhora) pie.appendChild(espera('Midiendo dónde entra y sale cada línea…'));

  return tarjeta({
    titulo: tituloDelBloque(ctx, bloque),
    media,
    estado: estadoDeBloque(guardado, medida, grabando),
    pie,
    acciones
  });
}

/** Cómo se llama un bloque en pantalla. */
function tituloDelBloque(ctx, bloque) {
  const { serie } = ctx;
  if (bloque.escena === null) return nombreDePersonaje(serie, bloque.id);
  const quienes = enumerar(
    bloque.personajes.map((quien) => nombreDePersonaje(serie, quien)),
    2
  );
  return `Escena ${bloque.escena} · ${quienes}`;
}

/** El punto de estado de un bloque. */
function estadoDeBloque(guardado, medida, grabando) {
  if (grabando) return { tipo: 'generando', texto: 'Grabándose' };
  if (!guardado.ruta) return { tipo: 'pendiente', texto: 'Sin grabar' };
  if (guardado.aprobada) return { tipo: 'aprobado', texto: 'Aprobado' };
  if (!medida.hayTiempos) return { tipo: 'por-aprobar', texto: 'Sin medir' };
  return { tipo: 'por-aprobar', texto: 'Por aprobar' };
}

/**
 * Cómo están los tiempos de un bloque: si hay, cuántos se estimaron y si vienen
 * sin marca de si se midieron o se repartieron.
 * @param {object} bloque
 * @param {object} guardado
 * @returns {{hayTiempos:boolean, tramos:object[], algunoEstimado:boolean,
 *   cuantosEstimados:number, sinMarca:boolean, completos:boolean}}
 */
function comoEstaMedido(bloque, guardado) {
  const tramos = guardado.tramos;
  const utiles = tramos.filter((tramo) => tramo.fin > tramo.inicio);
  const estimados = tramos.filter((tramo) => tramo.estimado === true);

  return {
    tramos,
    hayTiempos: utiles.length > 0,
    completos: utiles.length === bloque.lineas.length && tramos.length === bloque.lineas.length,
    algunoEstimado: estimados.length > 0,
    cuantosEstimados: estimados.length,
    sinMarca: utiles.length > 0 && tramos.every((tramo) => tramo.estimado === null)
  };
}

/**
 * Las líneas del bloque: su texto español, su hora en la pieza, su intención y
 * los tiempos medidos dentro del archivo.
 *
 * El japonés no se pinta: en pantalla no hay japonés en ningún momento, ni en el
 * vídeo ni aquí. Lo que se juzga es lo que se oye, y lo que se lee es el español.
 *
 * @param {object} ctx
 * @param {object} bloque
 * @param {object} guardado
 * @param {object} medida
 * @returns {HTMLElement}
 */
function pintarLasLineas(ctx, bloque, guardado, medida) {
  const { serie } = ctx;

  const caja = h('div', { estilo: { 'margin-top': '10px' } });

  caja.appendChild(
    h(
      'p',
      { clase: 'tenue', estilo: { margin: '0 0 8px', 'font-size': '13px' } },
      'Estas líneas se graban juntas, de una sola vez, y se rehacen juntas. Una línea regenerada ' +
        'sola es justo la que canta: sale con otro tono y otra energía, y al montarla entre las ' +
        'demás se oye como si la dijera otra persona.'
    )
  );

  const lista = h('ol', {
    estilo: {
      margin: '0',
      padding: '0',
      'list-style': 'none',
      display: 'flex',
      'flex-direction': 'column',
      gap: '10px'
    }
  });

  bloque.lineas.forEach((linea, i) => {
    const tramo = medida.tramos[i] || null;
    const propia = Boolean(linea.intencion);
    const intencion = linea.intencion || intencionDeLaMuestra(serie, linea.quien);

    const fila = h('li', {
      estilo: {
        padding: '10px 12px',
        background: 'var(--fondo-hundido)',
        border: '1px solid var(--borde)',
        'border-radius': 'var(--radio-chico)'
      }
    });

    fila.appendChild(
      h(
        'p',
        { clase: 'tenue', estilo: { margin: '0 0 4px', 'font-size': '12px' } },
        `${nombreDePersonaje(serie, linea.quien)} · en la pieza, de ${segundos(linea.t)} a ` +
          `${segundos(linea.hasta)}`
      )
    );

    fila.appendChild(h('p', { estilo: { margin: '0' } }, `«${linea.es || 'sin texto español'}»`));

    if (intencion) {
      fila.appendChild(
        h(
          'p',
          { clase: 'suave', estilo: { margin: '4px 0 0', 'font-size': '13px' } },
          propia
            ? `Se dice así: ${intencion}.`
            : `Sin intención propia escrita, así que se dice con la de su muestra: ${intencion}.`
        )
      );
    }

    fila.appendChild(
      h(
        'p',
        { clase: 'tenue numero', estilo: { margin: '4px 0 0', 'font-size': '12px' } },
        textoDelTramo(tramo, guardado.ruta)
      )
    );

    fila.appendChild(
      h(
        'div',
        { clase: 'tarjeta-acciones', estilo: { 'margin-top': '8px' } },
        boton(
          'Rehacer solo esta línea',
          () => ofrecerRehacerElBloque(ctx, bloque, linea),
          { tono: 'suave' }
        )
      )
    );

    lista.appendChild(fila);
  });

  caja.appendChild(lista);
  return caja;
}

/** Lo que se lee debajo de una línea sobre sus tiempos dentro del archivo. */
function textoDelTramo(tramo, ruta) {
  if (!ruta) return 'Sin grabar, así que todavía no hay nada que medir.';
  if (!tramo || tramo.fin <= tramo.inicio) {
    return 'Sin medir: el subtítulo de esta línea todavía no tiene entrada ni salida reales.';
  }

  const dura = tramo.fin - tramo.inicio;
  const donde = `Dentro del archivo: de ${segundos(tramo.inicio)} a ${segundos(tramo.fin)} ` +
    `(${segundos(dura)}).`;

  if (tramo.estimado === true) return `${donde} Estimado, no medido.`;
  if (tramo.estimado === false) return `${donde} Medido sobre el audio.`;
  return `${donde} Sin marca de si se midió o se estimó.`;
}

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------

/** Encola la generación de una pieza de música. */
function generarMusica(ctx, laMusica) {
  const { pieza, repintar } = ctx;
  try {
    encolar('musica', { pieza: pieza.id, id: String(laMusica.id) });
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  repintar();
}

/** Encola la grabación de un bloque entero. */
function generarBloque(ctx, bloque) {
  const { pieza, repintar } = ctx;
  try {
    encolar('voz', { pieza: pieza.id, bloque: bloque.id });
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  repintar();
}

/** Encola de una vez todos los bloques que aún no se han grabado. */
function generarLosQueFaltan(ctx, bloques) {
  const { pieza, repintar } = ctx;
  try {
    encolarVarios(
      bloques.map((bloque) => ({ tipo: 'voz', args: { pieza: pieza.id, bloque: bloque.id } }))
    );
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  repintar();
}

/**
 * Lo que pasa cuando alguien pulsa el botón de rehacer UNA línea: se le cuenta
 * por qué eso no se hace y se le ofrece rehacer el bloque.
 *
 * El botón existe a propósito. La línea que suena mal es la que el usuario quiere
 * arreglar, y no poner ningún botón ahí no le explica nada: le deja buscando. Lo
 * que hace falta es que ese botón cuente que una línea regenerada sola es
 * justamente la que canta —el timbre no cambia, pero el tono, la energía y el
 * ritmo sí— y que ofrezca lo único que sí funciona.
 *
 * @param {object} ctx
 * @param {object} bloque
 * @param {object} linea
 */
async function ofrecerRehacerElBloque(ctx, bloque, linea) {
  const { serie } = ctx;
  const quien = nombreDePersonaje(serie, linea.quien);
  const corta = recortar(linea.es || 'esta línea', 60);

  const seguro = await confirmar(
    `«${corta}» no se puede rehacer sola. Una línea generada por su cuenta sale con otro tono, otra ` +
      `energía y otro ritmo, y al montarla entre las demás es justo la que canta. Lo que se rehace ` +
      `es el bloque entero de ${quien}, que se genera de una sola vez y por eso queda parejo. ` +
      `¿Rehacer el bloque completo, con sus ${bloque.lineas.length} líneas?`
  );

  if (!seguro) return;
  generarBloque(ctx, bloque);
}

/**
 * Mide los tiempos de un bloque.
 *
 * POR QUÉ ESTA NO PASA POR LA COLA. La cola tiene su trabajo de alinear y lo hace
 * sola después de cada grabación, pero guarda solo `inicio` y `fin`: pierde la
 * marca de si un tramo se midió o se repartió a ojo. Desde aquí se pide directa y
 * se guarda la marca, que es lo que esta pantalla tiene que enseñar. Es una
 * llamada corta —el bloque no llega al minuto— y no genera nada: no hay gasto que
 * proteger con un hueco de concurrencia.
 *
 * @param {object} ctx
 * @param {object} bloque
 * @returns {Promise<void>}
 */
async function alinearBloque(ctx, bloque) {
  const { estado, pieza, repintar } = ctx;
  const clave = `${pieza.id}/${bloque.id}`;
  if (midiendo.has(clave)) return;

  const guardado = vozGuardada(estado, clave);
  if (!guardado.ruta) return;

  const lineas = bloque.lineas.map((linea) => ({ ja: linea.ja }));
  if (lineas.some((linea) => !linea.ja)) {
    queja = new ErrorDeCara(
      `Alguna línea del bloque «${bloque.id}» no tiene texto en japonés escrito en ` +
        'datos/serie.json, y los tiempos se reparten en proporción a lo que se tarda en decir cada ' +
        'una. Sin el japonés no hay nada que medir.',
      { reintentable: false, http: 500 }
    );
    repintar();
    return;
  }

  midiendo.add(clave);
  queja = null;
  repintar();

  try {
    const medido = await llamar('alinear', { ruta: guardado.ruta, lineas });
    const tramos = Array.isArray(medido.lineas) ? medido.lineas : [];

    await cambiar((borrador) => {
      const entrada = entradaDeVoz(borrador, clave);
      entrada.lineas = tramos.map((tramo) => ({
        inicio: Number(tramo && tramo.inicio) || 0,
        fin: Number(tramo && tramo.fin) || 0,
        // FALTA EN EL CONTRATO: docs/contrato.md §5 escribe cada línea guardada
        // como `{inicio, fin}` y §12 no dice qué se hace cuando el
        // reconocimiento vuelve corto y hay que repartir a ojo. Se guarda
        // `estimado` porque un tiempo medido y uno estimado no valen lo mismo y
        // con ellos se queman los subtítulos. Que se revise.
        estimado: Boolean(tramo && tramo.estimado)
      }));
    });
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  } finally {
    midiendo.delete(clave);
    repintar();
  }
}

/** Aprueba o desaprueba una pieza de música. */
function aprobarMusica(ctx, id, comoQueda) {
  const { repintar } = ctx;
  cambiar((borrador) => {
    entradaDeMusica(borrador, id).aprobada = comoQueda === true;
  }).catch((fallo) => {
    queja = comoErrorDeCara(fallo);
    repintar();
  });
}

/** Aprueba o desaprueba un bloque de voz. */
function aprobarBloque(ctx, clave, comoQueda) {
  const { repintar } = ctx;
  cambiar((borrador) => {
    entradaDeVoz(borrador, clave).aprobada = comoQueda === true;
  }).catch((fallo) => {
    queja = comoErrorDeCara(fallo);
    repintar();
  });
}

// ---------------------------------------------------------------------------
// El reproductor
// ---------------------------------------------------------------------------

/**
 * El `<audio controls>` de una pista. Va suelto, sin envolver, para que la
 * tarjeta lo reconozca como audio y no le ponga el marco de 16:9 de las
 * imágenes.
 *
 * `preload` va en «none» a propósito: en un teléfono, treinta pistas pidiendo
 * cabecera a la vez es lo que hace que la pantalla parezca colgada.
 *
 * @param {string} ruta la ruta lógica, que es lo que se apunta como oído
 * @param {string} url la URL firmada
 * @param {string} queEs para quien no ve la pantalla
 * @param {HTMLElement} nota dónde escribir si el enlace ya no sirve
 * @param {() => void} alOir qué repintar cuando empiece a sonar
 * @returns {HTMLElement}
 */
function reproductor(ruta, url, queEs, nota, alOir) {
  return h('audio', {
    controls: true,
    preload: 'none',
    src: url,
    'aria-label': queEs,
    estilo: { width: '100%' },
    alReproducir: () => {
      sonando.add(ruta);
      if (!oidos.has(ruta)) {
        oidos.add(ruta);
        // Se enciende el botón de aprobar sin repintar la tarjeta: repintarla
        // pararía esta misma pista justo cuando acaba de empezar a sonar.
        if (typeof alOir === 'function') alOir();
      }
    },
    alPausar: () => {
      sonando.delete(ruta);
      if (typeof alSoltarUnAudio === 'function') alSoltarUnAudio();
    },
    alTerminar: () => {
      sonando.delete(ruta);
      if (typeof alSoltarUnAudio === 'function') alSoltarUnAudio();
    },
    alError: () => {
      sonando.delete(ruta);
      nota.textContent =
        'Este enlace ya no sirve: las URL firmadas caducan a las seis horas. Sal de la pantalla y ' +
        'vuelve a entrar para pedir enlaces nuevos; lo generado sigue guardado en el bucket y no ' +
        'hay que pagarlo otra vez.';
    }
  });
}

/**
 * Por qué no se puede aprobar todavía, con palabras. Devuelve `false` cuando sí
 * se puede, que es lo que `boton()` entiende como «encendido».
 * @param {string|null} ruta
 * @param {string|null} url
 * @param {boolean} oida
 * @returns {string|false}
 */
function motivoParaNoAprobar(ruta, url, oida) {
  if (!ruta) {
    return 'Todavía no hay nada grabado que aprobar. Primero se genera y después se escucha.';
  }
  if (!url) {
    return 'Está grabado, pero no hay enlace para oírlo, así que no se puede juzgar. Vuelve a ' +
      'pedir los enlaces desde arriba.';
  }
  if (!oida) {
    return 'Todavía no lo has escuchado. Nada suena en un montaje sin haber sonado antes aquí: ' +
      'dale al play y el botón se enciende solo.';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Menudencias
// ---------------------------------------------------------------------------

/** Si algo es un objeto de verdad, no null ni una lista. */
function esObjeto(valor) {
  return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
}

/** Un texto limpio, o cadena vacía. */
function soloTexto(valor) {
  if (typeof valor === 'string') return valor.trim();
  if (valor == null) return '';
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  return '';
}

/** Una ruta si la hay, o null. */
function rutaSiVale(valor) {
  const limpia = typeof valor === 'string' ? valor.trim() : '';
  return limpia || null;
}

/** Una lista de rutas, sin huecos ni basura. */
function soloRutas(valor) {
  if (!Array.isArray(valor)) return [];
  return valor.filter((ruta) => typeof ruta === 'string' && ruta.trim());
}

/** Un número medido, o null si no se ha medido nada. */
function numeroSiVale(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** Un texto cortado por lo sano, con puntos suspensivos. */
function recortar(texto, maximo) {
  const t = String(texto || '').trim();
  if (t.length <= maximo) return t;
  return `${t.slice(0, maximo).trimEnd()}…`;
}

/** Una lista legible: «a, b y c», y con tope, «a, b, c y 9 más». */
function enumerar(cosas, tope) {
  const lista = cosas.map((c) => String(c)).filter(Boolean);
  if (!lista.length) return 'nadie';
  if (lista.length === 1) return lista[0];
  if (lista.length <= tope) {
    return `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`;
  }
  return `${lista.slice(0, tope).join(', ')} y ${lista.length - tope} más`;
}

/** Primera letra en mayúscula, el resto tal cual. */
function primeraMayuscula(texto) {
  const t = String(texto || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/**
 * Cualquier cosa que se haya lanzado, convertida en el error que se enseña. Un
 * fallo del propio navegador saldría en inglés y sin decir qué hacer.
 * @param {*} fallo
 * @returns {ErrorDeCara}
 */
function comoErrorDeCara(fallo) {
  if (fallo instanceof ErrorDeCara) return fallo;
  return new ErrorDeCara(
    'El estudio se ha roto por dentro pintando el audio. No es un problema de tu cuenta ni de la ' +
      'nube: es un fallo del propio código. Debajo está lo que dijo el navegador, tal cual.',
    { detalle: loQueDijo(fallo), reintentable: false, http: 500 }
  );
}

/** Lo que dijo un fallo del navegador, para el detalle plegado. */
function loQueDijo(fallo) {
  if (fallo == null) return null;
  if (typeof fallo === 'string') return fallo;
  if (fallo.message) return String(fallo.message);
  return String(fallo);
}
