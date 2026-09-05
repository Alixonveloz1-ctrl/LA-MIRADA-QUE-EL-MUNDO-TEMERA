// Los dos archivos de datos de la serie, cargados una vez y servidos ya
// masticados. Nadie más abre `datos/*.json`: si un módulo necesita un dato de la
// serie, pide aquí la función que se lo da. Así los ids de modelo, las rutas del
// banco y el criterio de los bloques de voz viven en un solo sitio.
//
// CÓMO SE CARGAN LOS JSON, Y POR QUÉ ASÍ
// Vercel empaqueta la función siguiendo las importaciones con node-file-trace, y
// lo que ese rastreador entiende sin ayuda es un `require()` con la ruta escrita
// literal. Por eso la vía principal es `createRequire(import.meta.url)` + un
// `require('../../datos/…')` literal: el JSON entra en el paquete, y además Node
// lo lee y lo parsea una sola vez para todo el proceso (la función serverless se
// reutiliza entre invocaciones: parsear 280 KB en cada una sería tiempo tirado).
// `vercel.json` añade `includeFiles: "datos/**"` como segundo cinturón.
//
// Aun así se dejan dos redes debajo, porque quedarse sin datos no puede
// aparecer en pantalla como un fallo de red: leer el archivo con `readFileSync`
// resolviendo la ruta desde `import.meta.url` (si el empaquetado conserva el
// árbol pero no la resolución de módulos), y leerlo desde la raíz del proyecto
// (en Vercel el directorio de trabajo de la función es la raíz). Si fallan las
// tres, se explica con palabras qué archivo falta y qué dijo cada intento.

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErrorDeCara } from './errores.js';
import { entorno } from './entorno.js';

const requerir = createRequire(import.meta.url);

/**
 * Carga un archivo de datos probando tres caminos en orden.
 * @param {string} nombre nombre del archivo tal y como se le dice al usuario.
 * @param {Array<() => any>} intentos formas de leerlo, de la mejor a la peor.
 * @returns {any} el JSON ya parseado.
 */
function cargarDatos(nombre, intentos) {
  const quejas = [];
  for (const intento of intentos) {
    try {
      const contenido = intento();
      if (contenido && typeof contenido === 'object') return contenido;
      quejas.push('el archivo se leyó pero no contiene un objeto JSON');
    } catch (fallo) {
      quejas.push(fallo && fallo.message ? fallo.message : String(fallo));
    }
  }
  throw new ErrorDeCara(
    `No se ha podido leer ${nombre}, que es donde vive la serie entera. ` +
      'Sin ese archivo la herramienta no sabe ni qué modelos usar ni qué placas hay, ' +
      'así que no puede seguir. Comprueba que el archivo está en el repositorio y que ' +
      'vercel.json sigue incluyendo "datos/**" en la función.',
    { detalle: quejas.join(' | '), reintentable: false, http: 500 }
  );
}

/** Cómo se produce la serie: modelos, estilo, luces, banco, piezas y voces. */
export const serie = cargarDatos('datos/serie.json', [
  () => requerir('../../datos/serie.json'),
  () => JSON.parse(readFileSync(new URL('../../datos/serie.json', import.meta.url), 'utf8')),
  () => JSON.parse(readFileSync(resolve(process.cwd(), 'datos/serie.json'), 'utf8'))
]);

/**
 * La serie escrita: el archivo entero, con `meta` y `guiones` (los doce
 * episodios). Para recorrerlo están `episodios()`, `escenasDeEpisodio()` y
 * `escenaDeGuion()`, que es lo que usa todo el mundo.
 */
export const guiones = cargarDatos('datos/guiones.json', [
  () => requerir('../../datos/guiones.json'),
  () => JSON.parse(readFileSync(new URL('../../datos/guiones.json', import.meta.url), 'utf8')),
  () => JSON.parse(readFileSync(resolve(process.cwd(), 'datos/guiones.json'), 'utf8'))
]);

// Los tres niveles de calidad, escritos una vez. No se recorren las claves de
// `modelos.imagen` porque ahí dentro también viven `por_defecto`, `protocolo` y
// `parametros`, que no son niveles.
const NIVELES = ['calidad', 'medio', 'economico'];

// Qué variable de entorno sustituye a cada familia de modelos. Los nombres salen
// de docs/contrato.md §10 y de `serie.modelos.sustituible_por_entorno`; los ids
// no se escriben nunca aquí, salen de serie.json.
const VARIABLE_DE_MODELO = { imagen: 'IMAGE_MODEL', video: 'VEO_MODEL' };

// Región por defecto si datos.js corre sin credenciales: la pone `entorno()` a
// partir de GCP_LOCATION, y esto solo se usa cuando `entorno()` no está
// disponible (herramientas/invariantes.mjs corre sin red y sin service account,
// y aun así tiene que poder decir qué modelo lleva cada nivel).
const REGION_SI_NO_HAY_ENTORNO = 'us-central1';

// -------------------------------------------------------------------------
// Búsquedas en serie.json
// -------------------------------------------------------------------------

/**
 * Una pieza de la serie (hoy `teaser`; mañana `ep01` al lado).
 * @param {string} id
 * @returns {object} la pieza tal cual está en serie.json.
 */
export function pieza(id) {
  const piezas = serie.piezas || {};
  const encontrada = piezas[id];
  if (!encontrada) {
    const hay = Object.keys(piezas);
    throw new ErrorDeCara(
      `No existe la pieza «${id}». Debería estar en la sección «piezas» de ` +
        `datos/serie.json. Las piezas que hay ahora mismo son: ${hay.join(', ') || 'ninguna'}.`,
      { reintentable: false, http: 400 }
    );
  }
  return encontrada;
}

/**
 * Una toma (un plano) dentro de una pieza.
 * @param {string} idPieza
 * @param {string} idToma
 * @returns {object}
 */
export function toma(idPieza, idToma) {
  const laPieza = pieza(idPieza);
  const tomas = laPieza.tomas || [];
  const encontrada = tomas.find((t) => t.id === idToma);
  if (!encontrada) {
    throw new ErrorDeCara(
      `La pieza «${idPieza}» no tiene ninguna toma «${idToma}». Debería estar en ` +
        `piezas.${idPieza}.tomas de datos/serie.json, que hoy tiene ${tomas.length} tomas.`,
      { reintentable: false, http: 400 }
    );
  }
  return encontrada;
}

/**
 * Una placa del banco de personajes.
 * @param {string} idPlaca
 * @returns {object}
 */
export function placa(idPlaca) {
  const placas = (serie.banco && serie.banco.placas) || [];
  const encontrada = placas.find((p) => p.id === idPlaca);
  if (!encontrada) {
    throw new ErrorDeCara(
      `No existe la placa «${idPlaca}» en el banco. Debería estar en banco.placas de ` +
        `datos/serie.json, que hoy tiene ${placas.length} placas. Si es una placa nueva, ` +
        'se añade primero al banco y luego se genera.',
      { reintentable: false, http: 400 }
    );
  }
  return encontrada;
}

/**
 * Una placa de escenario.
 * @param {string} id
 * @returns {object}
 */
export function escenario(id) {
  const placas = (serie.escenarios && serie.escenarios.placas) || [];
  const encontrado = placas.find((e) => e.id === id);
  if (!encontrado) {
    throw new ErrorDeCara(
      `No existe el escenario «${id}». Debería estar en escenarios.placas de ` +
        `datos/serie.json, que hoy tiene ${placas.length} escenarios. Toda toma tiene ` +
        'escenario y ese escenario tiene que existir en el banco.',
      { reintentable: false, http: 400 }
    );
  }
  return encontrado;
}

/**
 * La identidad de un personaje, que es lo que abre su prompt.
 * @param {string} id
 * @returns {object} `{ identidad, … }`
 */
export function personaje(id) {
  const personajes = serie.personajes || {};
  const encontrado = personajes[id];
  if (encontrado) return encontrado;

  // Los figurantes están listados aparte y a propósito no tienen identidad
  // escrita: llevan un ancla genérica. Decirlo evita que parezca un id mal
  // escrito cuando no lo es.
  const figurantes = (serie.personajes_figurantes && serie.personajes_figurantes.ids) || [];
  if (figurantes.includes(id)) {
    throw new ErrorDeCara(
      `«${id}» es un figurante, no un personaje del banco: está en ` +
        'personajes_figurantes de datos/serie.json y no tiene identidad escrita. ' +
        'Los figurantes llevan un ancla genérica; si este necesita identidad propia, ' +
        'hay que pasarlo a la sección «personajes».',
      { reintentable: false, http: 400 }
    );
  }
  throw new ErrorDeCara(
    `No existe el personaje «${id}». Debería estar en la sección «personajes» de ` +
      'datos/serie.json (o en «personajes_figurantes», si solo es un figurante).',
    { reintentable: false, http: 400 }
  );
}

/**
 * Dónde vive el PNG de una placa dentro del bucket, en ruta lógica.
 * La plantilla sale de `serie.banco.ruta`; no se escribe a mano en ningún sitio.
 * @param {string} idPlaca
 * @returns {string} p. ej. `banco/madre/madre-ancla.png`.
 */
export function rutaPlaca(idPlaca) {
  const laPlaca = placa(idPlaca);
  const plantilla = (serie.banco && serie.banco.ruta) || '';
  if (!plantilla.includes('{personaje}') || !plantilla.includes('{placa}')) {
    throw new ErrorDeCara(
      'La plantilla de rutas del banco (banco.ruta en datos/serie.json) no lleva ' +
        '{personaje} y {placa}, así que no se puede saber dónde guardar la placa ' +
        `«${idPlaca}».`,
      { detalle: plantilla || null, reintentable: false, http: 500 }
    );
  }
  return plantilla.replace('{personaje}', laPlaca.personaje).replace('{placa}', laPlaca.id);
}

/**
 * El ancla de un personaje: la placa que se genera solo con texto y contra la
 * que se generan todas las demás suyas.
 * @param {string} idPersonaje
 * @returns {string|null} el id de la placa ancla, o null si ese personaje no
 *   tiene ninguna en el banco (los figurantes, por ejemplo).
 */
export function anclaDePersonaje(idPersonaje) {
  const placas = (serie.banco && serie.banco.placas) || [];
  const ancla = placas.find((p) => p.personaje === idPersonaje && p.ancla === true);
  return ancla ? ancla.id : null;
}

/**
 * Todas las placas de un personaje, con su ancla la primera: ese es el orden en
 * que se generan (`banco.orden` = anclas, luego el resto) y el orden en que se
 * reprueban cuando cambia el ancla.
 * @param {string} idPersonaje
 * @returns {object[]} las placas tal cual están en serie.json; vacío si no tiene.
 */
export function placasDePersonaje(idPersonaje) {
  const placas = (serie.banco && serie.banco.placas) || [];
  const suyas = placas.filter((p) => p.personaje === idPersonaje);
  return [...suyas.filter((p) => p.ancla === true), ...suyas.filter((p) => p.ancla !== true)];
}

// -------------------------------------------------------------------------
// Modelos
// -------------------------------------------------------------------------

/**
 * `entorno()` cuando se puede, y null cuando no.
 * Lanza si faltan GCP_SERVICE_ACCOUNT o GCS_BUCKET, y eso es correcto en la
 * función; pero `herramientas/invariantes.mjs` recorre estos datos sin red y sin
 * credenciales, y ahí tiene que poder leer los modelos igualmente.
 * @returns {object|null}
 */
function entornoSiLoHay() {
  try {
    return entorno();
  } catch {
    return null;
  }
}

/**
 * Los Gemini 3.x solo se sirven desde `global`. Pedirlos a una región concreta
 * devuelve un 404 que parece falta de acceso y no lo es: esa trampa ya se pagó
 * una vez y no se vuelve a pagar.
 * @param {string} id
 * @returns {boolean}
 */
function esGeminiTres(id) {
  return /^gemini-3(?:[.-]|$)/.test(String(id || ''));
}

/**
 * Resuelve el modelo de un nivel: parte del id de serie.json, deja que la
 * variable de entorno lo sustituya y coloca la región que le toca.
 * @param {'imagen'|'video'} familia
 * @param {string} nivel
 * @param {object} base `{ id, region? }` tal cual está en serie.json.
 * @returns {{id:string, region:string, variable:string}}
 */
function resolverModelo(familia, nivel, base) {
  const variable = VARIABLE_DE_MODELO[familia];
  const ent = entornoSiLoHay();
  // `entorno()` ya devuelve los modelos con la sustitución hecha (contrato §12).
  // Se acepta tanto `modelos.video` como `modelos.veo`, que es como los nombra
  // el contrato para el vídeo.
  const familiasEnEntorno = familia === 'video' ? ['veo', 'video'] : [familia];
  let delEntorno = null;
  for (const nombre of familiasEnEntorno) {
    const candidato = ent && ent.modelos && ent.modelos[nombre] && ent.modelos[nombre][nivel];
    if (candidato && candidato.id) {
      delEntorno = candidato;
      break;
    }
  }

  // Si no hay `entorno()` (herramientas sin credenciales), se mira la variable a
  // pelo: el id del modelo no es un secreto, lo son las credenciales.
  const sustituto = (delEntorno && delEntorno.id) || process.env[variable] || null;
  const id = sustituto || base.id;

  let region = (delEntorno && delEntorno.region) || base.region || null;
  if (esGeminiTres(id)) region = 'global';
  if (!region) region = (ent && ent.region) || process.env.GCP_LOCATION || REGION_SI_NO_HAY_ENTORNO;

  return { id, region, variable };
}

/**
 * Comprueba que el nivel pedido es uno de los tres y lo devuelve normalizado.
 * @param {string} nivel
 * @param {string} paraQue texto que se enseña si no vale.
 * @returns {'calidad'|'medio'|'economico'}
 */
function nivelValido(nivel, paraQue) {
  // Los datos escriben «economico» sin tilde; una pantalla o una variable
  // podrían escribirlo con ella, y eso no es motivo para fallar.
  const limpio = String(nivel == null ? '' : nivel)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (NIVELES.includes(limpio)) return limpio;
  throw new ErrorDeCara(
    `«${nivel}» no es un nivel de ${paraQue}. Los niveles son: ${NIVELES.join(', ')}.`,
    { reintentable: false, http: 400 }
  );
}

/**
 * El modelo de imagen de un nivel, ya con la sustitución por variable de
 * entorno aplicada.
 * @param {string} [nivel] si no se dice, el de `modelos.imagen.por_defecto`.
 * @returns {{id:string, region:string, variable:string}}
 */
export function nivelImagen(nivel) {
  const modelos = (serie.modelos && serie.modelos.imagen) || {};
  const pedido = nivel == null || nivel === '' ? modelos.por_defecto : nivel;
  const elegido = nivelValido(pedido, 'imagen');
  const base = modelos[elegido];
  if (!base || !base.id) {
    throw new ErrorDeCara(
      `El nivel de imagen «${elegido}» no tiene modelo escrito en modelos.imagen de ` +
        'datos/serie.json. Los ids de modelo salen siempre de ahí, nunca del código.',
      { reintentable: false, http: 500 }
    );
  }
  return resolverModelo('imagen', elegido, base);
}

/**
 * El modelo de vídeo de un nivel, ya con la sustitución por variable de entorno
 * aplicada. El contrato pide `{ id, variable }`; se devuelve además `region`,
 * porque `vertex.js` la necesita para componer la URL y serie.json no la escribe
 * para vídeo (Veo va a la región por defecto, GCP_LOCATION).
 * @param {string} nivel `calidad`, `medio` o `economico`; lo dice la toma.
 * @returns {{id:string, region:string, variable:string}}
 */
export function nivelVeo(nivel) {
  const modelos = (serie.modelos && serie.modelos.video) || {};
  if (nivel == null || nivel === '') {
    throw new ErrorDeCara(
      'Falta decir con qué nivel de Veo se genera el clip. Lo dice la toma, en su ' +
        `campo «veo». Los niveles son: ${NIVELES.join(', ')}.`,
      { reintentable: false, http: 400 }
    );
  }
  const elegido = nivelValido(nivel, 'vídeo');
  const base = modelos[elegido];
  if (!base || !base.id) {
    throw new ErrorDeCara(
      `El nivel de vídeo «${elegido}» no tiene modelo escrito en modelos.video de ` +
        'datos/serie.json. Los ids de modelo salen siempre de ahí, nunca del código.',
      { reintentable: false, http: 500 }
    );
  }
  return resolverModelo('video', elegido, base);
}

// -------------------------------------------------------------------------
// Voz
// -------------------------------------------------------------------------

/**
 * Un segundo del guion de audio, en número.
 * `Number(null)` y `Number('')` valen 0, y un 0 colocado por descuido sí es un
 * segundo válido: por eso el hueco se detecta antes de convertir.
 * @param {*} valor
 * @returns {number} NaN si no hay segundo escrito.
 */
function segundos(valor) {
  if (valor === null || valor === undefined || valor === '') return NaN;
  return Number(valor);
}

/**
 * Las líneas de voz de una pieza, tal cual están en `piezas[p].audio.voz`,
 * ordenadas por el segundo en que entran.
 * @param {string} idPieza
 * @returns {object[]} las entradas crudas, ordenadas y comprobadas.
 */
function lineasCrudas(idPieza) {
  const laPieza = pieza(idPieza);
  const lineas = (laPieza.audio && laPieza.audio.voz) || [];
  for (const linea of lineas) {
    if (!Number.isFinite(segundos(linea.t)) || !Number.isFinite(segundos(linea.hasta))) {
      throw new ErrorDeCara(
        `Una línea de voz de la pieza «${idPieza}» (la de ${linea.quien || 'nadie'}) no ` +
          'tiene bien escritos sus segundos de entrada y salida, así que no se puede ' +
          'ni ordenar ni colocar en el montaje. Están en piezas.' +
          `${idPieza}.audio.voz de datos/serie.json.`,
        { reintentable: false, http: 500 }
      );
    }
  }
  return [...lineas].sort((a, b) => segundos(a.t) - segundos(b.t));
}

/**
 * Las líneas de voz de una pieza, en orden y con lo justo para hablar y para
 * subtitular.
 * @param {string} idPieza
 * @returns {{quien:string, ja:string, es:string, t:number, hasta:number}[]}
 */
export function lineasDeVoz(idPieza) {
  return lineasCrudas(idPieza).map((l) => ({
    quien: l.quien,
    ja: l.ja,
    es: l.es,
    t: segundos(l.t),
    hasta: segundos(l.hasta)
  }));
}

/**
 * En qué escena cae una línea de voz de una pieza de episodio.
 * Si la línea lo dice, se le cree; si no, se busca la toma que está en pantalla
 * en ese segundo, que es la que sabe de qué escena viene.
 * @param {object} linea
 * @param {object[]} tomas
 * @returns {string|null}
 */
function escenaDeLinea(linea, tomas) {
  if (linea.escena !== undefined && linea.escena !== null) return String(linea.escena);
  const t = segundos(linea.t);
  let ultima = null;
  for (const unaToma of tomas) {
    const inicio = Number(unaToma.inicio);
    const dur = Number(unaToma.dur);
    if (!Number.isFinite(inicio)) continue;
    if (t >= inicio && t < inicio + (Number.isFinite(dur) ? dur : 0)) return String(unaToma.escena);
    if (t >= inicio) ultima = unaToma;
  }
  // Una línea que empieza justo en el corte final, o después, pertenece a la
  // última escena que se vio: no se inventa una escena nueva por un decimal.
  if (ultima) return String(ultima.escena);
  return tomas.length ? String(tomas[0].escena) : null;
}

/**
 * Agrupa las líneas de voz de una pieza en bloques, que es como se piden al
 * modelo: **una llamada por bloque, con todas sus líneas dentro**.
 *
 * EL CRITERIO, que es de donde depende la deriva de tono (contrato §2 «voz» y
 * docs/decisiones.md §3). Entre dos llamadas al modelo el timbre no cambia —es
 * la voz elegida— pero la entrega sí: tono, energía y ritmo. No se arregla con
 * indicaciones. Lo único que funciona es llamar menos veces y meter más texto en
 * cada llamada, hasta donde el modelo aguanta: dos hablantes.
 *
 *  - Pieza corta, la que no tiene escenas (el teaser): **un bloque por
 *    personaje**, con sus líneas en orden. La madre dice tres frases repartidas
 *    por los 78 segundos y Saharis una; si cada frase fuera una llamada, la
 *    madre sonaría a tres madres distintas. El id del bloque es el nombre del
 *    personaje: «madre», «saharis».
 *  - Pieza de episodio, cuyas tomas traen `escena`: **un bloque por escena**,
 *    con sus líneas en orden, porque una escena es una conversación seguida y
 *    dentro de una llamada el tono se sostiene. Si en la escena hablan más de
 *    dos, se parte en bloques consecutivos de como mucho dos hablantes **sin
 *    desordenar las líneas**: se corta por donde entra el tercero y se sigue.
 *    El id es «esc-{n}», y «esc-{n}-{k}» cuando la escena se ha partido.
 *
 * Nunca se regenera una línea suelta: se rehace el bloque entero. Una línea
 * regenerada sola es justo la que canta.
 *
 * @param {string} idPieza
 * @returns {{id:string, personajes:string[], lineas:object[]}[]}
 */
export function bloquesDeVoz(idPieza) {
  const laPieza = pieza(idPieza);
  const tomas = laPieza.tomas || [];
  const lineas = lineasCrudas(idPieza);
  if (!lineas.length) return [];

  // La línea que sale de aquí lleva `intencion` porque la instrucción de
  // actuación se compone con ella (contrato §2). El teaser no la escribe en sus
  // líneas: entonces vale null y `prompt.js` se queda con la intención de la
  // muestra del personaje, que está en voces.reparto[].muestra.intencion.
  const conForma = (l) => ({
    quien: l.quien,
    ja: l.ja,
    es: l.es,
    t: segundos(l.t),
    hasta: segundos(l.hasta),
    intencion: l.intencion === undefined ? null : l.intencion
  });

  // Solo cuentan las tomas que dicen de qué escena vienen: son ellas las que
  // sitúan cada línea. Una pieza sin ninguna es una pieza corta, como el teaser.
  const conEscena = tomas.filter((t) => t.escena !== undefined && t.escena !== null);

  if (!conEscena.length) {
    // Un bloque por personaje, en el orden en que cada uno habla por primera vez.
    const porPersonaje = new Map();
    for (const linea of lineas) {
      if (!porPersonaje.has(linea.quien)) porPersonaje.set(linea.quien, []);
      porPersonaje.get(linea.quien).push(conForma(linea));
    }
    return [...porPersonaje.entries()].map(([quien, suyas]) => ({
      id: quien,
      personajes: [quien],
      lineas: suyas
    }));
  }

  // Un bloque por escena, partido por parejas cuando hablan más de dos.
  // Se agrupa por escena y no por tramo seguido de la línea de tiempo: una
  // escena intercalada —un flashback que se retoma más tarde— sigue siendo una
  // sola conversación y tiene que salir de una sola llamada. Además así no
  // pueden salir dos bloques con el mismo id, que se pisarían el WAV en el
  // bucket.
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
      actual.lineas.push(conForma(linea));
    }
    trozos.forEach((trozo, i) => {
      bloques.push({
        id: trozos.length === 1 ? `esc-${grupo.escena}` : `esc-${grupo.escena}-${i + 1}`,
        personajes: trozo.personajes,
        lineas: trozo.lineas
      });
    });
  }
  return bloques;
}

// -------------------------------------------------------------------------
// Guiones
// -------------------------------------------------------------------------

// Dos entradas de `guiones.json` no son personajes: son basura del parseo del
// guion original. Si no se quitan de en medio, el desglose pedirá placas de
// banco que no existen y la escena fallará por una razón que no es la suya.
//
//  - «título: la mirada que el mundo temerá» (episodio 1, escena 2): es el
//    rótulo del título de la serie, que el parser leyó como si fuera un nombre
//    de personaje porque venía en mayúsculas en su propia línea. Se descarta.
//  - «saharis ilmen.» (episodio 9, escena 13): es Saharis con apellido y con el
//    punto final pegado. Es el protagonista, así que se normaliza a «saharis» en
//    vez de tirarlo: descartarlo dejaría esa escena sin nadie.
const ARTEFACTOS_DE_GUION = new Map([
  ['título: la mirada que el mundo temerá', null],
  ['saharis ilmen', 'saharis']
]);

/**
 * Los doce episodios, sin arrastrar sus escenas: es lo que enseña la pantalla de
 * Desglose para elegir cuál se desglosa.
 * @returns {{episodio:number, titulo:string, acto:string, total_escenas:number}[]}
 */
export function episodios() {
  const lista = guiones.guiones || [];
  return lista.map((e) => ({
    episodio: Number(e.episodio),
    titulo: e.titulo,
    acto: e.acto,
    total_escenas: Number(e.total_escenas ?? (e.escenas || []).length)
  }));
}

/**
 * Un episodio entero del guion.
 * @param {number|string} n
 * @returns {object}
 */
function buscarEpisodio(n) {
  const lista = guiones.guiones || [];
  const encontrado = lista.find((e) => Number(e.episodio) === Number(n));
  if (!encontrado) {
    throw new ErrorDeCara(
      `No existe el episodio ${n} en el guion. Debería estar en «guiones» de ` +
        `datos/guiones.json, que tiene los episodios del 1 al ${lista.length}.`,
      { reintentable: false, http: 400 }
    );
  }
  return encontrado;
}

/**
 * Las escenas de un episodio, en el orden en que se cuentan.
 * @param {number|string} n número de episodio.
 * @returns {object[]}
 */
export function escenasDeEpisodio(n) {
  return buscarEpisodio(n).escenas || [];
}

/**
 * Una escena del guion.
 * Los ids de escena son cadenas («3»), nunca números: se comparan como cadenas
 * para que «3» y 3 encuentren la misma escena y para que un id como «12A» no se
 * convierta en un NaN silencioso.
 * @param {number|string} episodio
 * @param {string|number} escena
 * @returns {object}
 */
export function escenaDeGuion(episodio, escena) {
  const elEpisodio = buscarEpisodio(episodio);
  const escenas = elEpisodio.escenas || [];
  const buscada = String(escena);
  const encontrada = escenas.find((e) => String(e.escena) === buscada);
  if (!encontrada) {
    throw new ErrorDeCara(
      `El episodio ${episodio} no tiene ninguna escena «${escena}». Debería estar en ` +
        `guiones.json, dentro de las ${escenas.length} escenas de ese episodio.`,
      { reintentable: false, http: 400 }
    );
  }
  return encontrada;
}

/**
 * Quién sale en una escena, ya limpio de la basura del parseo y sin repetidos.
 * Admite las dos formas de pedirlo: con la escena ya buscada, o con el episodio
 * y el número de escena, que es como la nombra el resto del sistema.
 * @param {object|number|string} escena la escena, o el número de episodio.
 * @param {string|number} [numeroEscena] el id de escena, si el primero es el episodio.
 * @returns {string[]} ids de personaje, en el orden del guion.
 */
export function personajesDeEscena(escena, numeroEscena) {
  const laEscena =
    numeroEscena !== undefined || typeof escena !== 'object' || escena === null
      ? escenaDeGuion(escena, numeroEscena)
      : escena;

  const limpios = [];
  for (const crudo of laEscena.personajes || []) {
    const nombre = String(crudo).trim();
    // Se compara en minúsculas y sin el punto final, que es lo que trae el
    // apellido mal cortado.
    const clave = nombre.toLowerCase().replace(/\.+$/, '');

    if (ARTEFACTOS_DE_GUION.has(clave)) {
      const sustituto = ARTEFACTOS_DE_GUION.get(clave);
      if (sustituto && !limpios.includes(sustituto)) limpios.push(sustituto);
      continue;
    }
    // Cualquier otro rótulo del guion que el parser tomara por personaje: un
    // encabezado nunca lleva dos puntos en un nombre de personaje.
    if (/^t[íi]tulo\s*:/.test(clave)) continue;

    if (nombre && !limpios.includes(nombre)) limpios.push(nombre);
  }
  return limpios;
}
