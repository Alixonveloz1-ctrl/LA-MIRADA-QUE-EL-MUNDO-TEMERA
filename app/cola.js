// La cola. El obrero está en el navegador, pero el trabajo vive en el bucket.
//
// POR QUÉ NO ES UNA LISTA EN MEMORIA. Un episodio son ~400 planos. Entre el
// primero y el último se apaga la pantalla del teléfono, se cierra la pestaña,
// se va la cobertura en el metro y se reinicia el móvil. Con la cola en memoria,
// cada una de esas cosas significa empezar de cero y no saber qué se había
// generado ya. Con la cola en `estado.cola` —en el bucket, que es la única
// verdad— al volver a abrir la aplicación sigue estando todo: lo hecho, lo que
// falta, lo que falló y por qué. Este archivo es el que hace que eso sea verdad.
//
// POR QUÉ EL ID ES DETERMINISTA. El id de un trabajo sale de su tipo y de sus
// argumentos, siempre el mismo: `keyframe-teaser-A4-x7k2m1p`. Así, pulsar dos
// veces «generar los keyframes que faltan» no encola cuarenta y ocho trabajos,
// encola veinticuatro y deja los otros veinticuatro como estaban. Reencolar es
// seguro por construcción, no por acordarse de comprobarlo.
//
// POR QUÉ SE GENERA UNA COSA CADA VEZ, Y NO ES UN AJUSTE. Esto era un tope de 1
// a 12 que venía a 3 y se tocaba desde la pantalla de Cola. Ya no. Las cuotas de
// esta cuenta son cortas, y con cuotas cortas la concurrencia no es una palanca
// de velocidad: es una fuente de fallos. Vertex pasado de cuota NO devuelve «has
// gastado tu cuota», devuelve un 429 que se lee como falta de acceso al modelo, y
// se acaba buscando el fallo en los permisos de la cuenta, que es donde no está.
// Termina una, empieza la siguiente; pedir diez de golpe son diez trabajos en la
// cola y una sola llamada en vuelo.
//
// Y el hueco se cuenta sobre el estado del BUCKET, no sobre esta pestaña: un
// trabajo «en curso» lo está haciendo alguien, aquí o en el ordenador que quedó
// abierto. Así «una cada vez» vale para todo el estudio y no solo para esta
// ventana. Quien trabaja late —refresca la hora de lo que tiene cogido cada
// quince segundos— para que se pueda distinguir «lo está haciendo otro» de «lo
// cogió un navegador que ya no existe».
//
// POR QUÉ SE ESCRIBE EL ESTADO POR TANDAS Y NO POR TRABAJO. Cada escritura de
// `estado.json` es una petición con su condición de generación. Con 400 planos,
// escribir una vez por trabajo son 400 escrituras y 400 ocasiones de chocar con
// otra pestaña. Se escribe una vez al empezar la tanda —para marcar en curso lo
// que se ha cogido— y una vez al terminarla, con todos los resultados juntos.
//
// LA EXCEPCIÓN, A PROPÓSITO: EL LANZAMIENTO DE VEO. Una operación de Veo lanzada
// y no apuntada es un clip pagado que nadie recoge y una toma que se queda
// «generando» para siempre. En cuanto Veo contesta con el nombre de la operación
// se escribe el estado en ese mismo instante, sin esperar al final de la tanda, y
// con él la consulta que la recogerá. Cuesta una escritura de más por clip y
// evita perder un euro por clip.
//
// POR QUÉ UN 409 NO ES UN PROBLEMA AQUÍ. La función también escribe el estado
// (`imagen`, `veo-lanzar`, `musica`, `voz` apuntan lo suyo antes de contestar),
// así que la copia del navegador se queda vieja constantemente. Cuando esta cola
// escribe encima, el bucket contesta 409 y `app/estado.js` recarga lo fresco y
// vuelve a aplicar el cambio. Por eso todo lo que se anota aquí está escrito para
// poder aplicarse dos veces sin estropear nada: los intentos se apuntan solo si
// no estaban, y el gasto se suma sobre el estado recién traído, no sobre el que
// se leyó al principio.

import { ErrorDeCara, llamar } from './api.js';
import { actual, cambiar, cargar, anotarGasto } from './estado.js';
import { reducirParaVeo, pesoDeB64 } from './imagen.js';
import { bytes as enBytes } from './formato.js';

// ---------------------------------------------------------------------------
// Números que gobiernan la cola
// ---------------------------------------------------------------------------

/**
 * UNA GENERACIÓN CADA VEZ. Una, no tres, y no se puede subir.
 *
 * Esto era un ajuste de pantalla con valores de 1 a 12 y venía a 3. Ya no: esta
 * cuenta de Google es nueva y sus cuotas son cortas, y con cuotas cortas la
 * concurrencia no es una palanca de velocidad, es una fuente de fallos. Vertex
 * pasado de cuota NO contesta «has gastado tu cuota»: contesta un 429 que se lee
 * como falta de acceso al modelo, y se acaba buscando el fallo en los permisos,
 * que es donde no está.
 *
 * Así que se pide de una en una: termina una, empieza la siguiente. Diez voces
 * pedidas de golpe son diez trabajos en la cola y una sola llamada en vuelo.
 * Tarda más y llega siempre, que con estas cuotas es más rápido que ir de tres
 * en tres y reintentar.
 */
const A_LA_VEZ = 1;

/**
 * Las esperas entre reintentos, en milisegundos. Cuatro y se para: 2, 4, 8, 16.
 * Y solo se llega aquí si el error venía marcado como reintentable, que nunca es
 * el caso de un 4xx ni jamás el de un 413.
 */
const ESPERAS_DE_REINTENTO = [2000, 4000, 8000, 16000];

/** Cada cuánto se vuelve a preguntar por un clip de Veo que sigue generándose. */
const ESPERA_CONSULTA_BASE = 12000;
const ESPERA_CONSULTA_MAX = 60000;

/** Lo mismo para un montaje, que tarda minutos y no segundos. */
const ESPERA_MONTAJE_BASE = 20000;
const ESPERA_MONTAJE_MAX = 120000;

/**
 * Cuánto tiene que llevar un trabajo «en curso» sin moverse para darlo por
 * huérfano y volver a ponerlo pendiente.
 *
 * Ninguna llamada de esta aplicación puede durar más de 90 s (`app/api.js` corta
 * ahí), así que cuatro minutos parados solo significan una cosa: el navegador que
 * lo cogió ya no existe. El margen es grande a propósito, porque hay otro caso
 * posible —una segunda pestaña abierta trabajando ahora mismo— y revivirle un
 * trabajo a alguien que lo está haciendo sería generarlo dos veces y pagarlo dos
 * veces.
 */
const UMBRAL_HUERFANO_MS = 45 * 1000;

/**
 * Cada cuánto el que está trabajando dice «sigo aquí», refrescando la hora del
 * trabajo que tiene cogido.
 *
 * SIN ESTO EL UMBRAL DE ARRIBA TENÍA QUE SER ENORME. Antes eran cuatro minutos,
 * y el motivo estaba escrito: sin latido no hay forma de distinguir «este
 * trabajo lo cogió un navegador que ya se cerró» de «lo está haciendo la otra
 * pestaña ahora mismo», y revivirle un trabajo a quien lo está haciendo es
 * pagarlo dos veces. Pero con una sola generación a la vez esos cuatro minutos
 * se notan: recargas la página y el estudio se queda parado hasta que caduque el
 * trabajo que se quedó a medias.
 *
 * Con el latido la diferencia sí se ve: quien está trabajando refresca la hora
 * cada quince segundos, y quien se cerró deja de refrescarla. Cuarenta y cinco
 * segundos sin latir son tres latidos perdidos: ya no hay nadie.
 *
 * Cuesta una escritura del estado cada quince segundos y SOLO mientras hay algo
 * generándose, que con una generación a la vez es como mucho una cada quince
 * segundos en todo el estudio.
 */
const LATIDO_DEL_TRABAJO_MS = 15 * 1000;

/**
 * Cuánto se espera cuando hay algo generándose y no queda hueco. Corto: en
 * cuanto el otro termine hay que coger lo siguiente sin dejar la cuota parada.
 */
const ESPERA_SI_HAY_ALGUIEN_MS = 1500;

/** Cuántos trabajos terminados se guardan antes de empezar a tirar los viejos. */
const MAX_HECHAS = 200;

/** El límite de la plataforma por petición, y el margen para el resto del JSON. */
const LIMITE_PETICION = 4.5 * 1024 * 1024;
const MARGEN_PETICION = 96 * 1024;

/** Los cinco estados de un trabajo (contrato §8). */
const PENDIENTE = 'pendiente';
const EN_CURSO = 'en_curso';
const HECHO = 'hecho';
const FALLIDO = 'fallido';
const DETENIDO = 'detenido';

/**
 * Nombre del evento con el que la cola cuenta un fallo que no cabe en ningún
 * trabajo: no se ha podido escribir el estado, no se ha podido leer la serie.
 *
 * Se dispara sobre `window` con `detail: { mensaje, detalle }`, y la pantalla de
 * Cola lo enseña. Sin esto, un fallo al guardar la cola se perdería por consola,
 * que es justo donde el usuario de esta herramienta no va a mirar nunca.
 *
 * FALTA EN EL CONTRATO: docs/contrato.md §12 fija las funciones de `app/cola.js`
 * pero no dice cómo cuenta la cola un fallo suyo, que no pertenece a ningún
 * trabajo concreto. Se resuelve con el mismo patrón que `app/api.js` usa para
 * pedir la clave. Que se revise.
 */
export const EVENTO_FALLO_DE_COLA = 'fallo-de-cola';

// ---------------------------------------------------------------------------
// Lo que la cola recuerda mientras la página está abierta
// ---------------------------------------------------------------------------

/** Si el bucle del obrero está en marcha. */
let bucleEnMarcha = false;

/** Si alguien ha pulsado detener. Mientras esté puesto no se coge nada nuevo. */
let parado = false;

/**
 * El cuaderno de la tanda: los cambios del estado que han anotado los ejecutores
 * y que se escriben todos juntos al terminar. Null cuando no hay tanda abierta,
 * y entonces cada anotación se escribe por su cuenta.
 */
let cuaderno = null;

/** Los ids que se están ejecutando ahora mismo: a esos no se les revive nada. */
const enVuelo = new Set();

/** Para despertar al bucle cuando está durmiendo y llega trabajo nuevo. */
let despertar = null;

/** Si ya se ha mirado en esta sesión qué quedó a medias del navegador anterior. */
let revivido = false;

// ---------------------------------------------------------------------------
// datos/serie.json, del lado del navegador
// ---------------------------------------------------------------------------

// La cola necesita tres cosas de la serie y ninguna es un id de modelo: si una
// toma encadena con otra (para mandar el `lastFrame`), qué nivel de Veo y cuántos
// segundos gasta (para el contador de gasto), y qué líneas tiene una pieza corta.
// El archivo se sirve tal cual desde el repositorio, así que se baja una vez y se
// queda.
//
// FALTA EN EL CONTRATO: §12 no da ningún módulo de datos para el navegador, pero
// §0 sí dice qué puede saber el navegador: la cola, el progreso y los reintentos.
// Saber que C3 encadena con C4 no es componer un prompt ni conocer un modelo. Se
// resuelve aquí con el nombre más obvio, para que se revise y, si hace falta,
// acabe en un `app/datos.js` compartido con las pantallas.

/** La promesa de la serie, que se pide una sola vez. */
let promesaDeLaSerie = null;

/**
 * `datos/serie.json`, bajado una vez y guardado.
 * @returns {Promise<object>}
 */
function serie() {
  if (!promesaDeLaSerie) {
    promesaDeLaSerie = bajarLaSerie().catch((fallo) => {
      // Si falló, la próxima vez se vuelve a intentar: una caída de red no puede
      // dejar la aplicación sin datos para el resto de la sesión.
      promesaDeLaSerie = null;
      throw fallo;
    });
  }
  return promesaDeLaSerie;
}

/**
 * Baja `datos/serie.json`. La dirección se calcula desde la de este módulo, así
 * que funciona igual si la aplicación cuelga de la raíz o de una subcarpeta.
 * @returns {Promise<object>}
 */
async function bajarLaSerie() {
  const direccion = new URL('../datos/serie.json', import.meta.url).href;

  let respuesta;
  try {
    respuesta = await fetch(direccion, { cache: 'no-cache' });
  } catch (fallo) {
    throw new ErrorDeCara(
      'No se ha podido leer datos/serie.json, que es donde está escrito qué planos tiene cada ' +
        'pieza. Sin él la cola no sabe si una toma encadena con la siguiente. Comprueba la ' +
        'conexión del teléfono; si tienes cobertura, es que el despliegue está a medias.',
      { detalle: fallo && fallo.message ? String(fallo.message) : null, reintentable: true, http: 0 }
    );
  }

  if (!respuesta.ok) {
    throw new ErrorDeCara(
      `No se ha podido leer datos/serie.json: el servidor ha contestado con un ${respuesta.status}. ` +
        'Ese archivo va dentro del repositorio, así que si no está es que el despliegue no ha ' +
        'subido entero.',
      { detalle: `HTTP ${respuesta.status}`, reintentable: respuesta.status >= 500, http: respuesta.status }
    );
  }

  try {
    return await respuesta.json();
  } catch (fallo) {
    throw new ErrorDeCara(
      'datos/serie.json se ha bajado pero no se entiende: no es un JSON válido. Es un fallo del ' +
        'propio estudio, no de tu cuenta.',
      { detalle: fallo && fallo.message ? String(fallo.message) : null, reintentable: false, http: 500 }
    );
  }
}

/**
 * Una toma de una pieza, tal como está escrita en la serie.
 * @param {string} idPieza
 * @param {string} idToma
 * @returns {Promise<object>}
 */
async function tomaDeLaSerie(idPieza, idToma) {
  const datos = await serie();
  const laPieza = datos && datos.piezas ? datos.piezas[idPieza] : null;
  if (!laPieza) {
    throw new ErrorDeCara(
      `La pieza «${idPieza}» no está escrita en datos/serie.json. Si acabas de desglosar un ` +
        'episodio, sus planos todavía no están en la serie: hay que llevarlos ahí antes de poder ' +
        'generarlos.',
      { reintentable: false, http: 400 }
    );
  }
  const laToma = (laPieza.tomas || []).find((una) => una && una.id === idToma);
  if (!laToma) {
    throw new ErrorDeCara(
      `La toma «${idToma}» no existe en la pieza «${idPieza}». Es un fallo del propio estudio, no ` +
        'de tu cuenta: se ha encolado un trabajo para un plano que no está escrito.',
      { reintentable: false, http: 400 }
    );
  }
  return laToma;
}

/**
 * El nivel de imagen que se usa cuando nadie dice cuál. Sale de serie.json, que
 * es donde está escrito; aquí no se escribe ningún nivel a mano.
 * @returns {Promise<string>}
 */
async function nivelDeImagenPorDefecto() {
  const datos = await serie();
  const dicho = datos && datos.modelos && datos.modelos.imagen && datos.modelos.imagen.por_defecto;
  return typeof dicho === 'string' && dicho.trim() ? dicho.trim() : 'medio';
}

// ---------------------------------------------------------------------------
// La cola dentro del estado
// ---------------------------------------------------------------------------

/**
 * La lista de trabajos del estado, creada si no estaba.
 * @param {object} estado
 * @returns {object[]}
 */
function colaDe(estado) {
  if (!estado || typeof estado !== 'object') return [];
  if (!Array.isArray(estado.cola)) estado.cola = [];
  return estado.cola;
}

/**
 * Un trabajo por su id dentro de un estado.
 * @param {object} estado
 * @param {string} id
 * @returns {object|null}
 */
function buscarEnCola(estado, id) {
  return colaDe(estado).find((trabajo) => trabajo && trabajo.id === id) || null;
}

/** La hora de ahora, como se guarda en el estado. */
function ahoraIso() {
  return new Date().toISOString();
}

/** Una hora futura, en ISO, para el próximo intento de un trabajo. */
function dentroDe(ms) {
  return new Date(Date.now() + Math.max(0, Number(ms) || 0)).toISOString();
}

/** Si a un trabajo ya le toca: no tiene hora de próximo intento, o ya pasó. */
function leToca(trabajo, ahora) {
  if (!trabajo.proximo) return true;
  const cuando = Date.parse(trabajo.proximo);
  return !Number.isFinite(cuando) || cuando <= ahora;
}

/** Un texto limpio, o cadena vacía. Vale para null, números y basura. */
function soloTexto(valor) {
  return typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor).trim();
}

// ---------------------------------------------------------------------------
// Los ids, que son deterministas
// ---------------------------------------------------------------------------

/**
 * Una huella corta y estable de un texto. FNV-1a de 32 bits, que no es
 * criptografía y no pretende serlo: solo tiene que dar siempre lo mismo para lo
 * mismo y casi nunca lo mismo para cosas distintas. Y no necesita ninguna
 * dependencia ni ser asíncrona, que es lo que descarta `crypto.subtle`.
 * @param {string} texto
 * @returns {string}
 */
function huella(texto) {
  let valor = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    valor ^= texto.charCodeAt(i);
    // El equivalente a multiplicar por 16777619 sin salirse de 32 bits.
    valor = (valor + ((valor << 1) + (valor << 4) + (valor << 7) + (valor << 8) + (valor << 24))) >>> 0;
  }
  return valor.toString(36).padStart(7, '0');
}

/**
 * Un JSON con las claves siempre en el mismo orden, para que dos objetos con los
 * mismos datos den la misma huella aunque se hayan escrito en distinto orden.
 * @param {*} valor
 * @returns {string}
 */
function canonico(valor) {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  const claves = Object.keys(valor).sort();
  return `{${claves.map((c) => `${JSON.stringify(c)}:${canonico(valor[c])}`).join(',')}}`;
}

/**
 * El id de un trabajo: legible por delante para que la pantalla de Cola se pueda
 * leer, y con una huella por detrás para que no haya dos trabajos distintos con
 * el mismo id.
 * @param {string} tipo
 * @param {object} identidad los argumentos que definen «el mismo trabajo»
 * @returns {string}
 */
function idDeTrabajo(tipo, identidad) {
  const trozos = [];
  for (const clave of Object.keys(identidad)) {
    const valor = identidad[clave];
    if (valor === null || valor === undefined || valor === '') continue;
    if (typeof valor !== 'string' && typeof valor !== 'number') continue;
    const limpio = String(valor)
      .trim()
      .replace(/[^0-9A-Za-zÁÉÍÓÚÜÑáéíóúüñ._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
    if (limpio) trozos.push(limpio);
  }
  return [tipo, ...trozos, huella(canonico(identidad))].join('-');
}

// ---------------------------------------------------------------------------
// Los argumentos de cada tipo de trabajo
// ---------------------------------------------------------------------------

/**
 * Exige un argumento y, si no está, lo dice con palabras.
 * @param {object} args
 * @param {string[]} nombres el bueno primero; los demás son alias que se aceptan
 * @param {string} paraQue
 * @returns {string}
 */
function exigirArg(args, nombres, paraQue) {
  for (const nombre of nombres) {
    const valor = soloTexto(args[nombre]);
    if (valor) return valor;
  }
  throw new ErrorDeCara(
    `Se ha encolado un trabajo sin decir ${paraQue}. Es un fallo del propio estudio, no de tu ` +
      `cuenta: falta el campo «${nombres[0]}».`,
    { reintentable: false, http: 400 }
  );
}

/**
 * Deja los argumentos de cada tipo en su forma canónica y dice cuáles de ellos
 * definen «el mismo trabajo».
 *
 * Lo segundo es lo importante: la identidad es lo que entra en el id, y por eso
 * el manifiesto entero de un montaje NO entra (es enorme y cambia con cada
 * ajuste, pero sigue siendo el mismo trabajo) y las líneas de un alineado
 * tampoco (viajan con el trabajo, pero lo que se alinea es el bloque).
 */
const NORMALIZADORES = {
  placa(crudos) {
    const id = exigirArg(crudos, ['id', 'placa'], 'qué placa del banco se genera');
    const nivel = soloTexto(crudos.nivel);
    const args = nivel ? { id, nivel } : { id };
    return { args, identidad: args };
  },

  escenario(crudos) {
    const id = exigirArg(crudos, ['id', 'escenario'], 'qué escenario se genera');
    const nivel = soloTexto(crudos.nivel);
    const args = nivel ? { id, nivel } : { id };
    return { args, identidad: args };
  },

  keyframe(crudos) {
    const pieza = exigirArg(crudos, ['pieza'], 'de qué pieza es la toma');
    const id = exigirArg(crudos, ['id', 'toma'], 'de qué toma es el keyframe');
    const nivel = soloTexto(crudos.nivel);
    const args = nivel ? { pieza, id, nivel } : { pieza, id };
    return { args, identidad: args };
  },

  clip(crudos) {
    const pieza = exigirArg(crudos, ['pieza'], 'de qué pieza es la toma');
    const id = exigirArg(crudos, ['id', 'toma'], 'de qué toma se genera el clip');
    const args = { pieza, id };
    return { args, identidad: args };
  },

  'clip-consultar'(crudos) {
    const pieza = exigirArg(crudos, ['pieza'], 'de qué pieza es la toma');
    const id = exigirArg(crudos, ['id', 'toma'], 'de qué toma se consulta el clip');
    // El nombre de la operación NO viaja hasta aquí: lleva el project id dentro,
    // el censor lo tacharía —hace su trabajo— y quedaría un nombre roto con el
    // que ningún clip se puede recoger. Vive en el bucket y lo busca la función
    // por pieza y toma.
    const args = { pieza, id };
    return { args, identidad: args };
  },

  muestra(crudos) {
    const personaje = exigirArg(crudos, ['personaje'], 'de qué personaje es la frase de muestra');
    const voz_id = exigirArg(crudos, ['voz_id', 'voz'], 'qué voz candidata tiene que decirla');
    const args = { personaje, voz_id };
    return { args, identidad: args };
  },

  musica(crudos) {
    const pieza = exigirArg(crudos, ['pieza'], 'de qué pieza es esta música');
    const id = exigirArg(crudos, ['id', 'musica'], 'qué pieza de música se genera');
    const args = { pieza, id };
    return { args, identidad: args };
  },

  voz(crudos) {
    const pieza = exigirArg(crudos, ['pieza'], 'de qué pieza es el bloque de voz');
    const bloque = exigirArg(crudos, ['bloque'], 'qué bloque de voz se genera');
    const args = { pieza, bloque };
    return { args, identidad: args };
  },

  alinear(crudos) {
    const pieza = exigirArg(crudos, ['pieza'], 'de qué pieza es el bloque que se mide');
    const bloque = exigirArg(crudos, ['bloque'], 'qué bloque de voz se mide');
    const args = { pieza, bloque };
    const ruta = soloTexto(crudos.ruta);
    if (ruta) args.ruta = ruta;
    // Las líneas viajan dentro del trabajo porque quien agrupa un bloque es la
    // función, no el navegador: el que las tiene es quien acaba de generar la voz.
    if (Array.isArray(crudos.lineas) && crudos.lineas.length) {
      args.lineas = crudos.lineas
        .map((linea) => ({ ja: soloTexto(linea && linea.ja) }))
        .filter((linea) => linea.ja);
    }
    return { args, identidad: { pieza, bloque } };
  },

  'desglose-escena'(crudos) {
    const episodio = exigirArg(crudos, ['episodio'], 'de qué episodio es la escena');
    const escena = exigirArg(crudos, ['escena'], 'qué escena se desglosa');
    const args = { episodio, escena };
    return { args, identidad: args };
  },

  montaje(crudos) {
    const manifiesto = crudos.manifiesto;
    if (!manifiesto || typeof manifiesto !== 'object') {
      throw new ErrorDeCara(
        'Se ha encolado un montaje sin manifiesto. El manifiesto es lo único que recibe el ' +
          'montador: dice qué clip va en qué segundo, qué audio se mezcla y dónde se deja el ' +
          'resultado. Es un fallo del propio estudio, no de tu cuenta.',
        { reintentable: false, http: 400 }
      );
    }
    const trabajo = soloTexto(crudos.trabajo) || soloTexto(manifiesto.trabajo);
    if (!trabajo) {
      throw new ErrorDeCara(
        'El manifiesto de montaje no dice cómo se llama el trabajo, y ese nombre es la carpeta ' +
          'donde el montador deja su queja si algo sale mal. Es un fallo del propio estudio, no ' +
          'de tu cuenta.',
        { reintentable: false, http: 400 }
      );
    }
    const capa = soloTexto(crudos.capa) || soloTexto(manifiesto.capa) || 'pieza';
    const id = soloTexto(crudos.id) || trabajo;
    return { args: { trabajo, capa, id, manifiesto }, identidad: { trabajo, capa, id } };
  }
};

// ---------------------------------------------------------------------------
// Encolar
// ---------------------------------------------------------------------------

/**
 * Prepara un encolado: calcula el id y devuelve el cambio que hay que aplicar al
 * estado para meterlo. No escribe nada; quien lo llama decide cuándo.
 * @param {string} tipo
 * @param {object} args
 * @returns {{id:string, tipo:string, args:object, cambio:(estado:object)=>void}}
 */
function prepararEncolado(tipo, args) {
  const nombre = soloTexto(tipo);
  const normalizador = NORMALIZADORES[nombre];

  if (!normalizador || !EJECUTORES[nombre]) {
    throw new ErrorDeCara(
      `«${nombre || 'sin tipo'}» no es una clase de trabajo que la cola sepa hacer. Las que sabe ` +
        `son: ${Object.keys(NORMALIZADORES).join(', ')}. Es un fallo del propio estudio, no de tu ` +
        'cuenta.',
      { reintentable: false, http: 400 }
    );
  }

  const { args: limpios, identidad } = normalizador(args && typeof args === 'object' ? args : {});
  const id = idDeTrabajo(nombre, identidad);

  const cambio = (estado) => {
    const cola = colaDe(estado);
    const ya = buscarEnCola(estado, id);
    const cuando = ahoraIso();

    if (ya) {
      // Lo que ya está esperando o haciéndose no se toca: eso es no duplicar.
      if (ya.estado === PENDIENTE || ya.estado === EN_CURSO) return;

      // Lo terminado, fallido o detenido se revive. Es lo que hace que reencolar
      // sea seguro: pedir otra vez el mismo keyframe vuelve a ponerlo en marcha
      // sin crear un trabajo gemelo que nadie sabría distinguir.
      ya.args = limpios;
      ya.estado = PENDIENTE;
      ya.intentos = 0;
      ya.consultas = 0;
      ya.error = null;
      ya.detalle = null;
      ya.aviso = null;
      ya.operacion = null;
      ya.proximo = null;
      ya.actualizado = cuando;
      return;
    }

    cola.push({
      id,
      tipo: nombre,
      args: limpios,
      estado: PENDIENTE,
      intentos: 0,
      consultas: 0,
      error: null,
      detalle: null,
      aviso: null,
      operacion: null,
      proximo: null,
      creado: cuando,
      actualizado: cuando
    });
  };

  return { id, tipo: nombre, args: limpios, cambio };
}

/**
 * Mete un trabajo en la cola.
 *
 * No duplica: si ya hay uno idéntico pendiente o en curso, devuelve su id y no
 * hace nada más. Si lo que hay es uno terminado, fallido o detenido, lo revive.
 *
 * @param {string} tipo uno de `EJECUTORES`
 * @param {object} args los argumentos de ese tipo
 * @returns {string} el id del trabajo, que es siempre el mismo para los mismos
 *   argumentos
 */
export function encolar(tipo, args) {
  const { id, cambio } = prepararEncolado(tipo, args);
  escribirYa(cambio);
  ponerse();
  return id;
}

/**
 * Cómo va un trabajo, preguntando por lo mismo con lo que se encoló.
 *
 * Existe porque con una generación a la vez lo normal ya no es «se está
 * generando»: es «está esperando su turno». Una pantalla que solo sepa distinguir
 * hecho de no hecho deja al usuario mirando un botón que no hace nada aparente,
 * y pulsándolo otra vez.
 *
 * @param {string} tipo
 * @param {object} args los mismos que se le pasaron a `encolar`
 * @returns {string|null} `pendiente`, `en_curso`, `hecho`, `fallido`,
 *   `detenido`, o null si ese trabajo no está en la cola
 */
export function comoVa(tipo, args) {
  let id;
  try {
    id = prepararEncolado(tipo, args).id;
  } catch {
    return null; // Argumentos que no valen: no hay tal trabajo.
  }

  try {
    const trabajo = buscarEnCola(actual(), id);
    return trabajo ? trabajo.estado : null;
  } catch {
    return null; // Todavía no hay estado que mirar.
  }
}

/**
 * Cuántos trabajos hay por delante de este en la cola, sin contarlo a él.
 * Sirve para decir «el cuarto de la cola» en vez de un «esperando» sin más.
 *
 * @param {string} tipo
 * @param {object} args
 * @returns {number}
 */
export function cuantosPorDelante(tipo, args) {
  let id;
  try {
    id = prepararEncolado(tipo, args).id;
  } catch {
    return 0;
  }

  try {
    const cola = colaDe(actual());
    const donde = cola.findIndex((trabajo) => trabajo && trabajo.id === id);
    if (donde < 0) return 0;
    return cola
      .slice(0, donde)
      .filter((trabajo) => trabajo && (trabajo.estado === PENDIENTE || trabajo.estado === EN_CURSO))
      .length;
  } catch {
    return 0;
  }
}

/**
 * Mete muchos trabajos de una vez y con una sola escritura del estado. Es lo que
 * usa el botón de «desglosar el episodio» (24 escenas) o el de «generar los
 * keyframes que faltan» (400 planos): encolarlos uno a uno serían 400 escrituras.
 *
 * @param {{tipo:string, args:object}[]} trabajos
 * @returns {string[]} los ids, en el mismo orden
 */
export function encolarVarios(trabajos) {
  const lista = Array.isArray(trabajos) ? trabajos : [];
  const ids = [];
  const cambios = [];

  for (const uno of lista) {
    const { id, cambio } = prepararEncolado(uno && uno.tipo, uno && uno.args);
    ids.push(id);
    cambios.push(cambio);
  }

  if (cambios.length) {
    escribirYa((estado) => {
      for (const cambio of cambios) cambio(estado);
    });
    ponerse();
  }

  return ids;
}

// ---------------------------------------------------------------------------
// El cuaderno: agrupar los cambios del estado
// ---------------------------------------------------------------------------

/**
 * Apunta un cambio del estado que ha salido de un ejecutor. Si hay una tanda
 * abierta, se guarda para escribirlo con todos los demás al terminarla; si no la
 * hay —alguien ha llamado al ejecutor por su cuenta—, se escribe ya.
 *
 * SOLO LO USAN LOS EJECUTORES. Lo que viene de un botón se escribe en el acto con
 * `escribirYa()`: si un encolado esperase al final de la tanda, el usuario
 * pulsaría generar y no vería aparecer nada durante un minuto entero, que es lo
 * que tarda la tanda que estuviera corriendo.
 *
 * @param {(estado:object) => void} cambio
 */
function anotar(cambio) {
  if (cuaderno) {
    cuaderno.push(cambio);
    return;
  }
  escribirYa(cambio);
}

/**
 * Escribe un cambio del estado ahora mismo, pase lo que pase en la tanda.
 *
 * No se espera: quien pulsa un botón no puede quedarse mirando una pantalla
 * quieta mientras se guarda. Si la escritura falla se cuenta por pantalla, porque
 * perder un encolado en silencio significaría pulsar generar y que no pase nada
 * sin ninguna explicación.
 *
 * @param {(estado:object) => void} cambio
 */
function escribirYa(cambio) {
  cambiar((estado) => aplicarCambios([cambio], estado)).catch(contarFallo);
}

/**
 * Ejecuta algo con un cuaderno abierto y devuelve lo que anotó.
 * @param {() => Promise<*>} fn
 * @returns {Promise<{valor:*, cambios:Function[]}>}
 */
async function conCuaderno(fn) {
  const anterior = cuaderno;
  const mio = [];
  cuaderno = mio;
  try {
    const valor = await fn();
    return { valor, cambios: mio };
  } finally {
    cuaderno = anterior;
  }
}

/**
 * Aplica una lista de cambios sobre el estado, cada uno por su cuenta.
 *
 * Van uno a uno y protegidos: si apuntar el gasto de una imagen se rompiera
 * porque el contador tiene una forma rara, no puede llevarse por delante el
 * resto de la tanda —que incluye marcar los trabajos como hechos—. Lo que se
 * rompa se cuenta por pantalla y lo demás se guarda.
 *
 * @param {Function[]} cambios
 * @param {object} estado
 */
function aplicarCambios(cambios, estado) {
  for (const cambio of cambios) {
    try {
      cambio(estado);
    } catch (fallo) {
      contarFallo(fallo);
    }
  }
}

// ---------------------------------------------------------------------------
// Concurrencia
// ---------------------------------------------------------------------------

/**
 * Cuántas generaciones se admiten a la vez. Una. Siempre.
 *
 * Es una función y no una constante suelta porque el bucle pregunta por ella en
 * cada vuelta y así se lee lo que hace: no hay ningún caso en el que devuelva
 * otra cosa, y no se lee del estado —un valor viejo guardado en el bucket no
 * puede volver a poner tres—.
 *
 * @returns {number}
 */
export function concurrencia() {
  return A_LA_VEZ;
}

// ---------------------------------------------------------------------------
// Arrancar, detener, reanudar
// ---------------------------------------------------------------------------

/**
 * Pone el obrero a trabajar. Es idempotente: si ya está trabajando, no hace nada.
 *
 * No espera a que la cola se vacíe —eso puede llevar horas con 400 planos—: deja
 * el bucle en marcha y vuelve, para que la pantalla siga pintando. Lo que sí
 * espera es a tener el estado, porque sin él no hay cola que mirar.
 *
 * @returns {Promise<void>}
 */
export async function arrancar() {
  parado = false;
  if (bucleEnMarcha) return;

  await asegurarCopia();
  await revivirLoQueQuedoAMedias();

  if (bucleEnMarcha) return;
  bucleEnMarcha = true;

  // El bucle va por su cuenta. Quien ha llamado sigue pintando.
  bucle()
    .catch(contarFallo)
    .finally(() => {
      bucleEnMarcha = false;
    });
}

/**
 * El botón de detener: pone `detenido` en todo lo que estaba pendiente.
 *
 * NO ABORTA LO QUE YA ESTÁ EN CURSO, y no es un descuido. Una operación de Veo
 * lanzada sigue generándose en Google se mire o no se mire, y ya está pagada:
 * abandonarla la dejaría huérfana, con el clip terminado en el bucket y nadie
 * que lo recoja ni sepa que existe. Lo que se está haciendo se termina de hacer y
 * se apunta; lo que no ha empezado, ese sí se para.
 */
export function detener() {
  parado = true;
  escribirYa((estado) => {
    const cuando = ahoraIso();
    for (const trabajo of colaDe(estado)) {
      if (trabajo && trabajo.estado === PENDIENTE) {
        trabajo.estado = DETENIDO;
        trabajo.actualizado = cuando;
      }
    }
  });
  despertarBucle();
}

/**
 * Devuelve a la cola todo lo que se detuvo y vuelve a poner al obrero.
 */
export function reanudar() {
  parado = false;
  escribirYa((estado) => {
    const cuando = ahoraIso();
    for (const trabajo of colaDe(estado)) {
      if (trabajo && trabajo.estado === DETENIDO) {
        trabajo.estado = PENDIENTE;
        trabajo.actualizado = cuando;
      }
    }
  });
  ponerse();
}

/**
 * Si el obrero está trabajando ahora mismo.
 * @returns {boolean}
 */
export function corriendo() {
  return bucleEnMarcha;
}

/**
 * Cómo va la cola, para pintarlo.
 * @returns {{pendientes:number, enCurso:number, hechas:number, fallidas:number, detenidas:number}}
 */
export function resumen() {
  const cuenta = { pendientes: 0, enCurso: 0, hechas: 0, fallidas: 0, detenidas: 0 };

  let cola;
  try {
    cola = colaDe(actual());
  } catch {
    // Todavía no se ha traído el estado: no hay nada que contar, y una pantalla
    // que se pinte antes de tiempo no tiene por qué romperse por eso.
    return cuenta;
  }

  for (const trabajo of cola) {
    if (!trabajo) continue;
    if (trabajo.estado === PENDIENTE) cuenta.pendientes += 1;
    else if (trabajo.estado === EN_CURSO) cuenta.enCurso += 1;
    else if (trabajo.estado === HECHO) cuenta.hechas += 1;
    else if (trabajo.estado === FALLIDO) cuenta.fallidas += 1;
    else if (trabajo.estado === DETENIDO) cuenta.detenidas += 1;
  }

  return cuenta;
}

/** Arranca el bucle si no está parado y no corre ya. Sin esperar a nadie. */
function ponerse() {
  despertarBucle();
  if (parado || bucleEnMarcha) return;
  arrancar().catch(contarFallo);
}

// ---------------------------------------------------------------------------
// El bucle del obrero
// ---------------------------------------------------------------------------

/**
 * Coge tandas de trabajos y las hace, hasta que no queda nada que hacer o
 * alguien pulsa detener.
 * @returns {Promise<void>}
 */
async function bucle() {
  while (!parado) {
    const estado = actual();
    const cola = colaDe(estado);
    const ahora = Date.now();

    const listos = cola.filter(
      (trabajo) => trabajo && trabajo.estado === PENDIENTE && leToca(trabajo, ahora)
    );

    if (!listos.length) {
      const cuanto = cuantoQuedaParaAlgo(cola, ahora);
      if (cuanto === null) return; // No queda nada: el obrero se va a casa.
      await dormir(cuanto);
      // Al despertar puede haber trabajos huérfanos de otra pestaña que se cerró.
      await revivirHuerfanos();
      continue;
    }

    // EL HUECO SE CUENTA SOBRE EL ESTADO DEL BUCKET, no sobre esta pestaña.
    //
    // Un trabajo «en curso» lo está haciendo alguien: esta pestaña, o la que se
    // dejó abierta en el ordenador. Si el hueco se contara solo con lo que esta
    // pestaña tiene en vuelo, dos pestañas harían dos generaciones a la vez sin
    // enterarse la una de la otra, que es exactamente lo que no puede pasar con
    // estas cuotas. Contándolo aquí, «una cada vez» vale para todo el estudio y
    // no solo para esta ventana.
    //
    // Los huérfanos no cuentan: ese trabajo lo cogió un navegador que ya no
    // existe, y `revivirHuerfanos` lo devolverá a la cola.
    const trabajando = cola.filter(
      (trabajo) => trabajo && trabajo.estado === EN_CURSO && !pareceHuerfano(trabajo, ahora)
    ).length;

    const huecos = concurrencia() - trabajando;

    if (huecos < 1) {
      // Hay algo generándose. Se espera y se vuelve a mirar; si quien lo cogió
      // ya no está, el repaso de huérfanos lo devolverá a pendiente.
      await dormir(ESPERA_SI_HAY_ALGUIEN_MS);
      await revivirHuerfanos();
      continue;
    }

    const tanda = listos.slice(0, huecos);
    const cogidos = await cogerLaTanda(tanda);
    if (!cogidos.length) continue;

    for (const trabajo of cogidos) enVuelo.add(trabajo.id);
    const parar = empezarElLatido();
    try {
      const { valor: resoluciones, cambios } = await conCuaderno(() =>
        Promise.all(cogidos.map((trabajo) => ejecutarUno(trabajo)))
      );
      await escribirLaTanda(cambios, resoluciones);
    } finally {
      parar();
      for (const trabajo of cogidos) enVuelo.delete(trabajo.id);
    }
  }
}

/**
 * Marca en curso los trabajos de la tanda, con una sola escritura, y devuelve
 * los que de verdad se ha quedado esta pestaña.
 *
 * El filtro importa: entre leer la cola y escribirla puede haber pasado otra
 * pestaña y haberse llevado alguno. Como el cambio se aplica sobre el estado
 * fresco, lo que se coja aquí es lo que nadie más tenía cogido.
 *
 * @param {object[]} tanda
 * @returns {Promise<object[]>}
 */
async function cogerLaTanda(tanda) {
  const cogidos = [];

  await cambiar((estado) => {
    cogidos.length = 0;
    const ahora = Date.now();
    const cuando = ahoraIso();
    for (const candidato of tanda) {
      const trabajo = buscarEnCola(estado, candidato.id);
      if (!trabajo || trabajo.estado !== PENDIENTE || !leToca(trabajo, ahora)) continue;
      trabajo.estado = EN_CURSO;
      trabajo.actualizado = cuando;
      // Se trabaja sobre una copia suelta: lo que el ejecutor toque no puede
      // colarse en el estado sin pasar por una escritura.
      cogidos.push(clonar(trabajo));
    }
  });

  return cogidos;
}

/**
 * Hace un trabajo y cuenta cómo ha ido, sin lanzar nunca: un fallo suyo no puede
 * llevarse por delante la tanda entera.
 * @param {object} trabajo
 * @returns {Promise<object>} la resolución
 */
async function ejecutarUno(trabajo) {
  const ejecutor = EJECUTORES[trabajo.tipo];

  if (!ejecutor) {
    return {
      id: trabajo.id,
      fin: FALLIDO,
      mensaje:
        `Este trabajo dice ser de tipo «${trabajo.tipo}» y la cola no sabe hacer eso. Es un fallo ` +
        'del propio estudio, no de tu cuenta: bórralo de la cola y vuelve a pedirlo desde su ' +
        'pantalla.'
    };
  }

  try {
    await ejecutor(trabajo.args || {}, trabajo);
    return { id: trabajo.id, fin: HECHO };
  } catch (fallo) {
    if (fallo instanceof Aplazamiento) {
      return { id: trabajo.id, fin: 'espera', ms: fallo.ms, nota: fallo.nota };
    }
    const error = comoErrorDeCara(fallo, trabajo);
    return {
      id: trabajo.id,
      fin: error.reintentable ? 'reintentar' : FALLIDO,
      mensaje: error.mensaje,
      detalle: error.detalle
    };
  }
}

/**
 * La escritura de final de tanda: todo lo que anotaron los ejecutores y todos los
 * cambios de estado de los trabajos, de una vez.
 * @param {Function[]} cambios
 * @param {object[]} resoluciones
 * @returns {Promise<void>}
 */
async function escribirLaTanda(cambios, resoluciones) {
  try {
    await cambiar((estado) => {
      aplicarCambios(cambios, estado);

      const cuando = ahoraIso();
      for (const resolucion of resoluciones) {
        const trabajo = buscarEnCola(estado, resolucion.id);
        if (!trabajo) continue;
        trabajo.actualizado = cuando;
        resolver(trabajo, resolucion);
      }

      podar(colaDe(estado));
    });
  } catch (fallo) {
    // La tanda se ha hecho pero no se ha podido apuntar. Lo generado está en el
    // bucket —eso lo escribió la función— y los trabajos se quedan en curso; en
    // cuanto pasen los minutos del umbral, se revivirán y se volverán a intentar.
    contarFallo(fallo);
  }
}

/**
 * Deja un trabajo como corresponda a lo que ha pasado con él.
 * @param {object} trabajo
 * @param {object} resolucion
 */
function resolver(trabajo, resolucion) {
  if (resolucion.fin === HECHO) {
    trabajo.estado = HECHO;
    trabajo.error = null;
    trabajo.detalle = null;
    trabajo.proximo = null;
    return;
  }

  if (resolucion.fin === 'espera') {
    // No ha fallado: está esperando a que Google termine. No gasta un hueco de
    // concurrencia mientras espera, se aparta con su hora de próximo intento.
    trabajo.consultas = (Number(trabajo.consultas) || 0) + 1;
    trabajo.error = null;
    trabajo.detalle = resolucion.nota || null;
    trabajo.proximo = dentroDe(resolucion.ms);
    trabajo.estado = parado ? DETENIDO : PENDIENTE;
    return;
  }

  trabajo.intentos = (Number(trabajo.intentos) || 0) + 1;
  trabajo.error = resolucion.mensaje || null;
  trabajo.detalle = resolucion.detalle || null;

  if (resolucion.fin === 'reintentar' && trabajo.intentos <= ESPERAS_DE_REINTENTO.length) {
    trabajo.proximo = dentroDe(ESPERAS_DE_REINTENTO[trabajo.intentos - 1]);
    trabajo.estado = parado ? DETENIDO : PENDIENTE;
    return;
  }

  trabajo.estado = FALLIDO;
  trabajo.proximo = null;
}

/**
 * Tira los trabajos terminados más viejos cuando se acumulan demasiados. Lo
 * fallido no se tira nunca: es lo único que el usuario tiene que llegar a leer.
 * @param {object[]} cola
 */
function podar(cola) {
  const hechas = cola.filter((trabajo) => trabajo && trabajo.estado === HECHO);
  if (hechas.length <= MAX_HECHAS) return;

  const sobran = hechas
    .slice()
    .sort((a, b) => String(a.actualizado).localeCompare(String(b.actualizado)))
    .slice(0, hechas.length - MAX_HECHAS);

  const fuera = new Set(sobran.map((trabajo) => trabajo.id));
  for (let i = cola.length - 1; i >= 0; i -= 1) {
    if (cola[i] && fuera.has(cola[i].id)) cola.splice(i, 1);
  }
}

/**
 * Cuánto falta para que haya algo que hacer, en milisegundos. Null si no queda
 * nada: ni pendientes con su hora, ni nada en curso que pueda quedarse colgado.
 * @param {object[]} cola
 * @param {number} ahora
 * @returns {number|null}
 */
function cuantoQuedaParaAlgo(cola, ahora) {
  let cuanto = null;

  const antes = (candidato) => {
    if (cuanto === null || candidato < cuanto) cuanto = candidato;
  };

  for (const trabajo of cola) {
    if (!trabajo) continue;

    if (trabajo.estado === PENDIENTE) {
      const cuando = Date.parse(trabajo.proximo);
      antes(Number.isFinite(cuando) ? Math.max(0, cuando - ahora) : 0);
      continue;
    }

    // Lo que está en curso en otra pestaña —o en un navegador que ya se cerró—
    // hay que volver a mirarlo cuando le toque el umbral de huérfano.
    if (trabajo.estado === EN_CURSO && !enVuelo.has(trabajo.id)) {
      const desde = Date.parse(trabajo.actualizado);
      const cumple = (Number.isFinite(desde) ? desde : ahora) + UMBRAL_HUERFANO_MS;
      antes(Math.max(1000, cumple - ahora));
    }
  }

  return cuanto;
}

/** Duerme, y se deja despertar si llega trabajo nuevo. */
function dormir(ms) {
  return new Promise((sigue) => {
    const reloj = setTimeout(() => {
      despertar = null;
      sigue();
    }, Math.max(0, Number(ms) || 0));

    despertar = () => {
      clearTimeout(reloj);
      despertar = null;
      sigue();
    };
  });
}

/** Despierta al bucle si estaba durmiendo. */
function despertarBucle() {
  if (despertar) despertar();
}

// ---------------------------------------------------------------------------
// Lo que quedó a medias
// ---------------------------------------------------------------------------

/**
 * Devuelve a la cola los trabajos que se quedaron «en curso» en un navegador que
 * ya no existe. Se hace una vez al abrir y luego cada vez que el bucle se
 * despierta.
 * @returns {Promise<void>}
 */
async function revivirLoQueQuedoAMedias() {
  if (revivido) return;
  revivido = true;
  await revivirHuerfanos();
}

/**
 * Un trabajo en curso que lleva más del umbral sin moverse es un huérfano: nadie
 * lo está haciendo. Vuelve a pendiente.
 *
 * Con una excepción cara: un `clip` que ya tiene apuntada su operación de Veo ya
 * hizo su trabajo —lanzar— y volver a lanzarlo sería pagar el clip dos veces. Ese
 * se da por hecho, y quien recoge el vídeo es su consulta, que se encoló en el
 * mismo instante del lanzamiento.
 *
 * @returns {Promise<void>}
 */
/**
 * ¿Este trabajo en curso lo dejó tirado un navegador que ya no existe?
 *
 * Lo que está haciendo ESTA pestaña nunca es huérfano —lo dice `enVuelo`— y lo
 * que está haciendo otra tampoco, mientras siga latiendo: quien trabaja refresca
 * la hora del trabajo cada `LATIDO_DEL_TRABAJO_MS`. Sin latido durante
 * `UMBRAL_HUERFANO_MS`, no hay nadie.
 *
 * @param {object} trabajo
 * @param {number} ahora en milisegundos
 * @returns {boolean}
 */
function pareceHuerfano(trabajo, ahora) {
  if (!trabajo || trabajo.estado !== EN_CURSO) return false;
  if (enVuelo.has(trabajo.id)) return false;
  const desde = Date.parse(trabajo.actualizado);
  if (!Number.isFinite(desde)) return true; // Sin hora no hay a quién esperar.
  return ahora - desde >= UMBRAL_HUERFANO_MS;
}

/**
 * Dice «sigo aquí» mientras esta pestaña trabaja, refrescando la hora de lo que
 * tiene cogido. Devuelve cómo pararlo.
 *
 * Si el navegador se cierra o se recarga, los latidos paran solos y el trabajo
 * queda huérfano a los cuarenta y cinco segundos, no a los cuatro minutos.
 *
 * @returns {() => void}
 */
function empezarElLatido() {
  const reloj = setInterval(() => {
    if (!enVuelo.size) return;
    escribirYa((estado) => {
      const cuando = ahoraIso();
      for (const trabajo of colaDe(estado)) {
        if (trabajo && trabajo.estado === EN_CURSO && enVuelo.has(trabajo.id)) {
          trabajo.actualizado = cuando;
        }
      }
    });
  }, LATIDO_DEL_TRABAJO_MS);

  return () => clearInterval(reloj);
}

async function revivirHuerfanos() {
  let hayAlguno = false;

  try {
    const ahora = Date.now();
    for (const trabajo of colaDe(actual())) {
      if (!pareceHuerfano(trabajo, ahora)) continue;
      hayAlguno = true;
      break;
    }
  } catch {
    return; // Sin estado todavía no hay nada que revivir.
  }

  if (!hayAlguno) return;

  await cambiar((estado) => {
    const cuando = ahoraIso();
    const ahora = Date.now();
    for (const trabajo of colaDe(estado)) {
      if (!pareceHuerfano(trabajo, ahora)) continue;

      // Quién puede darse por hecho y quién no, y esto se decide por TIPO, no
      // por si hay una operación apuntada.
      //
      //   · `clip`: al lanzarlo se encoló su `clip-consultar` EN LA MISMA
      //     escritura, así que hay quien lo recoja. Darlo por hecho es correcto
      //     y relanzarlo costaría otro euro y dejaría la primera operación
      //     huérfana.
      //   · `montaje`: nadie lo recoge. Si se diera por hecho, no se llamaría
      //     nunca a `montaje-estado`, su salida no quedaría apuntada, y la
      //     pantalla seguiría viendo esa capa como sin montar. Vuelve a
      //     pendiente: su ejecutor ya es idempotente —si el trabajo trae
      //     operación, CONSULTA en vez de relanzar—, así que no se monta dos
      //     veces.
      //   · Los demás no llegaron a lanzar nada: vuelven a pendiente y ya está.
      //
      // Ojo con la condición: la operación de un clip vale `true`, no una
      // cadena, porque su nombre lleva el project id dentro y no viaja hasta el
      // navegador (contrato §13.5). Preguntar por una cadena aquí haría que
      // TODOS los clips se relanzaran, y eso es dinero.
      if (trabajo.tipo === 'clip' && trabajo.operacion) {
        trabajo.estado = HECHO;
      } else {
        trabajo.estado = PENDIENTE;
        trabajo.proximo = null;
      }
      trabajo.actualizado = cuando;
    }
  }).catch(contarFallo);
}

// ---------------------------------------------------------------------------
// Recuperar las operaciones de Veo
// ---------------------------------------------------------------------------

/**
 * Consulta todas las operaciones de Veo que quedaron en vuelo. Es lo primero que
 * hace la aplicación al abrirse, ANTES de lanzar nada nuevo.
 *
 * Por qué antes: una operación lanzada es un clip que Google ya está generando y
 * que ya está pagado. Si se lanzan cosas nuevas sin recoger las viejas, se ocupan
 * los huecos de concurrencia con trabajo nuevo mientras el trabajo terminado se
 * queda en el bucket sin que nadie lo apunte, y la toma sigue diciendo
 * «generando» para siempre.
 *
 * @returns {Promise<{consultadas:number, terminadas:number, enVuelo:number, fallidas:number}>}
 */
export async function recuperarOperaciones() {
  await asegurarCopia();
  await revivirLoQueQuedoAMedias();

  const estado = actual();
  const pendientes = operacionesEnCurso(estado);
  const cuenta = { consultadas: pendientes.length, terminadas: 0, enVuelo: 0, fallidas: 0 };
  if (!pendientes.length) return cuenta;

  // De una en una, como todo lo demás. Consultar una operación no genera nada y
  // es barato, pero sigue siendo una llamada a Vertex y con estas cuotas veinte
  // consultas a la vez cuentan igual que veinte generaciones.
  const tope = concurrencia();
  const cambios = [];

  for (let i = 0; i < pendientes.length; i += tope) {
    const lote = pendientes.slice(i, i + tope);
    const recogido = await conCuaderno(() => Promise.all(lote.map((una) => recogerOperacion(una))));
    for (const como of recogido.valor) {
      if (como === 'terminada') cuenta.terminadas += 1;
      else if (como === 'fallida') cuenta.fallidas += 1;
      else cuenta.enVuelo += 1;
    }
    cambios.push(...recogido.cambios);
  }

  // Una sola escritura para todas las operaciones recuperadas.
  if (cambios.length) {
    await cambiar((estado2) => aplicarCambios(cambios, estado2)).catch(contarFallo);
  }

  return cuenta;
}

/**
 * Todas las tomas que tienen una operación de Veo apuntada.
 * @param {object} estado
 * @returns {{pieza:string, toma:string}[]}
 */
function operacionesEnCurso(estado) {
  const tomas = estado && typeof estado.tomas === 'object' && estado.tomas ? estado.tomas : {};
  const encontradas = [];

  for (const [clave, entrada] of Object.entries(tomas)) {
    if (!entrada || typeof entrada !== 'object') continue;
    // `operacion_en_curso` llega como `true` desde la función, no como el nombre:
    // basta para saber que esa toma tiene vídeo en vuelo, que es lo único que el
    // navegador necesita saber.
    if (!entrada.operacion_en_curso) continue;
    const corte = String(clave).indexOf('/');
    if (corte <= 0) continue;
    encontradas.push({
      pieza: String(clave).slice(0, corte),
      toma: String(clave).slice(corte + 1)
    });
  }

  return encontradas;
}

/**
 * Pregunta por una operación recuperada y deja anotado lo que haya que anotar.
 * Sea cual sea el resultado, queda un trabajo de consulta en la cola con el mismo
 * id que habría creado el lanzamiento: así no salen dos consultas para el mismo
 * clip.
 * @param {{pieza:string, toma:string}} una
 * @returns {Promise<'terminada'|'fallida'|'enVuelo'>}
 */
async function recogerOperacion(una) {
  const { id, cambio } = prepararEncolado('clip-consultar', {
    pieza: una.pieza,
    id: una.toma
  });

  let respuesta;
  try {
    respuesta = await llamar('veo-consultar', {
      pieza: una.pieza,
      toma: una.toma
    });
  } catch (fallo) {
    // No se ha podido preguntar ahora. La consulta se queda encolada y el bucle
    // insistirá: la operación sigue viva en Google la mire quien la mire.
    const error = comoErrorDeCara(fallo, { tipo: 'clip-consultar', args: una });
    anotar((estado) => {
      cambio(estado);
      const trabajo = buscarEnCola(estado, id);
      if (trabajo && trabajo.estado === PENDIENTE) {
        trabajo.detalle = error.mensaje;
        trabajo.proximo = dentroDe(ESPERA_CONSULTA_BASE);
      }
    });
    return 'enVuelo';
  }

  if (!respuesta.hecho) {
    anotar((estado) => {
      cambio(estado);
      const trabajo = buscarEnCola(estado, id);
      if (trabajo && trabajo.estado === PENDIENTE) trabajo.proximo = dentroDe(ESPERA_CONSULTA_BASE);
    });
    return 'enVuelo';
  }

  if (respuesta.error) {
    const frase = fraseDeClipFallido(una.pieza, una.toma);
    anotar((estado) => {
      cambio(estado);
      limpiarOperacion(estado, `${una.pieza}/${una.toma}`);
      const trabajo = buscarEnCola(estado, id);
      if (trabajo) {
        trabajo.estado = FALLIDO;
        trabajo.error = frase;
        trabajo.detalle = String(respuesta.error);
        trabajo.actualizado = ahoraIso();
      }
    });
    return 'fallida';
  }

  const guardar = await cambioDeClipTerminado(una.pieza, una.toma, respuesta.ruta);
  anotar((estado) => {
    cambio(estado);
    guardar(estado);
    const trabajo = buscarEnCola(estado, id);
    if (trabajo) {
      trabajo.estado = HECHO;
      trabajo.error = null;
      trabajo.detalle = null;
      trabajo.proximo = null;
      trabajo.actualizado = ahoraIso();
    }
  });
  return 'terminada';
}

// ---------------------------------------------------------------------------
// Los ejecutores
// ---------------------------------------------------------------------------

/**
 * Lo que lanza un ejecutor cuando no ha fallado nada pero todavía no ha
 * terminado: Veo sigue generando, el montador sigue montando. No es un error y no
 * cuenta como intento; solo aparta el trabajo hasta la hora que diga.
 */
class Aplazamiento extends Error {
  /**
   * @param {number} ms cuánto esperar antes de volver a mirar
   * @param {string} nota qué está pasando, en español, para pintarlo
   */
  constructor(ms, nota) {
    super(nota);
    this.name = 'Aplazamiento';
    this.ms = ms;
    this.nota = nota;
  }
}

/**
 * Uno por cada tipo de trabajo. Todos dejan el resultado en el estado —con
 * `anotar()`, para que se escriba con el resto de la tanda— y, si algo va mal,
 * lanzan un `ErrorDeCara` cuyo `.mensaje` es la frase que se pinta.
 *
 * @type {Object<string, (args:object, trabajo:object) => Promise<void>>}
 */
export const EJECUTORES = {
  /** Una placa del banco de personajes. */
  async placa(args) {
    await generarImagen('placa', args);
  },

  /** Una placa de escenario. */
  async escenario(args) {
    await generarImagen('escenario', args);
  },

  /** El keyframe de una toma: lo que se mira para aprobar antes de gastar vídeo. */
  async keyframe(args) {
    await generarImagen('keyframe', args);
  },

  /**
   * Lanzar el clip de una toma. Es el trabajo caro: un keyframe malo cuesta
   * céntimos y un clip malo cuesta un euro, así que aquí se comprueba todo antes
   * de llamar a Veo.
   */
  async clip(args, trabajo) {
    const idPieza = args.pieza;
    const idToma = args.id;
    const clave = `${idPieza}/${idToma}`;

    const entrada = tomaDelEstado(actual(), clave);
    const keyframe = soloTexto(entrada.keyframe_aprobado);
    if (!keyframe) {
      throw new ErrorDeCara(
        `La toma ${idToma} no tiene keyframe aprobado, así que no se le genera vídeo. Un clip malo ` +
          'cuesta un euro y un keyframe malo cuesta céntimos: primero se mira la imagen y se ' +
          'aprueba, y solo entonces aparece el botón de generar el vídeo.',
        { reintentable: false, http: 400 }
      );
    }

    const laToma = await tomaDeLaSerie(idPieza, idToma);
    const siguiente = soloTexto(laToma.encadena_con);

    // El fotograma de enlace. Solo si esta toma encadena de verdad: mandarlo
    // cuando no toca haría que Veo interpolase hacia una imagen que no le
    // corresponde y el corte saldría hacia otro sitio.
    let keyframeSiguiente = '';
    if (siguiente) {
      const otra = tomaDelEstado(actual(), `${idPieza}/${siguiente}`);
      keyframeSiguiente = soloTexto(otra.keyframe_aprobado);
      if (!keyframeSiguiente) {
        throw new ErrorDeCara(
          `La toma ${idToma} encadena con ${siguiente}, y para encadenar hace falta el keyframe de ` +
            `${siguiente} aprobado: es la imagen a la que Veo tiene que llegar. Genera y aprueba ` +
            `antes el keyframe de ${siguiente} y vuelve a pedir este clip.`,
          { reintentable: false, http: 400 }
        );
      }
    }

    // Una sola llamada para firmar las dos: 400 planos no pueden ser 800
    // peticiones de firma.
    const rutas = keyframeSiguiente ? [keyframe, keyframeSiguiente] : [keyframe];
    const firmadas = await llamar('firmar', { rutas });
    const urls = (firmadas && firmadas.urls) || {};

    const reducida = await reducirParaVeo(exigirUrl(urls, keyframe));
    const enlace = keyframeSiguiente ? await reducirParaVeo(exigirUrl(urls, keyframeSiguiente)) : null;

    // El peso, ANTES de mandarlo. Pasarse de los 4,5 MB no da un «no cabe»: da un
    // corte que parece un tiempo agotado, y se busca el fallo donde no está.
    const pesa = pesoDeB64(reducida.b64) + (enlace ? pesoDeB64(enlace.b64) : 0);
    if (pesa > LIMITE_PETICION - MARGEN_PETICION) {
      throw new ErrorDeCara(
        `Las imágenes que hay que mandarle a Veo para la toma ${idToma} ocupan ${enBytes(pesa)} y la ` +
          `plataforma no admite más de ${enBytes(LIMITE_PETICION)} por petición, así que no cabe y ` +
          'no se manda: insistir no la haría más pequeña. Esto no debería pasar con un keyframe ' +
          'normal reducido a 1280 px; si pasa, el master de esa toma es rarísimo y conviene ' +
          'regenerarlo.',
        { reintentable: false, http: 413 }
      );
    }

    const lanzado = await llamar('veo-lanzar', {
      pieza: idPieza,
      toma: idToma,
      imagen_b64: reducida.b64,
      lastFrame_b64: enlace ? enlace.b64 : null
    });

    // AQUÍ NO SE ESPERA A LA TANDA. La operación está lanzada y pagada: se
    // escribe ahora mismo, con la consulta que la recogerá dentro de la misma
    // escritura. Si el móvil se apaga en este instante, al volver a abrir la
    // aplicación la operación está apuntada y la consulta está encolada.
    const consulta = prepararEncolado('clip-consultar', {
      pieza: idPieza,
      id: idToma
    });

    const aviso = lanzado.aviso_sin_lastframe
      ? `Veo ha rechazado el fotograma de enlace de ${siguiente || 'la toma siguiente'} y ha generado ` +
        'el clip sin él, con el mismo modelo. La interpolación hacia la toma siguiente puede no ' +
        'llegar al corte: míralo antes de darlo por bueno.'
      : null;

    await cambiar((estado) => {
      const suyo = buscarEnCola(estado, trabajo.id);
      if (suyo) {
        suyo.operacion = true;
        suyo.aviso = aviso;
        suyo.actualizado = ahoraIso();
      }
      consulta.cambio(estado);

      // La función ya apuntó el NOMBRE en el bucket antes de contestar, y ese
      // nombre no viaja hasta aquí. Esto solo deja la copia del navegador
      // marcando que hay vídeo en vuelo; al guardar, la función conserva el
      // nombre bueno y no acepta ninguno de los que mande el navegador.
      const suya = entradaDeToma(estado, clave);
      suya.operacion_en_curso = true;
      if (!suya.operacion_prefijo && soloTexto(lanzado.prefijo)) {
        suya.operacion_prefijo = true;
      }
    });
  },

  /**
   * Preguntar por un clip lanzado. Si sigue generándose no se queda ocupando un
   * hueco de concurrencia: se aparta con su hora y vuelve solo.
   */
  async 'clip-consultar'(args, trabajo) {
    const idPieza = args.pieza;
    const idToma = args.id;
    const clave = `${idPieza}/${idToma}`;

    const respuesta = await llamar('veo-consultar', {
      pieza: idPieza,
      toma: idToma,
      operacion: args.operacion
    });

    if (!respuesta.hecho) {
      const consultas = Number(trabajo.consultas) || 0;
      throw new Aplazamiento(
        Math.min(ESPERA_CONSULTA_BASE * (1 + consultas), ESPERA_CONSULTA_MAX),
        `Veo sigue generando el clip de ${idToma}. Se vuelve a preguntar solo; no hace falta ` +
          'tener la pantalla abierta.'
      );
    }

    if (respuesta.error) {
      anotar((estado) => limpiarOperacion(estado, clave));
      throw new ErrorDeCara(fraseDeClipFallido(idPieza, idToma), {
        detalle: String(respuesta.error),
        reintentable: false,
        http: 500
      });
    }

    const guardar = await cambioDeClipTerminado(idPieza, idToma, respuesta.ruta);
    anotar(guardar);
  },

  /** Una pieza de música de Lyria. */
  /**
   * Una frase de muestra de un personaje con una voz candidata, para elegirle
   * voz escuchándola.
   *
   * POR QUÉ PASA POR LA COLA. Antes la pantalla de Voces la pedía directamente,
   * saltándose todo esto. Pulsar «Oír esta voz» en tres candidatas disparaba tres
   * llamadas a la vez —y cada una lleva dentro una traducción al japonés, que es
   * otra llamada más—, y lo que volvía era un 429 de cuota que se lee como falta
   * de acceso al modelo. Encolada, se pide una y hasta que no termina no empieza
   * la siguiente.
   *
   * Aquí no se apunta nada en el estado: la función ya deja la muestra apuntada
   * antes de contestar. Encolarla solo sirve para que espere su turno.
   */
  async muestra(args) {
    await llamar('voz-muestra', { personaje: args.personaje, voz_id: args.voz_id });
  },

  async musica(args) {
    const hecho = await llamar('musica', { pieza: args.pieza, id: args.id });
    const durS = Number(hecho.dur_s) || 0;

    anotar((estado) => {
      const entrada = entradaDeAudio(estado, 'musica', args.id);
      entrada.ruta = hecho.ruta;
      entrada.dur_s = durS;
      entrada.aprobada = false; // Es una grabación nueva: se escucha antes de usarla.
      apuntarIntento(entrada, 'intentos', hecho.ruta);
      anotarGasto(estado, 'musica_s', null, durS);
    });
  },

  /**
   * Un bloque de voz entero, con todas sus líneas y hasta dos hablantes en una
   * sola llamada. Al terminar encola su medida de tiempos, porque los subtítulos
   * se escriben con los tiempos reales del audio y no con los estimados.
   */
  async voz(args) {
    const hecho = await llamar('voz', { pieza: args.pieza, bloque: args.bloque });
    const durS = Number(hecho.dur_s) || 0;
    const clave = `${args.pieza}/${args.bloque}`;
    const lineas = Array.isArray(hecho.lineas) ? hecho.lineas : [];

    anotar((estado) => {
      const entrada = entradaDeAudio(estado, 'voz', clave);
      entrada.ruta = hecho.ruta;
      entrada.dur_s = durS;
      entrada.aprobada = false;
      // Los tiempos que hubiera eran de la grabación anterior. Dejarlos puestos
      // desplazaría todos los subtítulos de la pieza.
      entrada.lineas = lineas.map(() => ({ inicio: 0, fin: 0 }));
      apuntarIntento(entrada, 'intentos', hecho.ruta);
      anotarGasto(estado, 'voz_s', null, durS);
    });

    if (lineas.length) {
      encolar('alinear', {
        pieza: args.pieza,
        bloque: args.bloque,
        ruta: hecho.ruta,
        lineas: lineas.map((linea) => ({ ja: linea.ja }))
      });
    }
  },

  /** Medir dónde entra y dónde sale cada línea dentro del WAV de un bloque. */
  async alinear(args) {
    const clave = `${args.pieza}/${args.bloque}`;
    const guardado = audioDelEstado(actual(), 'voz', clave);
    const ruta = soloTexto(args.ruta) || soloTexto(guardado.ruta);

    if (!ruta) {
      throw new ErrorDeCara(
        `Todavía no hay ninguna grabación del bloque «${args.bloque}» de la pieza «${args.pieza}», ` +
          'así que no hay nada que medir. Genera antes su voz desde la pantalla de Audio y los ' +
          'tiempos se miden solos justo después.',
        { reintentable: false, http: 400 }
      );
    }

    const lineas = await lineasQueSeMiden(args);
    const medido = await llamar('alinear', { ruta, lineas });
    const medidas = Array.isArray(medido.lineas) ? medido.lineas : [];

    anotar((estado) => {
      const entrada = entradaDeAudio(estado, 'voz', clave);
      entrada.lineas = medidas.map((linea) => ({
        inicio: Number(linea.inicio) || 0,
        fin: Number(linea.fin) || 0
      }));
    });
  },

  /**
   * Desglosar UNA escena del guion en planos. Una llamada por escena, pequeña e
   * independiente: ni una por episodio (no cabe, y al fallar se pierden las 24)
   * ni una por plano (no puede decidir cuántos planos hay, que es lo que se le
   * está preguntando).
   */
  async 'desglose-escena'(args) {
    const salido = await llamar('desglosar-escena', {
      episodio: args.episodio,
      escena: args.escena
    });

    const planos = Array.isArray(salido.planos) ? salido.planos : [];
    if (!planos.length) {
      throw new ErrorDeCara(
        `El desglose de la escena ${args.escena} del episodio ${args.episodio} ha vuelto sin ningún ` +
          'plano. Vuelve a pedirlo: cada desglose es una llamada independiente y pedir otro no ' +
          'toca nada de lo que ya está desglosado.',
        { reintentable: true, http: 500 }
      );
    }

    // Los planos se guardan en el bucket, que es lo único que esta aplicación
    // puede escribir. Desde ahí se llevan a `piezas` de datos/serie.json, que va
    // en el repositorio y no se puede tocar desde el teléfono.
    //
    // FALTA EN EL CONTRATO: el plan de construcción §7 dice que los planos «se
    // escriben directamente como una pieza nueva en serie.json», pero serie.json
    // es un archivo del repositorio y el navegador no puede escribirlo. Se dejan
    // en `desglose/{episodio}/{escena}.json` dentro del bucket y se apunta en
    // `estado.desglose` qué escenas están hechas. Que se revise dónde debe
    // quedar el paso de ahí a serie.json.
    const ruta = `desglose/${args.episodio}/${args.escena}.json`;
    const cuando = ahoraIso();
    await llamar('guardar-texto', {
      ruta,
      contenido: JSON.stringify(
        { episodio: args.episodio, escena: args.escena, cuando, planos },
        null,
        2
      )
    });

    anotar((estado) => {
      if (!estado.desglose || typeof estado.desglose !== 'object') estado.desglose = {};
      estado.desglose[`${args.episodio}/${args.escena}`] = { ruta, planos: planos.length, cuando };
    });
  },

  /**
   * Un montaje: se lanza el Job de Cloud Run y se pregunta hasta que termina. La
   * ejecución se apunta en el trabajo en cuanto se lanza, igual que la operación
   * de Veo: un montaje huérfano es media hora de ffmpeg que nadie recoge.
   */
  async montaje(args, trabajo) {
    let ejecucion = soloTexto(trabajo.operacion);

    if (!ejecucion) {
      const lanzado = await llamar('montar', { manifiesto: args.manifiesto });
      ejecucion = soloTexto(lanzado.ejecucion);

      await cambiar((estado) => {
        const suyo = buscarEnCola(estado, trabajo.id);
        if (suyo) {
          suyo.operacion = ejecucion;
          suyo.actualizado = ahoraIso();
        }
      });

      trabajo.operacion = ejecucion;
      throw new Aplazamiento(
        ESPERA_MONTAJE_BASE,
        `El montaje «${args.trabajo}» se está haciendo en la nube. Tarda minutos y no hace falta ` +
          'tener la pantalla abierta.'
      );
    }

    const como = await llamar('montaje-estado', { ejecucion });

    if (!como.hecho) {
      const consultas = Number(trabajo.consultas) || 0;
      throw new Aplazamiento(
        Math.min(ESPERA_MONTAJE_BASE * (1 + consultas), ESPERA_MONTAJE_MAX),
        `El montaje «${args.trabajo}» sigue en marcha.`
      );
    }

    if (!como.bien) {
      throw new ErrorDeCara(
        `El montaje «${args.trabajo}» no ha salido. Esto es lo que ha dejado escrito el montador ` +
          'antes de parar, tal cual: debajo está su queja. Cada capa se guarda por separado, así ' +
          'que lo que ya estuviera montado sigue estando y no hay que rehacerlo.',
        {
          detalle: como.queja || 'El montador no ha dejado ninguna queja escrita.',
          reintentable: false,
          http: 500
        }
      );
    }

    const salidas = Array.isArray(como.salidas) ? como.salidas.filter(Boolean) : [];
    const cuando = ahoraIso();

    anotar((estado) => {
      if (!Array.isArray(estado.montajes)) estado.montajes = [];
      for (const salida of salidas) {
        const ruta = soloTexto(salida);
        if (!ruta) continue;
        const yaEsta = estado.montajes.some((uno) => uno && uno.ruta === ruta);
        if (yaEsta) continue;
        estado.montajes.push({ ruta, capa: args.capa, id: args.id, cuando });
      }
    });
  }
};

// ---------------------------------------------------------------------------
// Piezas compartidas de los ejecutores
// ---------------------------------------------------------------------------

/**
 * Genera una placa, un escenario o un keyframe. Los tres son la misma llamada con
 * distinto `tipo`, y el PNG de 2K no viaja: se queda en el bucket.
 * @param {'placa'|'escenario'|'keyframe'} tipo
 * @param {object} args
 * @returns {Promise<void>}
 */
async function generarImagen(tipo, args) {
  const campos = { tipo, id: args.id };
  if (tipo === 'keyframe') campos.pieza = args.pieza;

  const nivel = soloTexto(args.nivel);
  if (nivel) campos.nivel = nivel;

  const hecho = await llamar('imagen', campos);

  // El gasto se apunta por nivel, y el nivel que se ha usado de verdad es el que
  // se pidió o el que serie.json tiene por defecto. Aquí no se escribe ninguno.
  const usado = nivel || (await nivelDeImagenPorDefecto());

  anotar((estado) => {
    if (tipo === 'keyframe') {
      const entrada = entradaDeToma(estado, `${args.pieza}/${args.id}`);
      apuntarIntento(entrada, 'intentos_keyframe', hecho.ruta);
    } else {
      const donde = tipo === 'placa' ? 'banco' : 'escenarios';
      apuntarIntento(entradaAprobable(estado, donde, args.id), 'intentos', hecho.ruta);
    }
    anotarGasto(estado, 'imagen', usado, 1);
  });
}

/**
 * El cambio que deja apuntado un clip terminado: se limpia la operación, se
 * apunta el intento y se suma el gasto de vídeo.
 *
 * El gasto necesita saber el nivel de Veo y los segundos que se han generado, y
 * eso está en la serie. Si la serie no se puede leer en ese momento, el clip se
 * apunta igual y lo único que se pierde es el contador: quedarse sin el vídeo por
 * no poder contar lo que ha costado sería el peor cambio posible.
 *
 * @param {string} idPieza
 * @param {string} idToma
 * @param {string} ruta
 * @returns {Promise<(estado:object) => void>}
 */
async function cambioDeClipTerminado(idPieza, idToma, ruta) {
  let laToma = null;
  try {
    laToma = await tomaDeLaSerie(idPieza, idToma);
  } catch (fallo) {
    contarFallo(fallo);
  }

  return (estado) => {
    const entrada = entradaDeToma(estado, `${idPieza}/${idToma}`);
    entrada.operacion_en_curso = null;
    entrada.operacion_prefijo = null;
    apuntarIntento(entrada, 'intentos_clip', ruta);
    if (laToma) anotarGasto(estado, 'video_s', laToma.veo, Number(laToma.dur_gen) || 0);
  };
}

/**
 * Las líneas que se le mandan a la medida de tiempos.
 *
 * Lo normal es que viajen dentro del trabajo, porque quien agrupa las líneas en
 * bloques es la función y el que las tiene delante es quien acaba de generar la
 * voz. Para una pieza corta —el teaser— el bloque es un personaje, y entonces se
 * pueden sacar de la serie sin repetir aquí ningún criterio de agrupación.
 *
 * @param {object} args
 * @returns {Promise<{ja:string}[]>}
 */
async function lineasQueSeMiden(args) {
  if (Array.isArray(args.lineas) && args.lineas.length) {
    return args.lineas.map((linea) => ({ ja: linea.ja }));
  }

  const datos = await serie();
  const laPieza = datos && datos.piezas ? datos.piezas[args.pieza] : null;
  const tomas = (laPieza && laPieza.tomas) || [];
  const esCorta = !tomas.some((una) => una && una.escena !== undefined && una.escena !== null);
  const voz = (laPieza && laPieza.audio && laPieza.audio.voz) || [];

  if (esCorta && voz.length) {
    // En una pieza corta cada bloque es un personaje, en el orden en que habla.
    const suyas = voz
      .filter((linea) => linea && linea.quien === args.bloque)
      .sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0))
      .map((linea) => ({ ja: soloTexto(linea.ja) }))
      .filter((linea) => linea.ja);
    if (suyas.length) return suyas;
  }

  throw new ErrorDeCara(
    `No se sabe qué líneas hay dentro de la grabación del bloque «${args.bloque}». Los bloques los ` +
      'agrupa la función, no el navegador, así que las líneas viajan con el trabajo: vuelve a ' +
      'generar la voz de ese bloque desde la pantalla de Audio y la medida de tiempos se encola ' +
      'sola con sus líneas puestas.',
    { reintentable: false, http: 400 }
  );
}

/** La URL firmada de una ruta, o una queja con palabras si no ha venido. */
function exigirUrl(urls, ruta) {
  const url = soloTexto(urls[ruta]);
  if (url) return url;
  throw new ErrorDeCara(
    `No se ha podido conseguir un enlace para mirar «${ruta}», así que tampoco se puede reducir la ` +
      'imagen para mandársela a Veo. Vuelve a intentarlo; si sigue igual, mira en la pantalla de ' +
      'Salud si el bucket se lee bien.',
    { reintentable: true, http: 500 }
  );
}

/** La frase que se pinta cuando Veo termina sin clip. El detalle va aparte. */
function fraseDeClipFallido(idPieza, idToma) {
  return (
    `Veo ha terminado la generación del clip de ${idToma} (pieza «${idPieza}») sin dejar ningún ` +
    'vídeo. Casi siempre es el filtro de contenido, que se queda con el clip y da la operación por ' +
    'buena igualmente; entonces hay que cambiar lo que se le pide a esa toma en datos/serie.json. ' +
    'Debajo está lo que ha dicho Google, tal cual.'
  );
}

// ---------------------------------------------------------------------------
// Trozos del estado
// ---------------------------------------------------------------------------

/** La entrada de una toma tal como está, sin crear nada. */
function tomaDelEstado(estado, clave) {
  const tomas = estado && typeof estado.tomas === 'object' && estado.tomas ? estado.tomas : {};
  const entrada = tomas[clave];
  return entrada && typeof entrada === 'object' ? entrada : {};
}

/** La entrada de una toma, creada con la forma del contrato §5 si no estaba. */
function entradaDeToma(estado, clave) {
  if (!estado.tomas || typeof estado.tomas !== 'object') estado.tomas = {};
  const entrada = estado.tomas[clave];
  if (entrada && typeof entrada === 'object') return entrada;
  estado.tomas[clave] = {
    keyframe_aprobado: null,
    intentos_keyframe: [],
    clip_elegido: null,
    intentos_clip: [],
    operacion_en_curso: null
  };
  return estado.tomas[clave];
}

/** Deja una toma sin operación en vuelo. Idempotente. */
function limpiarOperacion(estado, clave) {
  const entrada = entradaDeToma(estado, clave);
  entrada.operacion_en_curso = null;
  entrada.operacion_prefijo = null;
}

/** La entrada de una placa del banco o de un escenario, creada si no estaba. */
function entradaAprobable(estado, donde, id) {
  if (!estado[donde] || typeof estado[donde] !== 'object') estado[donde] = {};
  const entrada = estado[donde][id];
  if (entrada && typeof entrada === 'object') return entrada;
  estado[donde][id] = { aprobada: null, intentos: [] };
  return estado[donde][id];
}

/** La entrada de audio tal como está, sin crear nada. */
function audioDelEstado(estado, pista, clave) {
  const audio = estado && typeof estado.audio === 'object' && estado.audio ? estado.audio : {};
  const mapa = audio[pista] && typeof audio[pista] === 'object' ? audio[pista] : {};
  const entrada = mapa[clave];
  return entrada && typeof entrada === 'object' ? entrada : {};
}

/** La entrada de audio, creada con la forma del contrato §5 si no estaba. */
function entradaDeAudio(estado, pista, clave) {
  if (!estado.audio || typeof estado.audio !== 'object') estado.audio = { musica: {}, voz: {} };
  if (!estado.audio[pista] || typeof estado.audio[pista] !== 'object') estado.audio[pista] = {};
  const entrada = estado.audio[pista][clave];
  if (entrada && typeof entrada === 'object') return entrada;
  estado.audio[pista][clave] = { ruta: null, dur_s: 0, aprobada: false, lineas: [], intentos: [] };
  return estado.audio[pista][clave];
}

/**
 * Apunta un intento si no estaba ya apuntado.
 *
 * El «si no estaba» es lo que permite que este cambio se aplique dos veces —que
 * es lo que pasa cuando el bucket contesta 409 y hay que rehacerlo sobre el
 * estado fresco, que a lo mejor ya lo trae porque lo escribió la función—.
 *
 * @param {object} entrada
 * @param {string} campo
 * @param {string} ruta
 */
function apuntarIntento(entrada, campo, ruta) {
  const limpia = soloTexto(ruta);
  if (!limpia) return;
  if (!Array.isArray(entrada[campo])) entrada[campo] = [];
  if (!entrada[campo].includes(limpia)) entrada[campo].push(limpia);
}

// ---------------------------------------------------------------------------
// Menudencias
// ---------------------------------------------------------------------------

/** Se asegura de que hay copia del estado en memoria. */
async function asegurarCopia() {
  try {
    actual();
  } catch {
    await cargar();
  }
}

/** Una copia suelta de un trabajo, para que un ejecutor no toque el estado. */
function clonar(valor) {
  if (typeof structuredClone === 'function') return structuredClone(valor);
  return JSON.parse(JSON.stringify(valor));
}

/**
 * Cualquier cosa que se haya lanzado, convertida en el error que se enseña.
 *
 * Un `ErrorDeCara` ya viene con su frase en español; lo que llegue de otro sitio
 * —un fallo del propio navegador— no puede salir a pantalla tal cual, porque
 * estaría en inglés y no diría qué hacer.
 *
 * @param {*} fallo
 * @param {object} trabajo
 * @returns {ErrorDeCara}
 */
function comoErrorDeCara(fallo, trabajo) {
  if (fallo instanceof ErrorDeCara) return fallo;

  const que = trabajo && trabajo.tipo ? `«${trabajo.tipo}»` : 'este trabajo';
  return new ErrorDeCara(
    `El estudio se ha roto por dentro haciendo ${que}. No es un problema de tu cuenta ni de la nube: ` +
      'es un fallo del propio código. Debajo está lo que dijo el navegador, tal cual.',
    {
      detalle: fallo && fallo.message ? String(fallo.message) : String(fallo),
      reintentable: false,
      http: 500
    }
  );
}

/**
 * Cuenta un fallo que no cabe dentro de ningún trabajo: no se ha podido guardar
 * la cola, no se ha podido leer la serie. Se dispara el evento para que la
 * pantalla lo enseñe, y se deja también por consola por si nadie escucha.
 * @param {*} fallo
 */
function contarFallo(fallo) {
  const error = comoErrorDeCara(fallo, null);
  console.error('La cola no ha podido hacer algo', fallo);
  try {
    window.dispatchEvent(
      new CustomEvent(EVENTO_FALLO_DE_COLA, {
        detail: { mensaje: error.mensaje, detalle: error.detalle }
      })
    );
  } catch {
    // Un navegador sin eventos personalizados no existe, pero si existiera, lo
    // de la consola ya está dicho y la aplicación sigue funcionando.
  }
}
