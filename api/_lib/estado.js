// El estado de la producción: `estado.json` en el bucket.
//
// El bucket es la única verdad y el navegador solo tiene copia (plan §2). Este
// archivo es el que sabe qué forma tiene esa verdad, cómo se lee, cómo se
// guarda sin pisar el trabajo de otro, y qué hace falta tener aprobado antes de
// gastar dinero. La forma exacta es la de docs/contrato.md §5, carácter por
// carácter, y no se inventa ni un campo aquí.
//
// LAS TRES IDEAS QUE SOSTIENEN ESTE ARCHIVO:
//
//  1. `asegurar()` ES IDEMPOTENTE, Y POR ESO ESCALA. El estado no se «migra» ni
//     se «inicializa una vez»: se asegura cada vez que se lee. Se recorre
//     serie.json entero y se crea lo que falte —una entrada por placa, por
//     escenario, por toma de cada pieza, por pieza de música, por bloque de voz
//     y por personaje del reparto— sin tocar lo que ya está. Así, el día que se
//     desglose el episodio 1 y aparezcan sus ~400 tomas en serie.json, no hay
//     nada que ejecutar: se vuelve a leer el estado y ya están ahí, en cero.
//
//  2. NUNCA SE BORRA LO QUE NO SE ENTIENDE. Si el estado trae una entrada de una
//     pieza que ya no está en serie.json, se deja: detrás de esa entrada hay
//     imágenes y clips pagados. Asegurar añade y normaliza huecos; no limpia.
//     Por la misma razón `intentos`, `cola` y `montajes` solo se comprueban como
//     listas: lo que haya dentro es de quien lo escribió.
//
//  3. LA APROBACIÓN ES UN CERROJO, NO UN AVISO. `exigirAprobada()` es la mitad
//     de servidor del invariante «ninguna toma genera vídeo con
//     `keyframe_aprobado` en null» (contrato §5). La otra mitad la pone la
//     interfaz, que ni siquiera enseña el botón. Dos cerrojos, y este contesta
//     con una frase que dice qué falta y para qué hacía falta, nunca con un
//     código.
//
// Y una cuarta, que es de dinero: `operacionesPendientes()` existe para que
// ninguna operación de Veo quede huérfana. Una operación lanzada y olvidada es
// un clip pagado que nadie recoge, y la toma se queda «generando» para siempre.

import {
  serie,
  pieza,
  placa,
  placasDePersonaje,
  bloquesDeVoz
} from './datos.js';
import { ErrorDeCara } from './errores.js';
import { leer as leerDelBucket, escribir as escribirEnElBucket } from './gcs.js';

/** Versión del esquema de docs/contrato.md §5. */
const VERSION = 1;

/** El tipo con el que se sube `estado.json`. */
const TIPO_JSON = 'application/json; charset=utf-8';

/** Los cuatro tipos que se pueden aprobar, tal cual los nombra el contrato. */
const TIPOS = ['banco', 'escenario', 'keyframe', 'clip'];

// ---------------------------------------------------------------------------
// Utilidades pequeñas
// ---------------------------------------------------------------------------

/** Un objeto de verdad: ni null, ni array, ni cadena. */
function esObjeto(valor) {
  return Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);
}

/** Copia honda, para no compartir nada con la plantilla ni con quien llame. */
function clonar(valor) {
  if (typeof structuredClone === 'function') return structuredClone(valor);
  return JSON.parse(JSON.stringify(valor));
}

/** Congela hasta el fondo. Solo se usa con ESTADO_VACIO, que es una plantilla. */
function congelar(valor) {
  if (valor && typeof valor === 'object') {
    for (const dentro of Object.values(valor)) congelar(dentro);
    Object.freeze(valor);
  }
  return valor;
}

/** Un contador nunca es negativo ni «NaN»: si no se entiende, vale cero. */
function aNumero(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? numero : 0;
}

/**
 * Una ruta aprobada es una cadena con algo dentro; el hueco es null.
 * No se toca lo que no sea ni una cosa ni la otra: si alguien guardó ahí algo
 * raro, borrarlo sería perder el rastro de un archivo ya pagado.
 */
function normalizarRuta(valor) {
  if (valor === undefined) return null;
  if (typeof valor === 'string') return valor.trim() ? valor : null;
  return valor;
}

/** Devuelve el mapa que hay en `contenedor[clave]`, creándolo si no está. */
function mapaDe(contenedor, clave) {
  if (!esObjeto(contenedor[clave])) contenedor[clave] = {};
  return contenedor[clave];
}

/** Se asegura de que `contenedor[clave]` es una lista, sin mirar qué lleva. */
function listaDe(contenedor, clave) {
  if (!Array.isArray(contenedor[clave])) contenedor[clave] = [];
  return contenedor[clave];
}

/**
 * Los niveles que hay escritos en una familia de modelos de serie.json.
 * Se filtran por «tiene id», porque al lado de los niveles viven `por_defecto`,
 * `protocolo`, `nota` y `parametros`, que no son niveles. Se leen de los datos y
 * no se escriben aquí para que añadir un cuarto nivel a serie.json no obligue a
 * tocar este archivo. Aquí no hay ningún id de modelo: solo los nombres de los
 * niveles, que son los mismos que usa la interfaz.
 */
function nivelesDe(familia) {
  const seccion = (serie.modelos && serie.modelos[familia]) || {};
  const niveles = Object.entries(seccion)
    .filter(([, valor]) => esObjeto(valor) && typeof valor.id === 'string')
    .map(([nombre]) => nombre);
  return niveles.length ? niveles : ['calidad', 'medio', 'economico'];
}

/**
 * Las dos resoluciones de imagen que se pueden elegir. Son el otro multiplicador
 * del gasto además del nivel: la misma imagen a 2K cuesta bastante más que a 1K,
 * y para juzgar un keyframe 1K sobra. `null` significa la que diga serie.json.
 */
const RESOLUCIONES = ['1K', '2K'];

/**
 * Un nivel que exista de verdad en esa familia, o `null` para «lo que digan los
 * datos». Cualquier otra cosa —un nivel inventado, un número, un objeto— se
 * queda en `null` en vez de romper: un ajuste mal escrito no puede impedir que
 * se lea el estado, que es de donde cuelga todo lo demás.
 */
function nivelODeLosDatos(valor, familia) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  return texto && nivelesDe(familia).includes(texto) ? texto : null;
}

/** La ruta lógica de `estado.json`, que la escribe serie.json en `rutas`. */
function rutaDelEstado() {
  const escrita = serie.rutas && serie.rutas.estado;
  return typeof escrita === 'string' && escrita.trim() ? escrita.trim() : 'estado.json';
}

/** La clave con la que vive una toma en el estado: «{pieza}/{toma}». */
function claveDeToma(idPieza, idToma) {
  return `${idPieza}/${idToma}`;
}

/**
 * Parte una clave «{pieza}/{toma}» por la primera barra.
 * Una clave sin barra no la escribe `asegurar()`, pero si aparece se devuelve
 * entera como toma y sin pieza: inventarle una pieza sería mentir.
 */
function partirClaveDeToma(clave) {
  const corte = String(clave).indexOf('/');
  if (corte <= 0) return { pieza: null, toma: String(clave) };
  return { pieza: String(clave).slice(0, corte), toma: String(clave).slice(corte + 1) };
}

// ---------------------------------------------------------------------------
// La forma base
// ---------------------------------------------------------------------------

/**
 * La forma base del estado, vacía y congelada.
 *
 * Está congelada a propósito: es una plantilla, y si alguien la modificara sin
 * querer, todas las lecturas posteriores arrastrarían ese cambio. `asegurar()`
 * la clona antes de tocarla.
 *
 * `pieza_activa` nace en null y lo rellena `asegurar()` con la primera pieza de
 * serie.json (hoy el teaser). No se escribe aquí ningún id de pieza: los datos
 * son los que dicen qué piezas hay.
 */
export const ESTADO_VACIO = congelar({
  version: VERSION,
  pieza_activa: null,
  banco: {},
  escenarios: {},
  tomas: {},
  audio: { musica: {}, voz: {} },
  voces: {},
  montajes: [],
  cola: [],
  ajustes: { imagen: { nivel: null, resolucion: null }, video: { nivel: null } },
  gasto: { imagen: {}, video_s: {}, musica_s: 0, voz_s: 0 },
  pesos: {}
});

// ---------------------------------------------------------------------------
// Asegurar: rellenar desde serie.json todo lo que falte
// ---------------------------------------------------------------------------

/**
 * Una entrada de algo que se aprueba mirándolo: placas del banco y escenarios.
 * @param {object} mapa
 * @param {string} id
 */
function asegurarAprobable(mapa, id) {
  const entrada = esObjeto(mapa[id]) ? mapa[id] : {};
  entrada.aprobada = normalizarRuta(entrada.aprobada);
  listaDe(entrada, 'intentos');
  mapa[id] = entrada;
}

/**
 * Una entrada de toma: keyframe, clip y la operación de Veo que pueda estar en
 * vuelo. El orden de los campos es el del contrato §5.
 * @param {object} mapa
 * @param {string} clave `{pieza}/{toma}`
 */
function asegurarToma(mapa, clave) {
  const entrada = esObjeto(mapa[clave]) ? mapa[clave] : {};
  entrada.keyframe_aprobado = normalizarRuta(entrada.keyframe_aprobado);
  listaDe(entrada, 'intentos_keyframe');
  entrada.clip_elegido = normalizarRuta(entrada.clip_elegido);
  listaDe(entrada, 'intentos_clip');
  if (entrada.operacion_en_curso === undefined) entrada.operacion_en_curso = null;
  if (typeof entrada.operacion_en_curso === 'string' && !entrada.operacion_en_curso.trim()) {
    entrada.operacion_en_curso = null;
  }
  mapa[clave] = entrada;
}

/**
 * Una entrada de audio: vale para una pieza de música y para un bloque de voz.
 * `dur_s` empieza en cero y lo escribe quien mida el WAV de verdad; estimarlo
 * descuadra los subtítulos, que es una trampa ya pagada.
 * @param {object} mapa
 * @param {string} clave
 * @param {number|null} cuantasLineas cuántos tiempos de línea guarda (voz), o
 *   null si es música y no lleva líneas.
 */
function asegurarAudio(mapa, clave, cuantasLineas) {
  const entrada = esObjeto(mapa[clave]) ? mapa[clave] : {};
  entrada.ruta = normalizarRuta(entrada.ruta);
  entrada.dur_s = aNumero(entrada.dur_s);
  entrada.aprobada = Boolean(entrada.aprobada);

  if (cuantasLineas !== null) {
    // Un tiempo por línea del bloque, en el mismo orden que las líneas. Se
    // ajusta al número de líneas que hoy tiene el bloque: si serie.json cambió,
    // los tiempos sobrantes son de líneas que ya no existen y los que falten se
    // miden alineando otra vez. Los que ya estaban se respetan uno a uno.
    const previas = Array.isArray(entrada.lineas) ? entrada.lineas : [];
    const lineas = [];
    for (let i = 0; i < cuantasLineas; i += 1) {
      const previa = previas[i];
      lineas.push(
        esObjeto(previa)
          ? { inicio: aNumero(previa.inicio), fin: aNumero(previa.fin) }
          : { inicio: 0, fin: 0 }
      );
    }
    entrada.lineas = lineas;
  }

  listaDe(entrada, 'intentos');
  mapa[clave] = entrada;
}

/**
 * Una entrada de reparto de voces: la voz elegida, la frase de muestra ya
 * traducida al japonés y las muestras que se han oído.
 * @param {object} mapa
 * @param {string} idPersonaje
 * @param {object} deSerie la entrada de `voces.reparto`.
 */
function asegurarVoz(mapa, idPersonaje, deSerie) {
  const entrada = esObjeto(mapa[idPersonaje]) ? mapa[idPersonaje] : {};

  if (entrada.voz_id === undefined) entrada.voz_id = null;
  // La voz se elige escuchando y se fija en serie.json (plan §11.2). Si allí ya
  // está escrita y el estado todavía no la tiene, se toma de los datos; lo que
  // nunca se hace es pisar una elección que ya esté en el estado.
  if (!entrada.voz_id && deSerie && typeof deSerie.voz_id === 'string' && deSerie.voz_id.trim()) {
    entrada.voz_id = deSerie.voz_id;
  }

  // La frase de muestra traducida una sola vez por personaje: si cada voz
  // candidata dijera una frase distinta no se podrían comparar (contrato §2).
  if (entrada.ja === undefined) entrada.ja = null;
  if (typeof entrada.ja === 'string' && !entrada.ja.trim()) entrada.ja = null;

  mapaDe(entrada, 'muestras');
  mapa[idPersonaje] = entrada;
}

/**
 * Rellena desde `datos/serie.json` todo lo que falte, sin tocar nada de lo que
 * ya hay. Es idempotente: llamarla mil veces deja el mismo estado que llamarla
 * una, y llamarla después de desglosar un episodio es lo único que hace falta
 * para que aparezcan sus tomas, sus bloques de voz y su música, todos en cero.
 *
 * Rellena, en este orden:
 *   · `pieza_activa`, si no apunta a ninguna pieza que exista.
 *   · una entrada por placa del banco y una por escenario.
 *   · una entrada por toma de cada pieza, con clave `{pieza}/{toma}`.
 *   · una entrada por pieza de música y una por bloque de voz de cada pieza
 *     (los bloques los agrupa `bloquesDeVoz()`, que es quien sabe el criterio).
 *   · una entrada por personaje del reparto de voces.
 *   · los contadores de gasto y de pesos, a cero.
 *
 * @param {object} estado el estado leído del bucket, o cualquier cosa.
 * @returns {object} el estado ya completo. Si el que se le pasa se puede
 *   modificar, es el mismo objeto; si venía congelado o no era un objeto, uno
 *   nuevo. Quédate siempre con el que devuelve.
 */
export function asegurar(estado) {
  const partida = esObjeto(estado) ? estado : ESTADO_VACIO;
  // Un estado congelado —ESTADO_VACIO, sin ir más lejos— no se puede rellenar
  // encima: se trabaja sobre una copia.
  const completo = Object.isFrozen(partida) ? clonar(partida) : partida;

  // La versión que ya traiga se respeta: bajarla en silencio sería mentir sobre
  // con qué esquema se escribió.
  completo.version = Number.isFinite(Number(completo.version))
    ? Number(completo.version)
    : VERSION;

  const piezas = serie.piezas || {};
  const idsDePieza = Object.keys(piezas);

  // Qué pieza se está produciendo. Si la que hay escrita ya no existe (o no hay
  // ninguna), se pasa a la primera de serie.json, que hoy es el teaser.
  if (!idsDePieza.includes(completo.pieza_activa)) {
    completo.pieza_activa = idsDePieza.length ? idsDePieza[0] : null;
  }

  // Banco de personajes: una entrada por placa, ancla o no.
  const banco = mapaDe(completo, 'banco');
  for (const unaPlaca of (serie.banco && serie.banco.placas) || []) {
    if (unaPlaca && unaPlaca.id) asegurarAprobable(banco, unaPlaca.id);
  }

  // Escenarios: una entrada por placa de escenario.
  const escenarios = mapaDe(completo, 'escenarios');
  for (const unEscenario of (serie.escenarios && serie.escenarios.placas) || []) {
    if (unEscenario && unEscenario.id) asegurarAprobable(escenarios, unEscenario.id);
  }

  // Tomas: una por toma de cada pieza. Aquí es donde caben los ~400 planos de
  // un episodio en cuanto se desglosa.
  const tomas = mapaDe(completo, 'tomas');
  for (const idPieza of idsDePieza) {
    for (const unaToma of (piezas[idPieza] && piezas[idPieza].tomas) || []) {
      if (unaToma && unaToma.id) asegurarToma(tomas, claveDeToma(idPieza, unaToma.id));
    }
  }

  // Audio: música por id de pieza musical, voz por bloque de cada pieza.
  const audio = mapaDe(completo, 'audio');
  const musica = mapaDe(audio, 'musica');
  for (const unaMusica of (serie.musica && serie.musica.piezas) || []) {
    if (unaMusica && unaMusica.id) asegurarAudio(musica, unaMusica.id, null);
  }
  const voz = mapaDe(audio, 'voz');
  for (const idPieza of idsDePieza) {
    for (const bloque of bloquesDeVoz(idPieza)) {
      const cuantas = Array.isArray(bloque.lineas) ? bloque.lineas.length : 0;
      asegurarAudio(voz, `${idPieza}/${bloque.id}`, cuantas);
    }
  }

  // Reparto de voces: una entrada por personaje que habla en toda la serie.
  const voces = mapaDe(completo, 'voces');
  for (const delReparto of (serie.voces && serie.voces.reparto) || []) {
    if (delReparto && delReparto.personaje) {
      asegurarVoz(voces, delReparto.personaje, delReparto);
    }
  }

  // Montajes y cola son listas de objetos que escriben otros módulos: aquí solo
  // se comprueba que son listas.
  listaDe(completo, 'montajes');
  listaDe(completo, 'cola');

  // Ajustes: CON QUÉ se genera. Vive aquí y no en una variable de entorno porque
  // es una decisión de producción que se cambia sobre la marcha —y a mitad de una
  // tirada— y porque la manda quien paga, no quien despliega. `null` significa
  // «lo que diga datos/serie.json»: el nivel por defecto para la imagen y, en el
  // vídeo, el que lleve escrito cada plano.
  const ajustes = mapaDe(completo, 'ajustes');
  const deImagen = mapaDe(ajustes, 'imagen');
  deImagen.nivel = nivelODeLosDatos(deImagen.nivel, 'imagen');
  deImagen.resolucion = RESOLUCIONES.includes(deImagen.resolucion) ? deImagen.resolucion : null;
  const deVideo = mapaDe(ajustes, 'video');
  deVideo.nivel = nivelODeLosDatos(deVideo.nivel, 'video');

  // Gasto: no es un límite, es información. Con 400 planos, saber por dónde se
  // va el dinero cambia decisiones (plan §8).
  const gasto = mapaDe(completo, 'gasto');
  const imagenes = mapaDe(gasto, 'imagen');
  for (const nivel of nivelesDe('imagen')) imagenes[nivel] = aNumero(imagenes[nivel]);
  const segundosDeVideo = mapaDe(gasto, 'video_s');
  for (const nivel of nivelesDe('video')) segundosDeVideo[nivel] = aNumero(segundosDeVideo[nivel]);
  gasto.musica_s = aNumero(gasto.musica_s);
  gasto.voz_s = aNumero(gasto.voz_s);

  // Pesos: el máximo que ha pesado la respuesta de cada modo, que es la única
  // forma de cumplir el invariante de los 4,5 MB —se mide, no se razona—. Se
  // llena solo, modo a modo, según se van usando: aquí no se inventa la lista.
  const pesos = mapaDe(completo, 'pesos');
  for (const modo of Object.keys(pesos)) pesos[modo] = aNumero(pesos[modo]);

  return completo;
}

// ---------------------------------------------------------------------------
// Leer y escribir
// ---------------------------------------------------------------------------

/**
 * Lee `estado.json` del bucket, ya asegurado.
 * Un bucket vacío no es un fallo: es el primer día. Devuelve la forma base ya
 * asegurada y generación «0», que es justo lo que `escribir()` necesita para
 * crearlo solo si sigue sin existir.
 * @returns {Promise<{estado:object, generacion:string}>}
 */
export async function leer() {
  const ruta = rutaDelEstado();
  const crudo = await leerDelBucket(ruta);

  if (crudo === null) {
    return { estado: asegurar(clonar(ESTADO_VACIO)), generacion: '0' };
  }

  let leido;
  try {
    leido = JSON.parse(crudo.texto);
  } catch (fallo) {
    throw new ErrorDeCara(
      `El archivo de estado del bucket («${ruta}») no se entiende: hay algo escrito ` +
        'dentro que no es JSON. No se toca nada, porque sobrescribirlo perdería todo ' +
        'lo aprobado hasta ahora. Lo que hay que hacer es mirar ese archivo en el ' +
        'bucket y arreglarlo, o guardarlo aparte y borrarlo para empezar de cero.',
      {
        detalle: fallo && fallo.message ? fallo.message : String(fallo),
        reintentable: false,
        http: 500
      }
    );
  }

  if (!esObjeto(leido)) {
    throw new ErrorDeCara(
      `El archivo de estado del bucket («${ruta}») es JSON válido pero no es un objeto, ` +
        'así que no puede ser el estado de la producción. No se toca nada para no ' +
        'perder lo que hubiera. Hay que mirarlo en el bucket y arreglarlo.',
      { detalle: `Se leyó ${Array.isArray(leido) ? 'una lista' : typeof leido}.`, reintentable: false, http: 500 }
    );
  }

  // Se asegura al leer, y por eso desglosar un episodio no necesita ningún paso
  // extra: sus tomas aparecen solas en la siguiente lectura.
  return { estado: asegurar(leido), generacion: crudo.generacion };
}

/**
 * Guarda el estado en el bucket, y solo si nadie lo ha cambiado por debajo.
 *
 * `generacion` es obligatoria a propósito: guardar sin condición es como se
 * pierde el trabajo de otra pestaña o de otro móvil. Si el bucket dice que su
 * versión ya no es esa, `gcs.escribir()` lanza un ErrorDeCara con `http:409` y
 * quien llama vuelve a leer, reaplica su cambio y guarda otra vez.
 *
 * @param {object} estado el estado entero.
 * @param {string|number} generacion la generación que se leyó; «0» significa
 *   «solo si todavía no existe».
 * @returns {Promise<{generacion:string}>} la generación nueva.
 */
export async function escribir(estado, generacion) {
  if (!esObjeto(estado)) {
    throw new ErrorDeCara(
      'Se ha intentado guardar como estado algo que no es un estado. No se guarda ' +
        'nada: el bucket es la única verdad de la producción y escribir ahí cualquier ' +
        'cosa borraría todo lo aprobado.',
      { detalle: `Llegó ${Array.isArray(estado) ? 'una lista' : typeof estado}.`, reintentable: false, http: 500 }
    );
  }

  if (generacion === undefined || generacion === null || String(generacion).trim() === '') {
    throw new ErrorDeCara(
      'No se puede guardar el estado porque no se sabe sobre qué versión estás ' +
        'guardando, y sin eso se pisaría lo que hayas hecho desde otro sitio. Vuelve a ' +
        'abrir la aplicación para que lea el estado del bucket antes de guardar.',
      { reintentable: false, http: 500 }
    );
  }

  let texto;
  try {
    texto = JSON.stringify(estado);
  } catch (fallo) {
    throw new ErrorDeCara(
      'El estado no se ha podido convertir a texto para guardarlo, así que hay algo ' +
        'dentro que no cabe en un JSON. No se ha guardado nada.',
      {
        detalle: fallo && fallo.message ? fallo.message : String(fallo),
        reintentable: false,
        http: 500
      }
    );
  }

  const guardado = await escribirEnElBucket(rutaDelEstado(), texto, {
    tipo: TIPO_JSON,
    generacion: String(generacion)
  });

  return { generacion: guardado.generacion };
}

// ---------------------------------------------------------------------------
// Aprobaciones
// ---------------------------------------------------------------------------

/** Normaliza el tipo y se queja en español si no es uno de los cuatro. */
function tipoValido(tipo) {
  const limpio = String(tipo == null ? '' : tipo).trim().toLowerCase();
  if (TIPOS.includes(limpio)) return limpio;
  throw new ErrorDeCara(
    `«${tipo}» no es una cosa que se apruebe. Lo que se aprueba mirándolo es: ` +
      `${TIPOS.join(', ')}.`,
    { reintentable: false, http: 500 }
  );
}

/** Dónde vive cada tipo dentro del estado y en qué campo guarda su ruta. */
function dondeVive(estado, tipo, id) {
  const clave = String(id == null ? '' : id);
  if (tipo === 'banco') return { entrada: (estado.banco || {})[clave], campo: 'aprobada' };
  if (tipo === 'escenario') return { entrada: (estado.escenarios || {})[clave], campo: 'aprobada' };
  const deLaToma = (estado.tomas || {})[clave];
  if (tipo === 'keyframe') return { entrada: deLaToma, campo: 'keyframe_aprobado' };
  return { entrada: deLaToma, campo: 'clip_elegido' };
}

/**
 * La ruta de lo que hay aprobado, o null si todavía no hay nada.
 *
 * @param {object} estado
 * @param {'banco'|'escenario'|'keyframe'|'clip'} tipo
 * @param {string} id el id de la placa o del escenario; para `keyframe` y
 *   `clip`, la clave de la toma: `{pieza}/{toma}` (p. ej. `teaser/A4`).
 * @returns {string|null}
 */
export function rutaAprobada(estado, tipo, id) {
  if (!esObjeto(estado)) return null;
  const cual = tipoValido(tipo);
  const { entrada, campo } = dondeVive(estado, cual, id);
  if (!esObjeto(entrada)) return null;
  const ruta = entrada[campo];
  return typeof ruta === 'string' && ruta.trim() ? ruta : null;
}

/**
 * Cómo se nombra en la frase lo que falta, según el tipo.
 * Si `porQue` ya nombra la toma («generar el vídeo de A4»), se dice «su
 * keyframe» y no se repite el nombre: la frase que se lee en el teléfono queda
 * como la del contrato, «No se puede generar el vídeo de A4 porque su keyframe
 * todavía no está aprobado».
 */
function loQueFalta(tipo, id, porQue) {
  // Un id vacío no lo nombra nadie: sin esta comprobación, `includes('')` sería
  // siempre cierto y la frase se quedaría sin decir de qué habla.
  const loNombra = (texto) => Boolean(texto) && porQue.includes(texto);

  if (tipo === 'banco') {
    return loNombra(id)
      ? 'esa placa del banco todavía no está aprobada'
      : `la placa «${id}» del banco todavía no está aprobada`;
  }
  if (tipo === 'escenario') {
    return loNombra(id)
      ? 'ese escenario todavía no está aprobado'
      : `el escenario «${id}» todavía no está aprobado`;
  }
  const { pieza: idPieza, toma: idToma } = partirClaveDeToma(id);
  const laNombra = loNombra(idToma);
  if (tipo === 'keyframe') {
    return laNombra
      ? 'su keyframe todavía no está aprobado'
      : `el keyframe de la toma ${idToma}${idPieza ? ` de la pieza «${idPieza}»` : ''} ` +
          'todavía no está aprobado';
  }
  return laNombra
    ? 'todavía no hay ningún clip elegido para ella'
    : `todavía no hay ningún clip elegido para la toma ${idToma}` +
        `${idPieza ? ` de la pieza «${idPieza}»` : ''}`;
}

/** Qué hacer para que deje de faltar, que es la mitad útil del mensaje. */
function comoSeArregla(tipo) {
  if (tipo === 'banco') {
    return 'Genérala en la pantalla de Banco, mírala y apruébala: sin una placa ' +
      'aprobada no hay a qué parecerse, y lo que salga será otra persona.';
  }
  if (tipo === 'escenario') {
    return 'Genéralo en la pantalla de Banco, míralo y apruébalo: sin la placa del ' +
      'escenario aprobada, cada plano del mismo sitio sale de un sitio distinto.';
  }
  if (tipo === 'keyframe') {
    return 'Genera su keyframe en la pantalla de Tomas y apruébalo mirándolo. Un ' +
      'keyframe malo cuesta céntimos y un clip malo cuesta un euro: por eso no hay ' +
      'vídeo sin keyframe aprobado.';
  }
  return 'Genera el clip en la pantalla de Tomas y elige el intento que valga ' +
    'reproduciéndolo. Nada entra en el montaje sin haberse visto antes.';
}

/**
 * Devuelve la ruta aprobada o se planta con una frase que dice qué falta y para
 * qué hacía falta. Es el cerrojo de servidor de los invariantes del plan §13:
 * ninguna toma genera vídeo sin keyframe aprobado, y ninguna placa que no sea
 * ancla se genera sin el ancla de su personaje aprobada.
 *
 * @param {object} estado
 * @param {'banco'|'escenario'|'keyframe'|'clip'} tipo
 * @param {string} id id de placa o de escenario; `{pieza}/{toma}` para keyframe
 *   y clip.
 * @param {string} porQue para qué hacía falta, en español y en infinitivo, tal
 *   como se lee dentro de la frase: «generar el vídeo de A4».
 * @returns {string} la ruta aprobada.
 */
export function exigirAprobada(estado, tipo, id, porQue) {
  const cual = tipoValido(tipo);
  const ruta = rutaAprobada(estado, cual, id);
  if (ruta) return ruta;

  const clave = String(id == null ? '' : id);
  const paraQue = String(porQue == null ? '' : porQue).trim() || 'seguir';
  const { entrada } = esObjeto(estado)
    ? dondeVive(estado, cual, clave)
    : { entrada: undefined };

  // Que la entrada ni siquiera exista quiere decir otra cosa: o el id está mal
  // escrito, o la pieza se acaba de desglosar y esta copia del estado es de
  // antes. Merece su propia frase, porque el remedio es distinto.
  const noFigura = !esObjeto(entrada)
    ? ' Esa entrada ni siquiera figura en el estado: si la pieza se acaba de ' +
      'desglosar, vuelve a abrir la aplicación para que el estado se ponga al día.'
    : '';

  throw new ErrorDeCara(
    `No se puede ${paraQue} porque ${loQueFalta(cual, clave, paraQue)}. ` +
      `${comoSeArregla(cual)}${noFigura}`,
    { reintentable: false, http: 400 }
  );
}

// ---------------------------------------------------------------------------
// Reprobar en cadena
// ---------------------------------------------------------------------------

/**
 * Las placas que dependen directamente de una: las de su personaje cuando la
 * placa es el ancla, y las de cualquier personaje que encadene a ella.
 *
 * Las dos cadenas del banco (plan §6 y contrato §13.1) salen de aquí:
 *   · saharis-ancla → todas las placas de saharis.
 *   · saharis-ancla → saharis-5-ancla (encadena_a), y de ahí a todas las placas
 *     de saharis-5, incluidas las de detalle: manos, nuca, escorzo.
 * Por eso la cadena se sigue en profundidad y no un nivel: cambiar el ancla del
 * adulto mueve las siete edades y todos sus detalles.
 *
 * @param {string} idPlaca
 * @returns {string[]} ids de placa, sin repetir.
 */
function dependientesDe(idPlaca) {
  const todas = (serie.banco && serie.banco.placas) || [];
  const esta = todas.find((p) => p && p.id === idPlaca);
  const hijas = [];

  // Las demás placas de su personaje solo cuelgan del ancla: son ellas las que
  // se generan con el ancla adjunta como referencia de personaje.
  if (esta && esta.ancla === true) {
    for (const suya of placasDePersonaje(esta.personaje)) {
      if (suya.id !== idPlaca) hijas.push(suya.id);
    }
  }

  // Y cualquier placa que la nombre en `encadena_a`, sea del personaje que sea:
  // así es como las edades de Saharis cuelgan del ancla del adulto.
  for (const otra of todas) {
    if (otra && otra.encadena_a === idPlaca && otra.id !== idPlaca) hijas.push(otra.id);
  }

  return [...new Set(hijas)];
}

/**
 * Al cambiar un ancla, deja por reprobar todo lo que se generó pareciéndose a
 * ella: las demás placas de su personaje y las de los personajes que encadenan a
 * ella, en profundidad. El ancla en sí no se toca —es la que acaba de cambiar y
 * la aprueba quien la mire—.
 *
 * @param {object} estado se modifica en el sitio.
 * @param {string} idPlacaAncla la placa que ha cambiado.
 * @returns {string[]} los ids que de verdad se han quedado sin aprobación, para
 *   poder decirlo en pantalla con nombres. Los que ya estaban sin aprobar no
 *   salen en la lista: nombrarlos sería asustar por nada.
 */
export function reprobarCadena(estado, idPlacaAncla) {
  // Si la placa no existe, `placa()` se planta con su frase en español. Mejor
  // eso que reprobar en silencio un id mal escrito, que no reprobaría nada.
  const laPlaca = placa(idPlacaAncla);
  if (!esObjeto(estado)) return [];

  const banco = mapaDe(estado, 'banco');
  const reprobadas = [];
  const vistas = new Set([laPlaca.id]);
  const porVisitar = dependientesDe(laPlaca.id).filter((id) => !vistas.has(id));
  for (const id of porVisitar) vistas.add(id);

  // Anchura primero, con `vistas` para que un ciclo mal escrito en los datos no
  // deje esto dando vueltas para siempre.
  while (porVisitar.length) {
    const id = porVisitar.shift();

    const entrada = esObjeto(banco[id]) ? banco[id] : null;
    if (entrada) {
      const tenia = typeof entrada.aprobada === 'string' && entrada.aprobada.trim();
      entrada.aprobada = null;
      if (tenia) reprobadas.push(id);
    } else {
      // No estaba en el estado (una placa nueva que aún no se ha asegurado):
      // se deja creada y sin aprobar, que es lo que corresponde.
      asegurarAprobable(banco, id);
    }

    for (const hija of dependientesDe(id)) {
      if (!vistas.has(hija)) {
        vistas.add(hija);
        porVisitar.push(hija);
      }
    }
  }

  return reprobadas;
}

// ---------------------------------------------------------------------------
// Lo que mira la pantalla
// ---------------------------------------------------------------------------

// FALTA EN EL CONTRATO: `resumenDePieza()` y `operacionesPendientes()` no están
// en docs/contrato.md §12, que solo lista ESTADO_VACIO, leer, escribir,
// asegurar, rutaAprobada, exigirAprobada y reprobarCadena. Se implementan aquí
// con estos nombres porque la barra de progreso de Tomas y la recuperación de
// operaciones de `app/cola.js` las necesitan, y contar las tomas a mano en cada
// pantalla acabaría contándolas de forma distinta en cada una. Que se revise y
// se añadan al §12.

/**
 * Cuántas tomas tiene una pieza y por dónde va, para la barra de progreso.
 * Se cuenta contra las tomas que hay escritas en serie.json, no contra las que
 * haya en el estado: si el estado se quedó corto, el progreso tiene que decir
 * que faltan, no esconderlas.
 *
 * @param {object} estado
 * @param {string} idPieza
 * @returns {{tomas:number, conKeyframe:number, conClip:number, listas:number}}
 *   `listas` son las que ya tienen keyframe aprobado y clip elegido: las que no
 *   necesitan nada más para entrar en el montaje.
 */
export function resumenDePieza(estado, idPieza) {
  const laPieza = pieza(idPieza);
  const suyas = laPieza.tomas || [];
  const enEstado = esObjeto(estado) && esObjeto(estado.tomas) ? estado.tomas : {};

  let conKeyframe = 0;
  let conClip = 0;
  let listas = 0;

  for (const unaToma of suyas) {
    if (!unaToma || !unaToma.id) continue;
    const entrada = enEstado[claveDeToma(idPieza, unaToma.id)];
    if (!esObjeto(entrada)) continue;
    const keyframe = typeof entrada.keyframe_aprobado === 'string' && entrada.keyframe_aprobado.trim();
    const clip = typeof entrada.clip_elegido === 'string' && entrada.clip_elegido.trim();
    if (keyframe) conKeyframe += 1;
    if (clip) conClip += 1;
    if (keyframe && clip) listas += 1;
  }

  return { tomas: suyas.length, conKeyframe, conClip, listas };
}

/**
 * Todas las operaciones de Veo que quedaron lanzadas y sin recoger.
 *
 * Esto es lo que se consulta al abrir la aplicación, ANTES de lanzar nada nuevo
 * (contrato §8): una operación lanzada y olvidada es un clip pagado que nadie
 * recoge y una toma que se queda «generando» para siempre. Se recorren todas las
 * tomas de todas las piezas, no solo las de la pieza activa: el móvil pudo
 * cerrarse con otra pieza abierta.
 *
 * @param {object} estado
 * @returns {{pieza:string|null, toma:string, operacion:string}[]} en el orden en
 *   que están en el estado, que es el de serie.json.
 */
export function operacionesPendientes(estado) {
  if (!esObjeto(estado) || !esObjeto(estado.tomas)) return [];
  const pendientes = [];
  for (const [clave, entrada] of Object.entries(estado.tomas)) {
    if (!esObjeto(entrada)) continue;
    const operacion = entrada.operacion_en_curso;
    if (typeof operacion !== 'string' || !operacion.trim()) continue;
    const { pieza: idPieza, toma: idToma } = partirClaveDeToma(clave);
    pendientes.push({ pieza: idPieza, toma: idToma, operacion });
  }
  return pendientes;
}
