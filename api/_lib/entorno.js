// El entorno: lo único que sabe de la cuenta.
//
// Aquí no hay ni un project id, ni un bucket, ni un correo, ni una clave
// escritos. Todo sale de variables de entorno, y el project id sale SIEMPRE de
// `sa.project_id`, nunca de una constante ni de otra variable.
//
// Tampoco hay ni un id de modelo escrito a mano: la tabla de modelos se arma
// leyendo datos/serie.json y dejando que IMAGE_MODEL, VEO_MODEL, TTS_MODEL,
// MUSIC_MODEL, STT_MODEL y TEXTO_MODEL sustituyan lo que haga falta sin tocar
// el código.
//
// Se lee una vez y se cachea. Si alguna de las variables cambia (las
// herramientas de herramientas/ las cambian a mano para medir), se vuelve a
// leer: la huella de abajo lo detecta sin volver a parsear nada caro.
//
// Este módulo NO importa datos.js a propósito: datos.js necesita esta tabla de
// modelos, y dos módulos que se importan el uno al otro no arrancan.

import { readFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { ErrorDeCara } from './errores.js';

/** datos/serie.json, desde api/_lib/. vercel.json ya incluye datos/** en la función. */
const RUTA_SERIE = new URL('../../datos/serie.json', import.meta.url);

const REGION_POR_DEFECTO = 'us-central1';
const NIVELES = ['calidad', 'medio', 'economico'];

/** Lo mismo que pone el censor. Un valor tachado se lee igual en todas partes. */
const TACHADO = '«tachado»';

/** Las variables que mira este módulo, en el orden en que se documentan. */
const VARIABLES = [
  'GCP_SERVICE_ACCOUNT', 'GCS_BUCKET', 'GCS_PREFIX', 'GCP_LOCATION',
  'IMAGE_MODEL', 'VEO_MODEL', 'TTS_MODEL', 'MUSIC_MODEL', 'STT_MODEL', 'TEXTO_MODEL',
  'MONTAJE_JOB', 'MONTAJE_REGION', 'MONTAJE_URL', 'MONTAJE_KEY',
  'CLAVE_ACCESO',
  'GCP_PROJECT_NUMBER',
];

/**
 * Lo que hay que saber de cada variable para poder enseñarla en Salud: si es
 * obligatoria, y qué se pierde si falta.
 *
 * Existe porque la trampa de despliegue que más tiempo hace perder es que Vercel
 * NO aplica una variable nueva a un despliegue ya construido: se pone la
 * variable, Salud sigue diciendo que falta, y se busca el fallo donde no está.
 * Para poder decirlo hay que saber primero cuál falta.
 */
export const FICHA_DE_VARIABLES = [
  { nombre: 'GCP_SERVICE_ACCOUNT', obligatoria: true,
    para: 'El JSON completo de la service account. De aquí sale el project id: nunca de una constante.' },
  { nombre: 'GCS_BUCKET', obligatoria: true,
    para: 'El nombre del bucket, sin «gs://». Es la única verdad: estado, banco, keyframes, clips, audio y montajes.' },
  { nombre: 'GCS_PREFIX', obligatoria: false,
    para: 'La carpeta del proyecto dentro del bucket. Vacío significa la raíz del bucket.' },
  { nombre: 'GCP_LOCATION', obligatoria: false,
    para: 'NO hace falta ponerla si el bucket está en us-central1, que es el valor por defecto. El JSON de la service account NO trae región: ese campo no existe en él. Los Gemini 3.x van siempre por «global» pase lo que pase.' },
  { nombre: 'IMAGE_MODEL', obligatoria: false, para: 'Sustituye el modelo de imagen sin tocar código.' },
  { nombre: 'VEO_MODEL', obligatoria: false, para: 'Sustituye el modelo de vídeo sin tocar código.' },
  { nombre: 'TTS_MODEL', obligatoria: false, para: 'Sustituye el modelo de voz sin tocar código.' },
  { nombre: 'MUSIC_MODEL', obligatoria: false, para: 'Sustituye el modelo de música sin tocar código.' },
  { nombre: 'STT_MODEL', obligatoria: false, para: 'Sustituye el modelo de alineación sin tocar código.' },
  { nombre: 'TEXTO_MODEL', obligatoria: false, para: 'Sustituye el modelo de texto del desglose sin tocar código.' },
  { nombre: 'MONTAJE_JOB', obligatoria: false,
    para: 'NO hace falta ponerla: el nombre del Job sale de despliegue/montador.txt, que es el mismo archivo que usa el instalador para crearlo. Solo si le pusiste otro nombre.' },
  { nombre: 'MONTAJE_REGION', obligatoria: false,
    para: 'NO hace falta ponerla: se usa la de GCP_LOCATION, que por defecto es us-central1. Solo si desplegaste el montador en otra región.' },
  { nombre: 'MONTAJE_URL', obligatoria: false,
    para: 'NO hace falta ponerla: la dirección se compone sola con el proyecto, la región y el nombre del Job. Solo si el montador está en otro sitio.' },
  { nombre: 'MONTAJE_KEY', obligatoria: false,
    para: 'La clave que solo comparten esta función y el montador. Sin ella el montaje funciona igual: lanzar el Job ya exige las credenciales de la cuenta. Es un cinturón de más, no un requisito.' },
  { nombre: 'CLAVE_ACCESO', obligatoria: false,
    para: 'El pestillo de la puerta. Sin ella la función queda abierta y cualquiera que dé con la URL gasta el dinero del proyecto.' },
  { nombre: 'GCP_PROJECT_NUMBER', obligatoria: false,
    para: 'El número de proyecto, solo para que el censor pueda tacharlo entero. Sin él lo caza igual por el patrón «projects/<dígitos>».' },
];

/**
 * Qué variables están puestas y cuáles no, sin devolver ni un valor. Lo usa
 * Salud, y tiene que funcionar aunque falten las obligatorias: ese es justo el
 * caso que hay que poder enseñar.
 */
export function estadoDeVariables() {
  return FICHA_DE_VARIABLES.map((f) => ({
    ...f,
    puesta: Boolean((process.env[f.nombre] || '').trim()),
  }));
}

let cacheHuella = null;
let cacheValor = null;
let cacheSerie = null;

// ---------------------------------------------------------------------------
// La puerta del módulo
// ---------------------------------------------------------------------------

/**
 * → { sa, bucket, prefijo, region, modelos, montajeJob, montajeRegion,
 *     montajeUrl, montajeKey, clave, numeroProyecto }
 *
 * Ya no hay `concurrencia`: el estudio genera de una en una y la variable
 * CONCURRENCIA se ha quitado. No la leía nadie en el servidor —la cola vive en
 * el navegador— y ofrecerla invitaba a subirla, que con las cuotas de una cuenta
 * nueva es la forma más rápida de llenar la pantalla de errores que parecen
 * falta de acceso a los modelos.
 *
 * `sa` es el JSON de la service account ya parseado. `modelos` es
 * { imagen:{calidad,medio,economico}, veo:{calidad,medio,economico},
 *   tts, musica, stt, texto }, y cada modelo es
 * { id, ids, region, regiones, variable }.
 *
 * `ids` son TODAS las grafías con las que Vertex publica ese modelo —el nombre
 * de preview y el definitivo—, en el orden en que hay que probarlas, y
 * `regiones` dice a qué región va cada una. Sin las dos cosas, `conGrafias()` se
 * queda probando un solo nombre y un 404 se lee como falta de acceso.
 */
export function entorno() {
  const huella = huellaDelEntorno();
  if (cacheValor && cacheHuella === huella) return cacheValor;

  const sa = leerServiceAccount();
  const bucket = leerBucket();
  const prefijo = leerPrefijo();
  const region = (process.env.GCP_LOCATION || '').trim() || REGION_POR_DEFECTO;

  const valor = {
    sa,
    bucket,
    prefijo,
    region,
    modelos: tablaDeModelos(serie(), region),
    // El nombre del Job NO hace falta ponerlo en Vercel: lo crea el instalador de
    // este mismo repositorio y el nombre está en despliegue/montador.txt, que
    // leen los dos. Poner a mano una variable cuyo valor ya conoce el
    // repositorio es trabajo que no ayuda a nadie y una cosa más que puede
    // escribirse mal. MONTAJE_JOB sigue mandando si alguien la pone.
    montajeJob: (process.env.MONTAJE_JOB || '').trim() || nombreDelJob(),
    montajeRegion: (process.env.MONTAJE_REGION || '').trim() || region,
    // Las dos que imprime montador/instalar.sh al terminar. Ninguna es
    // obligatoria: sin ellas no se puede montar, pero todo lo demás del estudio
    // funciona, y Salud tiene que poder decir que faltan sin que la función se
    // caiga al arrancar.
    montajeUrl: (process.env.MONTAJE_URL || '').trim() || null,
    montajeKey: (process.env.MONTAJE_KEY || '').trim() || null,
    clave: (process.env.CLAVE_ACCESO || '').trim(),
    // FALTA EN EL CONTRATO: el censor tiene que tachar «el número de proyecto»
    // (§3) y ese número no viene en el JSON de la service account, que solo trae
    // el project_id. Se lee de GCP_PROJECT_NUMBER si alguien la pone; si no,
    // queda en null y el censor lo caza igualmente por el patrón
    // «projects/<dígitos>», que es como aparece en todo lo que dice Google.
    numeroProyecto: (process.env.GCP_PROJECT_NUMBER || '').trim() || null,
  };

  cacheHuella = huella;
  cacheValor = valor;
  return valor;
}

/**
 * Deja ver lo justo para reconocer un valor sin revelarlo: tres primeros
 * caracteres, «…», tres últimos. Lo que mide menos de 8 caracteres sale entero
 * tachado, porque con tan poco enseñar seis de ocho es enseñarlo todo.
 *
 * (El ejemplo de docs/contrato.md §12 escribe "mi-proyecto-4711" → "mi-…-711"
 * con un guion de más: los tres últimos caracteres de esa cadena son "711". Se
 * aplica la regla escrita, que es la que se puede comprobar.)
 */
export function enmascarar(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (s === '') return '';          // el prefijo vacío se enseña vacío: significa «sin prefijo»
  if (s.length < 8) return TACHADO;
  return `${s.slice(0, 3)}…${s.slice(-3)}`;
}

// ---------------------------------------------------------------------------
// La service account
// ---------------------------------------------------------------------------

function leerServiceAccount() {
  const crudo = (process.env.GCP_SERVICE_ACCOUNT || '').trim();
  if (!crudo) {
    throw new ErrorDeCara(
      'Falta la variable de entorno GCP_SERVICE_ACCOUNT. Tiene que contener el JSON completo ' +
      'de la service account, tal y como lo descarga Google: el que lleva dentro "project_id", ' +
      '"client_email" y "private_key". Si el panel no deja pegar saltos de línea, vale el mismo ' +
      'JSON codificado en base64.',
      { http: 500 },
    );
  }

  const texto = crudo.startsWith('{') ? crudo : deBase64(crudo);

  let sa;
  try {
    sa = JSON.parse(texto);
  } catch (e) {
    throw new ErrorDeCara(
      'GCP_SERVICE_ACCOUNT está puesta pero lo que hay dentro no es un JSON válido. Tiene que ' +
      'ser el archivo entero de la service account, desde la primera llave hasta la última ' +
      '(o ese mismo archivo en base64). Cuidado al pegarlo: si el panel parte las líneas de la ' +
      'private_key, el JSON se rompe.',
      { detalle: e.message, http: 500 },
    );
  }

  if (!sa || typeof sa !== 'object' || Array.isArray(sa)) {
    throw new ErrorDeCara(
      'GCP_SERVICE_ACCOUNT no contiene un objeto JSON. Se espera el archivo de la service ' +
      'account, con sus campos "project_id", "client_email" y "private_key".',
      { http: 500 },
    );
  }

  for (const campo of ['project_id', 'client_email', 'private_key']) {
    if (!sa[campo] || typeof sa[campo] !== 'string') {
      throw new ErrorDeCara(
        `El JSON de GCP_SERVICE_ACCOUNT no trae el campo "${campo}", o viene vacío. Falta medio ` +
        'archivo: hay que pegar el que descarga Google entero, sin recortar. El project id sale ' +
        'de ahí y de ningún otro sitio.',
        { http: 500 },
      );
    }
  }

  // Muchos paneles guardan la clave con los saltos de línea escapados. Sin
  // deshacerlos, la firma del token no vale y Google contesta un 401 que parece
  // otra cosa.
  if (sa.private_key.includes('\\n')) sa.private_key = sa.private_key.replace(/\\n/g, '\n');

  if (!sa.private_key.includes('-----BEGIN')) {
    throw new ErrorDeCara(
      'La "private_key" de GCP_SERVICE_ACCOUNT no parece una clave: le falta la línea ' +
      '"-----BEGIN PRIVATE KEY-----". Se copia entera, con esa línea, con la de "-----END ' +
      'PRIVATE KEY-----" y con todo lo de en medio.',
      { http: 500 },
    );
  }

  return sa;
}

function deBase64(crudo) {
  let texto;
  try {
    texto = Buffer.from(crudo, 'base64').toString('utf8').trim();
  } catch {
    texto = '';
  }
  if (!texto.startsWith('{')) {
    throw new ErrorDeCara(
      'GCP_SERVICE_ACCOUNT no empieza por "{" y tampoco es base64 de un JSON. Se admiten las dos ' +
      'formas: el JSON de la service account tal cual, o ese mismo JSON codificado en base64 ' +
      '(que es lo cómodo cuando el panel no deja pegar saltos de línea).',
      { http: 500 },
    );
  }
  return texto;
}

// ---------------------------------------------------------------------------
// El almacén
// ---------------------------------------------------------------------------

function leerBucket() {
  let bucket = (process.env.GCS_BUCKET || '').trim();
  if (!bucket) {
    throw new ErrorDeCara(
      'Falta la variable de entorno GCS_BUCKET. Tiene que contener el nombre del bucket a ' +
      'secas, sin "gs://" y sin barras: por ejemplo "mirada-produccion". La carpeta de dentro, ' +
      'si la hay, va en GCS_PREFIX.',
      { http: 500 },
    );
  }

  if (bucket.startsWith('gs://')) bucket = bucket.slice('gs://'.length);
  bucket = bucket.replace(/\/+$/, '');

  if (bucket.includes('/')) {
    throw new ErrorDeCara(
      'GCS_BUCKET lleva una barra dentro: eso ya no es el nombre del bucket, es una ruta. En ' +
      'GCS_BUCKET va solo el nombre (por ejemplo "mirada-produccion") y la carpeta de dentro va ' +
      'aparte, en GCS_PREFIX.',
      { http: 500 },
    );
  }

  if (bucket.length < 3 || bucket.length > 222 || /\s/.test(bucket)) {
    throw new ErrorDeCara(
      'GCS_BUCKET no parece un nombre de bucket: tiene que medir entre 3 y 222 caracteres y no ' +
      'llevar espacios. Se copia tal y como aparece en la consola de Google Cloud, sin "gs://".',
      { http: 500 },
    );
  }

  return bucket;
}

/** El prefijo se guarda normalizado, sin barras al principio ni al final. */
function leerPrefijo() {
  const crudo = (process.env.GCS_PREFIX || '').trim();
  return crudo.replace(/^\/+/, '').replace(/\/+$/, '');
}

// ---------------------------------------------------------------------------
// La tabla de modelos
// ---------------------------------------------------------------------------

function tablaDeModelos(datos, region) {
  const m = (datos && datos.modelos) || {};

  const modelos = {
    imagen: familia(m.imagen, 'modelos.imagen', 'IMAGE_MODEL', region),
    veo: familia(m.video, 'modelos.video', 'VEO_MODEL', region),
    tts: suelto(datos && datos.voces && datos.voces.modelo, 'voces.modelo', 'TTS_MODEL', region),
    musica: suelto(datos && datos.musica && datos.musica.modelo, 'musica.modelo', 'MUSIC_MODEL', region),
    // FALTA EN EL CONTRATO: ni docs/contrato.md ni datos/serie.json dicen qué
    // modelo usa Speech-to-Text. La v1 de `speech:recognize` elige el suyo si no
    // se manda el campo `model`, así que aquí el id queda en null —nunca escrito
    // a mano— y quien llame omite ese campo. Si algún día hace falta uno
    // concreto se declara en serie.json o se pone en STT_MODEL.
    stt: suelto(datos && datos.subtitulos && datos.subtitulos.modelo, null, 'STT_MODEL', region),
    texto: suelto(m.texto, 'modelos.texto', 'TEXTO_MODEL', region),
  };

  sustituirFamilia(modelos.imagen, process.env.IMAGE_MODEL, 'IMAGE_MODEL', region);
  sustituirFamilia(modelos.veo, process.env.VEO_MODEL, 'VEO_MODEL', region);
  sustituirSuelto(modelos.tts, process.env.TTS_MODEL, region);
  sustituirSuelto(modelos.musica, process.env.MUSIC_MODEL, region);
  sustituirSuelto(modelos.stt, process.env.STT_MODEL, region);
  sustituirSuelto(modelos.texto, process.env.TEXTO_MODEL, region);

  return modelos;
}

/** Las tres calidades de una familia (imagen y vídeo), tal como vienen del dato. */
function familia(nudo, donde, variable, region) {
  const salida = {};
  for (const nivel of NIVELES) {
    const dato = nudo && nudo[nivel];
    if (!dato || !dato.id) {
      throw new ErrorDeCara(
        `datos/serie.json no declara el modelo del nivel "${nivel}" en ${donde}. Los ids de ` +
        'modelo salen de ese archivo y de ninguna otra parte: no se escriben en el código. ' +
        `Mientras tanto se puede poner uno con la variable ${variable}.`,
        { http: 500 },
      );
    }
    salida[nivel] = modeloDe(dato, variable, region);
  }
  return salida;
}

/** Un modelo sin niveles. `donde` en null significa que el dato puede no existir. */
function suelto(nudo, donde, variable, region) {
  const id = nudo && nudo.id ? String(nudo.id) : null;
  if (!id && donde) {
    throw new ErrorDeCara(
      `datos/serie.json no declara ningún modelo en ${donde}. Los ids de modelo salen de ese ` +
      `archivo, nunca del código. Mientras tanto se puede poner uno con la variable ${variable}.`,
      { http: 500 },
    );
  }
  if (!id) return { id: null, ids: [], region, regiones: {}, variable };
  return modeloDe(nudo, variable, region);
}

/**
 * Un modelo de la tabla, con TODAS sus grafías y la región de cada una.
 *
 * ESTO ES LO QUE FALTABA Y COSTÓ UN DESPLIEGUE ENTERO. Vertex publica el mismo
 * modelo con dos nombres —el de preview y el definitivo—; `datos/serie.json` los
 * declara los dos en `ids` y `conGrafias()` los prueba en orden. Pero aquí se
 * construía el modelo con `{ id, region, variable }` y se tiraba `ids` por el
 * camino, así que `conGrafias()` recibía la lista vacía, se caía a `[modelo.id]`
 * y probaba un solo nombre. El 404 que volvía nombraba una sola grafía —y eso
 * fue lo que delató el fallo: si de verdad se hubieran probado cuatro, el error
 * las habría dicho las cuatro.
 *
 * La región se calcula GRAFÍA A GRAFÍA, no una vez para todas: una lista puede
 * mezclar generaciones (un 3.x y un 2.5 del mismo modelo), y la regla de la
 * región depende de eso. Si el dato declara región, esa manda para todas.
 */
function modeloDe(dato, variable, region) {
  const id = String(dato.id);
  const declarada = dato.region ? String(dato.region) : null;
  const ids = grafiasDe(dato, id);
  const regiones = {};
  for (const grafia of ids) regiones[grafia] = regionDe(grafia, declarada, region);
  return { id, ids, region: regiones[id], regiones, variable };
}

/**
 * Las grafías a probar: las declaradas en `ids`, en su orden, y el `id` al final
 * si no estuviera entre ellas. El orden lo pone el dato a propósito —primero la
 * que Google sirve hoy a más proyectos—, así que aquí no se reordena.
 */
function grafiasDe(dato, id) {
  const declaradas = Array.isArray(dato.ids)
    ? dato.ids.map((g) => String(g).trim()).filter(Boolean)
    : [];
  const salida = [];
  for (const grafia of [...declaradas, id]) {
    if (!salida.includes(grafia)) salida.push(grafia);
  }
  return salida;
}

/**
 * La región de un modelo: la que declare el dato; si no la declara, «global»
 * para los Gemini 3.x —solo se sirven desde ahí, y pedirlos a una región
 * concreta devuelve un 404 que parece falta de acceso— y la región por defecto
 * para todo lo demás.
 */
function regionDe(id, declarada, porDefecto) {
  if (declarada) return String(declarada);
  if (/^gemini-3(\.\d+)?[-.]/i.test(String(id))) return 'global';
  return porDefecto;
}

/**
 * Sustituye una familia entera desde su variable de entorno. Formas aceptadas:
 *
 *   IMAGE_MODEL=gemini-3-pro-image                 → los tres niveles
 *   IMAGE_MODEL=gemini-2.5-flash-image@us-central1 → con región explícita
 *   IMAGE_MODEL=calidad:otro-modelo, medio:otro@global   → nivel a nivel
 *
 * Si se da solo el id, la región se recalcula con la regla de arriba: así, al
 * cambiar un nivel a un Gemini 3.x, no se queda pidiéndolo a us-central1.
 */
function sustituirFamilia(destino, crudo, variable, region) {
  const texto = (crudo || '').trim();
  if (!texto) return;

  let general = null;
  const porNivel = {};

  for (const trozo of texto.split(/[;,]/).map((t) => t.trim()).filter(Boolean)) {
    const conNivel = /^([A-Za-zÁÉÍÓÚáéíóúÑñ]+)\s*[:=]\s*(.+)$/.exec(trozo);
    if (conNivel) {
      const nivel = conNivel[1].toLowerCase();
      if (!NIVELES.includes(nivel)) {
        throw new ErrorDeCara(
          `La variable ${variable} nombra un nivel que no existe: "${conNivel[1]}". Los niveles ` +
          `son ${NIVELES.join(', ')}. Se escribe así: ${variable}=calidad:mi-modelo, ` +
          'medio:otro-modelo; o solo el id del modelo, y entonces vale para los tres niveles.',
          { http: 500 },
        );
      }
      porNivel[nivel] = conNivel[2].trim();
    } else {
      general = trozo;
    }
  }

  if (general) for (const nivel of NIVELES) aplicar(destino[nivel], general, variable, region);
  for (const [nivel, valor] of Object.entries(porNivel)) {
    aplicar(destino[nivel], valor, variable, region);
  }
}

function sustituirSuelto(destino, crudo, region) {
  const texto = (crudo || '').trim();
  if (!texto) return;
  aplicar(destino, texto, destino.variable, region);
}

/** Aplica «id» o «id@region» sobre una entrada de la tabla. */
function aplicar(entrada, valor, variable, region) {
  const corte = valor.lastIndexOf('@');
  const id = (corte === -1 ? valor : valor.slice(0, corte)).trim();
  const regionPedida = corte === -1 ? '' : valor.slice(corte + 1).trim();

  if (!id || /\s/.test(id)) {
    throw new ErrorDeCara(
      `La variable ${variable} no trae un id de modelo utilizable ("${valor}"). Se pone el id ` +
      'tal y como lo escribe Google, sin espacios, y si hace falta una región distinta se ' +
      'añade detrás con una arroba: mi-modelo@global.',
      { http: 500 },
    );
  }

  const laRegion = regionPedida || regionDe(id, null, region);

  entrada.id = id;
  entrada.region = laRegion;

  // Quien pone la variable nombra UNA grafía a mano, y esa es la que quiere. Las
  // que traía el dato se van con el id viejo: seguir probándolas sería llamar a
  // un modelo que nadie ha pedido, y encima taparía el error del que sí.
  entrada.ids = [id];
  entrada.regiones = { [id]: laRegion };
}

// ---------------------------------------------------------------------------
// Los datos y la huella del entorno
// ---------------------------------------------------------------------------

/** datos/serie.json, leído una sola vez por proceso. */
function serie() {
  if (cacheSerie) return cacheSerie;
  let texto;
  try {
    texto = readFileSync(RUTA_SERIE, 'utf8');
  } catch (e) {
    throw new ErrorDeCara(
      'No se ha podido leer datos/serie.json, que es de donde salen los ids de los modelos. Si ' +
      'esto pasa en la nube, el archivo no se ha subido con la función: vercel.json tiene que ' +
      'incluir datos/** en la función api/g.js.',
      { detalle: e.message, http: 500 },
    );
  }
  try {
    cacheSerie = JSON.parse(texto);
  } catch (e) {
    throw new ErrorDeCara(
      'datos/serie.json existe pero no es un JSON válido, así que no se puede saber qué modelos ' +
      'usa la serie. Se regenera con "npm run datos" desde datos/serie.base.json.',
      { detalle: e.message, http: 500 },
    );
  }
  return cacheSerie;
}

/**
 * Cadena que cambia si cambia cualquiera de las variables. Sirve para no volver
 * a parsear el JSON de la service account en cada llamada y, a la vez, no
 * quedarse con un valor viejo cuando una herramienta cambia el entorno a mano.
 */
function huellaDelEntorno() {
  return VARIABLES.map((v) => `${v}=${process.env[v] ?? ''}`).join('');
}

/**
 * El nombre del Job de Cloud Run del montador, leído de despliegue/montador.txt.
 *
 * Una sola fuente para los dos que lo necesitan: `instalar.sh`, que lo crea, y
 * este módulo, que lo lanza. Si el archivo no está —porque alguien desplegó solo
 * la carpeta `api/`— se cae al nombre que pone el instalador, que es el mismo.
 */
let cacheJob = null;
function nombreDelJob() {
  if (cacheJob !== null) return cacheJob;
  try {
    const texto = readFileSync(new URL('../../despliegue/montador.txt', import.meta.url), 'utf8');
    const linea = texto.split('\n').find((una) => una.trim().startsWith('job='));
    cacheJob = linea ? linea.split('=')[1].trim() : 'montador-mirada';
  } catch {
    cacheJob = 'montador-mirada';
  }
  return cacheJob;
}
