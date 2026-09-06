// El transporte. Todo lo que sale de la función hacia Google —Vertex, la
// síntesis de voz, el reconocimiento de voz y Cloud Run— pasa por aquí.
//
// Tres cosas hace este archivo, y ninguna más:
//
//   1. `llamar()`  — pone el token, pone el límite de tiempo y traduce a
//      español cualquier respuesta que no sea 2xx. No reintenta nada: los
//      reintentos viven en la cola del navegador, que es quien sabe si el
//      error era reintentable.
//   2. `urlModelo()` — compone la URL de un modelo de Vertex. Aquí vive la
//      trampa del 404 de los Gemini 3.x, escrita y comentada.
//   3. `urlServicio()` — compone la URL de las otras APIs de Google.
//
// El límite de tiempo propio no es un adorno. La plataforma corta la función a
// los 60 segundos y NO lanza ninguna excepción: se apaga y ya. Sin un límite
// propio por debajo, el activo se queda «generando» para siempre, sin fallo que
// enseñar y sin nadie que lo consulte después.

import { Buffer } from 'node:buffer';
import { entorno } from './entorno.js';
import { token, AMBITOS } from './auth.js';
import { ErrorDeCara, deGoogle } from './errores.js';
import { plazoPara } from './plazo.js';

// LO QUE ESPERA UNA LLAMADA SI NADIE DICE OTRA COSA, Y POR QUÉ AHORA ES EL TECHO.
//
// Esto valía 45 s, y era una trampa con la forma exacta de un valor razonable.
// Quien escribía una llamada nueva y no se acordaba de poner su límite no recibía
// ningún aviso: recibía 45 segundos. Y como `plazoPara()` ya recorta a lo que
// quede del plazo de la función, ese 45 no protegía de nada — solo cortaba antes
// de tiempo lo que necesitaba más.
//
// Pasó dos veces. La segunda fue la ficha de difusión: el modelo de texto se
// pasa del minuto razonando, y moría a los 45 s exactos con un mensaje que
// hablaba de la plataforma y no del número que de verdad la había cortado, que
// estaba escrito en otro archivo.
//
// Ahora el que se olvida recibe TODO el tiempo que hay, y quien quiere fallar
// antes —la comprobación de Salud, el lanzamiento del montaje— lo pide. Es la
// misma trampa del revés, y del revés no muerde: pedir menos tiempo es una
// decisión que se toma a conciencia; necesitar más se descubre en producción.
const LIMITE_MS = 180_000;

// Suelos y techos del límite. Menos de un segundo no es un límite, es un corte.
//
// EL TECHO ESTUVO EN 55 s Y FUE UN DESCUIDO CARO. Cuando el plazo de la función
// subió de 55 a 200 —medidos, ver api/g.js— y el límite de la imagen de 45 a 170,
// ESTE número se quedó atrás, y como recorta TODAS las llamadas a Vertex daba
// igual lo que pidiera nadie: seguían muriendo a los 55 s. Un tope escondido en
// otro archivo, tres números que tenían que cuadrar y solo dos actualizados.
//
// Ahora es 180 s: por debajo del plazo de la función menos su margen, que es lo
// único que este techo tiene que garantizar. Y los tres números los compara un
// invariante, para que no se puedan volver a separar.
const LIMITE_MINIMO_MS = 1_000;
const LIMITE_MAXIMO_MS = 180_000;

// La versión de la API de Vertex que usa todo el estudio.
const VERSION = 'v1';

// El host de Vertex cuando se pide a «global». Con región concreta lleva la
// región delante. No identifica ninguna cuenta: es la puerta pública de Google.
const HOST_VERTEX = 'aiplatform.googleapis.com';

// Un id de modelo puede venir de una variable de entorno, así que se comprueba
// antes de meterlo en una URL: sin esto, un valor con barras compondría una
// ruta distinta de la que se cree que se está pidiendo.
const ID_DE_MODELO = /^[A-Za-z0-9][A-Za-z0-9._@-]*$/;
const NOMBRE_DE_REGION = /^[a-z][a-z0-9-]*$/;

// Solo se manda el token de la service account a Google. Si una URL apunta a
// otro sitio, se para aquí: un token entregado por error no se puede recoger.
const ANFITRION_DE_GOOGLE = /(^|\.)googleapis\.com$/;

// Cómo se llaman los servicios cuando hay que nombrarlos en un mensaje.
const SERVICIOS = {
  aiplatform: 'Vertex AI',
  texttospeech: 'la síntesis de voz de Google',
  speech: 'el reconocimiento de voz de Google',
  run: 'Cloud Run',
  storage: 'el almacenamiento del bucket'
};

// ---------------------------------------------------------------------------
// La llamada
// ---------------------------------------------------------------------------

/**
 * Habla con Google: firma la petición con el token de la service account, la
 * corta si tarda más de lo que la función puede esperar, y devuelve el JSON.
 *
 * @param {string|URL} url a dónde se llama. Tiene que ser un host de Google.
 * @param {object|string|null} cuerpo lo que se manda; se serializa a JSON si no
 *        es ya texto. En GET y HEAD no va cuerpo.
 * @param {{metodo?:string, limiteMs?:number, contexto?:object}} [opciones]
 *        `contexto` es lo que se sabe de la llamada para poder explicar un
 *        fallo con palabras: { que, modelo, region, variable, bytes, servicio }.
 *
 *        FALTA EN EL CONTRATO: docs/contrato.md §12 escribe las opciones de
 *        `llamar` como `{ metodo, limiteMs }`, pero `deGoogle(http, cuerpo,
 *        contexto)` necesita ese contexto para escribir sus mensajes: sin
 *        `modelo` y `region` el 404 de los Gemini 3.x no puede explicar que
 *        esos modelos solo viven en «global», y sin `bytes` un 413 no puede
 *        decir cuánto pesaba. Se añade como tercera opción, opcional, y lo que
 *        se puede se deduce solo de la URL y del cuerpo. Conviene apuntarlo en
 *        el contrato.
 * @returns {Promise<object>} el JSON de la respuesta; `{}` si viene vacía.
 */
export async function llamar(url, cuerpo, { metodo = 'POST', limiteMs = LIMITE_MS, contexto = {} } = {}) {
  const destino = comprobarDestino(url);
  const verbo = String(metodo || 'POST').toUpperCase();
  const cuerpoTexto = serializar(cuerpo, verbo);
  const bytes = cuerpoTexto === null ? 0 : Buffer.byteLength(cuerpoTexto, 'utf8');
  const ctx = mezclarContexto(destino, bytes, contexto);

  const acceso = await token(AMBITOS.plataforma);

  // El límite de esta llamada, pero nunca más de lo que le queda a la función.
  // Si ya no queda nada, `plazoPara` lanza con un mensaje en español en vez de
  // dejar que la plataforma corte la función y devuelva un 504 mudo.
  const espera = acotarLimite(plazoPara(limiteMs, `llamando a Google para ${ctx.que || 'esto'}`));
  const aborto = new AbortController();
  const reloj = setTimeout(() => aborto.abort(), espera);

  let respuesta;
  let texto;
  try {
    const cabeceras = { Authorization: `Bearer ${acceso}` };
    if (cuerpoTexto !== null) cabeceras['Content-Type'] = 'application/json; charset=utf-8';

    respuesta = await fetch(destino, {
      method: verbo,
      headers: cabeceras,
      body: cuerpoTexto === null ? undefined : cuerpoTexto,
      signal: aborto.signal
    });
    // El cuerpo también se lee dentro del límite: una respuesta que se queda a
    // medias cuelga igual que una petición que no llega.
    texto = await respuesta.text();
  } catch (fallo) {
    if (aborto.signal.aborted) {
      // Este es el corte a propósito. Se avisa de que el trabajo puede seguir
      // vivo del lado de Google, porque en las operaciones largas lo está: se
      // consulta después y aparece.
      throw new ErrorDeCara(
        `La operación ha tardado más de ${enSegundos(espera)}, que es todo lo que la función ` +
        'puede esperar, y se ha cortado a propósito antes de que la plataforma la apagara sin ' +
        'decir nada. Puede que Google la esté terminando por su cuenta: no se da por perdida, se ' +
        'consulta después y, si acabó, aparecerá su resultado. Se puede volver a intentar.',
        { detalle: fallo?.message ?? null, reintentable: true, http: 504 }
      );
    }
    throw new ErrorDeCara(
      `No se ha podido ${ctx.que}: se ha cortado la conexión con Google antes de recibir la ` +
      'respuesta. No es la cuenta ni la petición; suele ser la red. Se puede volver a intentar.',
      { detalle: fallo?.message ?? null, reintentable: true, http: 502 }
    );
  } finally {
    clearTimeout(reloj);
  }

  if (!respuesta.ok) {
    // El texto de Google viaja literal a `detalle`. Aquí no se traduce ni se
    // resume: traducir a Google es mentir.
    throw deGoogle(respuesta.status, texto, ctx);
  }

  if (!texto || !texto.trim()) return {};   // un 200 sin cuerpo es una respuesta válida

  try {
    return JSON.parse(texto);
  } catch (fallo) {
    throw new ErrorDeCara(
      `Google ha contestado bien al ${ctx.que}, pero lo que ha mandado no se entiende: no es el ` +
      'JSON que se esperaba. No se puede seguir con eso. Debajo está, tal cual, lo que llegó.',
      { detalle: recorte(texto), reintentable: true, http: 502 }
    );
  }
}

// ---------------------------------------------------------------------------
// Las URLs
// ---------------------------------------------------------------------------

/**
 * La URL de un modelo de Vertex.
 *
 * AQUÍ ESTÁ LA TRAMPA DEL 404 DE LOS GEMINI 3.x, y es la razón de que esta
 * función exista en vez de escribirse la URL a mano en cada sitio:
 *
 *   · región «global» → host `https://aiplatform.googleapis.com` (sin prefijo
 *     de región) y la ruta lleva `locations/global`.
 *   · región concreta → host `https://{region}-aiplatform.googleapis.com` y la
 *     ruta lleva `locations/{region}`.
 *
 * Los Gemini 3.x SOLO se sirven desde «global». Pedirlos a una región concreta
 * —o pedir «global» al host regional— devuelve un 404 que parece falta de
 * acceso y no lo es. Ese 404 ya costó un fallo real; `datos.js` fuerza «global»
 * para esos modelos y `errores.js` lo explica en pantalla si aun así aparece.
 *
 * @param {{id:string, region:string}} modelo tal cual lo da `datos.js`.
 * @param {string} verbo `generateContent`, `predictLongRunning`, `fetchPredictOperation`…
 * @param {string} [proyecto] el project id. Si no se dice, sale del
 *        `project_id` de la service account, nunca de una constante.
 * @returns {string} la URL completa.
 */
export function urlModelo({ id, region } = {}, verbo, proyecto) {
  const idLimpio = String(id ?? '').trim();
  if (!ID_DE_MODELO.test(idLimpio)) {
    throw new ErrorDeCara(
      `«${idLimpio || '(vacío)'}» no sirve como nombre de modelo: se compondría una dirección ` +
      'distinta de la que se cree que se está pidiendo. Los ids salen de datos/serie.json y se ' +
      'sustituyen con las variables de entorno (IMAGE_MODEL, VEO_MODEL, TTS_MODEL, MUSIC_MODEL, ' +
      'STT_MODEL, TEXTO_MODEL); revisa qué lleva escrito la que hayas puesto.',
      { reintentable: false, http: 500 }
    );
  }

  const regionLimpia = String(region ?? '').trim().toLowerCase();
  if (!NOMBRE_DE_REGION.test(regionLimpia)) {
    throw new ErrorDeCara(
      `«${regionLimpia || '(vacía)'}» no sirve como región de Google. La región por defecto se ` +
      'pone en la variable GCP_LOCATION; los modelos Gemini 3.x, además, solo se sirven desde ' +
      '«global».',
      { reintentable: false, http: 500 }
    );
  }

  const verboLimpio = String(verbo ?? '').trim();
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(verboLimpio)) {
    throw new ErrorDeCara(
      'Se ha pedido una llamada a un modelo sin decir qué se le pide (generateContent, ' +
      'predictLongRunning, fetchPredictOperation…). Es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  const proyectoLimpio = String(proyecto ?? '').trim() || proyectoDeLaCuenta();

  // El host: con región delante, salvo «global», que va al host pelado.
  const host = regionLimpia === 'global' ? HOST_VERTEX : `${regionLimpia}-${HOST_VERTEX}`;

  // La ruta: `locations/global` o `locations/{region}`, siempre coherente con
  // el host de arriba. Las dos mitades tienen que decir lo mismo.
  return `https://${host}/${VERSION}/projects/${encodeURIComponent(proyectoLimpio)}` +
    `/locations/${regionLimpia}/publishers/google/models/${idLimpio}:${verboLimpio}`;
}

/**
 * La URL de un servicio de Google que no es Vertex: `texttospeech.googleapis.com`,
 * `speech.googleapis.com` y `run.googleapis.com` (o su variante regional,
 * `{region}-run.googleapis.com`).
 *
 * @param {string} host el host, con o sin `https://`.
 * @param {string} ruta la ruta, con o sin barra inicial.
 * @returns {string} la URL completa.
 */
export function urlServicio(host, ruta) {
  const limpio = String(host ?? '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();

  if (!limpio || !ANFITRION_DE_GOOGLE.test(limpio) || limpio.includes('/')) {
    throw new ErrorDeCara(
      `«${host ?? '(vacío)'}» no es un servicio de Google. Solo se habla con googleapis.com: ` +
      'texttospeech.googleapis.com, speech.googleapis.com y run.googleapis.com. A cualquier otro ' +
      'sitio no se le manda la credencial de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  const camino = String(ruta ?? '').trim();
  if (!camino) {
    throw new ErrorDeCara(
      `Se ha pedido llamar a ${limpio} sin decir a qué parte del servicio. Es un fallo del propio ` +
      'estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  return `https://${limpio}/${camino.replace(/^\/+/, '')}`;
}

// ---------------------------------------------------------------------------
// Cocina interna
// ---------------------------------------------------------------------------

/** El project id sale siempre de la service account, nunca de una constante. */
function proyectoDeLaCuenta() {
  const ent = entorno();
  const proyecto = ent.sa && ent.sa.project_id ? String(ent.sa.project_id).trim() : '';
  if (!proyecto) {
    throw new ErrorDeCara(
      'El JSON de la service account no dice a qué proyecto pertenece: le falta el campo ' +
      '«project_id», y de ahí es de donde sale el proyecto, nunca de una constante del código. ' +
      'Vuelve a pegar en GCP_SERVICE_ACCOUNT el archivo entero que descargaste de Google.',
      { reintentable: false, http: 500 }
    );
  }
  return proyecto;
}

/** Comprueba que la URL existe, es absoluta y va a Google. Devuelve el texto. */
function comprobarDestino(url) {
  const texto = url instanceof URL ? url.toString() : String(url ?? '').trim();
  let analizada;
  try {
    analizada = new URL(texto);
  } catch {
    throw new ErrorDeCara(
      `«${texto || '(vacía)'}» no es una dirección completa a la que se pueda llamar. Es un fallo ` +
      'del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  if (analizada.protocol !== 'https:' || !ANFITRION_DE_GOOGLE.test(analizada.hostname)) {
    throw new ErrorDeCara(
      `No se llama a «${analizada.hostname}»: el permiso de acceso de tu service account solo ` +
      'viaja a googleapis.com y por https. Es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  return analizada.toString();
}

/** El cuerpo, ya en texto. `null` cuando la llamada no lleva cuerpo. */
function serializar(cuerpo, verbo) {
  const sinCuerpo = verbo === 'GET' || verbo === 'HEAD';

  if (cuerpo === null || cuerpo === undefined) return null;

  if (sinCuerpo) {
    throw new ErrorDeCara(
      `Se ha intentado mandar un cuerpo en una petición ${verbo}, y ${verbo} no lleva cuerpo. Es ` +
      'un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  if (typeof cuerpo === 'string') return cuerpo;

  try {
    return JSON.stringify(cuerpo);
  } catch (fallo) {
    throw new ErrorDeCara(
      'Lo que se iba a mandar a Google no se puede escribir como JSON: hay algo dentro que se ' +
      'referencia a sí mismo. Es un fallo del propio estudio, no de tu cuenta.',
      { detalle: fallo?.message ?? null, reintentable: false, http: 500 }
    );
  }
}

/** El límite, dentro de lo razonable y siempre por debajo del de la plataforma. */
function acotarLimite(limiteMs) {
  const pedido = Number(limiteMs);
  if (!Number.isFinite(pedido) || pedido <= 0) return LIMITE_MS;
  return Math.min(Math.max(Math.round(pedido), LIMITE_MINIMO_MS), LIMITE_MAXIMO_MS);
}

/**
 * Junta lo que el que llama sabe con lo que se puede leer de la propia URL.
 * Lo que diga quien llama manda; lo demás se deduce, para que un 404 o un 413
 * puedan explicarse aunque nadie haya pasado contexto.
 */
function mezclarContexto(url, bytes, contexto) {
  const deducido = contextoDeUrl(url);
  const ctx = { ...deducido };
  // El peso solo se dice cuando había algo que pesar: un 413 tiene que decir
  // cuánto pesaba, y «0 bytes» sería peor que no decirlo.
  if (bytes > 0) ctx.bytes = bytes;
  for (const [clave, valor] of Object.entries(contexto || {})) {
    if (valor !== null && valor !== undefined && valor !== '') ctx[clave] = valor;
  }
  if (!ctx.que) ctx.que = deducido.que;
  return ctx;
}

/** Saca de la URL el modelo, la región y el servicio, si están escritos ahí. */
function contextoDeUrl(url) {
  const texto = String(url);
  let anfitrion = '';
  try {
    anfitrion = new URL(texto).hostname;
  } catch {
    anfitrion = '';
  }

  // «us-central1-aiplatform.googleapis.com» → «aiplatform»
  const primerTrozo = anfitrion.split('.')[0] || '';
  const familia = primerTrozo.replace(/^[a-z0-9-]+?-(?=[a-z]+$)/, '');
  const servicio = SERVICIOS[familia] || (anfitrion || null);

  const conModelo = texto.match(/\/models\/([^:/?#]+)/);
  const conRegion = texto.match(/\/locations\/([^/?#]+)/);

  const modelo = conModelo ? decodeURIComponent(conModelo[1]) : null;
  const region = conRegion ? decodeURIComponent(conRegion[1]) : null;

  return {
    que: modelo ? `llamar al modelo «${modelo}»` : `hablar con ${servicio || 'Google'}`,
    modelo,
    region,
    servicio
  };
}

/** «45 segundos», «1 segundo». Un límite se dice en segundos, no en milisegundos. */
function enSegundos(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s === 1 ? '1 segundo' : `${s} segundos`;
}

/** Un cuerpo que no era JSON puede venir enorme; se enseña el principio. */
function recorte(texto, maximo = 2000) {
  const t = String(texto);
  return t.length <= maximo ? t : `${t.slice(0, maximo)}… (recortado: eran ${t.length} caracteres)`;
}

// ---------------------------------------------------------------------------
// Las grafías de un modelo
// ---------------------------------------------------------------------------

/** La grafía que contestó la última vez, por modelo. Se recuerda por proceso. */
const GRAFIA_BUENA = new Map();

/**
 * Llama a un modelo probando sus GRAFÍAS en orden hasta que una conteste.
 *
 * POR QUÉ ESTO EXISTE, y costó un despliegue entero descubrirlo: Vertex publica
 * el mismo modelo con DOS nombres —el de preview y el definitivo—. Los dos son
 * reales, y cuál de ellos contesta depende del proyecto. Pedir solo uno y
 * recibir un 404 se lee como «tu cuenta no tiene ese modelo», y es mentira: lo
 * tiene, con el otro nombre.
 *
 * Solo se pasa a la siguiente grafía ante 404 y 403, que son los dos que
 * significan «este nombre no, prueba otro». Cualquier otro error se lanza tal
 * cual: un 429 es cuota, un 400 es el cuerpo, y probar más nombres no arregla
 * ninguno de los dos y además gasta.
 *
 * La que funciona se recuerda y se prueba primero la próxima vez.
 *
 * @param {{id:string, ids?:string[], region:string, variable:string}} modelo
 * @param {(id:string) => Promise<any>} hacer qué hacer con cada grafía
 * @returns {Promise<any>}
 */
/**
 * El mismo modelo, escrito con una de sus grafías y pedido a LA REGIÓN DE ESA
 * GRAFÍA, no a la de la primera.
 *
 * Importa porque una lista de grafías puede mezclar generaciones: un Gemini 3.x
 * solo se sirve desde «global» y un 2.5 desde la región de la cuenta. Pedir el
 * 2.5 a «global» porque el 3.x de al lado va ahí devuelve el mismo 404 que se
 * está intentando esquivar, y encima parece que tampoco existe con ese nombre.
 *
 * @param {{id:string, region:string, regiones?:Object<string,string>}} modelo
 * @param {string} id la grafía que toca probar.
 */
export function comoGrafia(modelo, id) {
  const regiones = (modelo && modelo.regiones) || null;
  return { ...modelo, id, region: (regiones && regiones[id]) || modelo.region };
}

export async function conGrafias(modelo, hacer) {
  const grafias = Array.isArray(modelo.ids) && modelo.ids.length ? modelo.ids : [modelo.id];
  const memoria = `${modelo.variable || ''}:${grafias[0]}`;
  const recordada = GRAFIA_BUENA.get(memoria);
  const orden = recordada
    ? [recordada, ...grafias.filter((g) => g !== recordada)]
    : grafias.slice();

  let ultimo = null;
  for (const id of orden) {
    try {
      const salida = await hacer(id);
      GRAFIA_BUENA.set(memoria, id);
      return salida;
    } catch (fallo) {
      const http = Number(fallo && fallo.http);
      if (http !== 404 && http !== 403) throw fallo;
      ultimo = fallo;
    }
  }

  // Se acabaron las grafías. El mensaje dice CUÁLES se probaron: sin eso, quien
  // lo lea no sabe si el problema es el nombre o el acceso.
  throw new ErrorDeCara(
    `Ninguna de las formas conocidas de este modelo contesta en tu proyecto. Se ha probado como: ` +
      `${orden.map((g) => `${g} (en ${comoGrafia(modelo, g).region})`).join(', ')}. ` +
      `Si el modelo existe con otro nombre, se pone en la variable ` +
      `${modelo.variable || 'de entorno'} y se sustituye sin tocar código.`,
    {
      detalle: ultimo && ultimo.detalle ? ultimo.detalle : (ultimo && ultimo.mensaje) || null,
      reintentable: false,
      http: (ultimo && ultimo.http) || 404,
    },
  );
}
