// Cliente de Google Cloud Storage a pelo, con fetch y nada más.
//
// Regla de oro de este archivo: las rutas que entran y salen son LÓGICAS
// («banco/madre/madre-ancla.png»). El prefijo del proyecto (GCS_PREFIX) lo pone
// y lo quita este módulo y NADIE más. Quien importe gcs.js no sabe que existe.

import { createHash, createSign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { entorno } from './entorno.js';
import { ErrorDeCara, deGoogle, esReintentable } from './errores.js';
import { token, AMBITOS, clavePrivada } from './auth.js';

// El host de las URLs firmadas y de la API. No identifica ninguna cuenta.
const ANFITRION = 'storage.googleapis.com';
const API = `https://${ANFITRION}/storage/v1/b`;
const API_SUBIDA = `https://${ANFITRION}/upload/storage/v1/b`;

// Límite propio, por debajo del de la plataforma: sin él la función se apaga
// sin excepción y el trabajo se queda «en curso» para siempre.
const LIMITE_MS = 45_000;

// Cuántas rutas admite una sola llamada a firmar(). Una pantalla de 400 planos
// no puede ser 400 peticiones, pero tampoco una sola gigante.
const MAXIMO_RUTAS = 200;

// Tope duro de Google para una URL firmada V4: siete días.
const MAXIMO_MINUTOS = 7 * 24 * 60;

// Tipos que se suben aquí, para no tener que decir el tipo en cada llamada.
const TIPOS = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  srt: 'text/plain; charset=utf-8'
};

/**
 * Lee un objeto como texto.
 * @param {string} ruta ruta lógica.
 * @returns {Promise<{texto:string, generacion:string, bytes:number}|null>} null si no existe.
 */
export async function leer(ruta) {
  const crudo = await descargar(ruta);
  if (crudo === null) return null;
  return { texto: crudo.datos.toString('utf8'), generacion: crudo.generacion, bytes: crudo.bytes };
}

/**
 * Lee un objeto como bytes.
 * @param {string} ruta ruta lógica.
 * @returns {Promise<{datos:Buffer, generacion:string, bytes:number}|null>} null si no existe.
 */
export async function leerBytes(ruta) {
  return descargar(ruta);
}

/**
 * Escribe un objeto con la subida simple (uploadType=media).
 * @param {string} ruta ruta lógica.
 * @param {Buffer|Uint8Array|string} datos contenido.
 * @param {{tipo?:string, generacion?:string|number|null}} [opciones]
 *   `generacion` añade ifGenerationMatch; 0 significa «solo si no existe».
 * @returns {Promise<{ruta:string, generacion:string, bytes:number}>}
 */
export async function escribir(ruta, datos, { tipo = null, generacion = null } = {}) {
  const ent = entorno();
  const objeto = aFisica(ruta, ent);
  const cuerpo = aBuffer(datos, ruta);

  const url = new URL(`${API_SUBIDA}/${encodeURIComponent(ent.bucket)}/o`);
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('name', objeto);
  url.searchParams.set('fields', 'name,generation,size');
  const conCondicion = generacion !== null && generacion !== undefined && generacion !== '';
  if (conCondicion) url.searchParams.set('ifGenerationMatch', String(generacion));

  const respuesta = await pedir(url, {
    method: 'POST',
    headers: { 'Content-Type': tipo || tipoPorExtension(ruta) },
    body: cuerpo
  }, `guardar «${ruta}» en el bucket`);

  const texto = await respuesta.text();

  if (respuesta.status === 412) {
    // Otro guardado ganó la carrera. Sale como 409 para que quien escriba
    // vuelva a leer, reaplique su cambio y guarde de nuevo. Es 4xx, así que la
    // cola no lo reintenta a ciegas: el reintento con sentido lo hace
    // `app/estado.js`, que sabe rehacer el cambio sobre la versión buena.
    const mensaje = String(generacion) === '0'
      ? `Ya existe «${ruta}» y se pidió crearlo solo si no estaba. No se ha tocado nada.`
      : `Alguien ha guardado otra versión de «${ruta}» mientras preparabas la tuya. No se pisa: se vuelve a leer la versión buena, se le aplica tu cambio y se guarda otra vez sin que tengas que hacer nada.`;
    throw new ErrorDeCara(mensaje, {
      detalle: texto || null,
      reintentable: esReintentable(409),
      http: 409
    });
  }

  if (respuesta.status === 404) {
    throw new ErrorDeCara(
      'El bucket donde se guarda todo no existe o la service account no lo ve. Revisa el nombre que pusiste en GCS_BUCKET y que la cuenta tenga permiso de escritura sobre él.',
      { detalle: texto || null, reintentable: false, http: 404 }
    );
  }

  if (!respuesta.ok) throw traducir(respuesta.status, texto, `guardar «${ruta}» en el bucket`);

  let datosRespuesta = {};
  try {
    datosRespuesta = JSON.parse(texto);
  } catch {
    // Se guardó bien pero el resumen no se entiende: no es motivo para fallar.
    datosRespuesta = {};
  }

  return {
    ruta,
    generacion: datosRespuesta.generation != null ? String(datosRespuesta.generation) : '',
    bytes: datosRespuesta.size != null ? Number(datosRespuesta.size) : cuerpo.length
  };
}

/**
 * Lista todo lo que cuelga de un prefijo lógico, página a página hasta el final.
 * @param {string} [prefijo] prefijo lógico; vacío lista el proyecto entero.
 * @returns {Promise<Array<{ruta:string, bytes:number, actualizado:string}>>}
 */
export async function listar(prefijo = '') {
  const ent = entorno();
  const raiz = prefijoFisico(prefijo, ent);
  const objetos = [];
  let pagina = null;
  const vistas = new Set();

  do {
    const url = new URL(`${API}/${encodeURIComponent(ent.bucket)}/o`);
    if (raiz) url.searchParams.set('prefix', raiz);
    url.searchParams.set('maxResults', '1000');
    url.searchParams.set('fields', 'nextPageToken,items(name,size,updated)');
    if (pagina) url.searchParams.set('pageToken', pagina);

    const respuesta = await pedir(url, { method: 'GET' }, `listar «${prefijo}» en el bucket`);
    const texto = await respuesta.text();

    if (respuesta.status === 404) {
      throw new ErrorDeCara(
        'El bucket donde se guarda todo no existe o la service account no lo ve. Revisa el nombre que pusiste en GCS_BUCKET.',
        { detalle: texto || null, reintentable: false, http: 404 }
      );
    }
    if (!respuesta.ok) throw traducir(respuesta.status, texto, `listar «${prefijo}» en el bucket`);

    let datos;
    try {
      datos = JSON.parse(texto);
    } catch {
      throw new ErrorDeCara(
        'Google ha contestado algo que no se entiende al listar los archivos del bucket.',
        { detalle: texto || null, reintentable: true, http: 502 }
      );
    }

    for (const objeto of datos.items ?? []) {
      const logica = aLogica(objeto.name, ent);
      if (logica === null) continue;   // fuera del prefijo del proyecto: no es nuestro
      objetos.push({
        ruta: logica,
        bytes: Number(objeto.size ?? 0),
        actualizado: objeto.updated ?? ''
      });
    }

    pagina = datos.nextPageToken ?? null;
    // Un token repetido sería una vuelta infinita: 400 planos son más de una
    // página, pero ninguna página se visita dos veces.
    if (pagina) {
      if (vistas.has(pagina)) break;
      vistas.add(pagina);
    }
  } while (pagina);

  return objetos;
}

/**
 * Borra un objeto.
 * @param {string} ruta ruta lógica.
 * @returns {Promise<boolean>} true si se borró, false si no estaba.
 */
export async function borrar(ruta) {
  const ent = entorno();
  const objeto = aFisica(ruta, ent);
  const url = new URL(`${API}/${encodeURIComponent(ent.bucket)}/o/${encodeURIComponent(objeto)}`);

  const respuesta = await pedir(url, { method: 'DELETE' }, `borrar «${ruta}» del bucket`);
  if (respuesta.status === 404) {
    await respuesta.arrayBuffer();
    return false;
  }
  if (!respuesta.ok) throw traducir(respuesta.status, await respuesta.text(), `borrar «${ruta}» del bucket`);
  await respuesta.arrayBuffer();
  return true;
}

/**
 * Firma URLs V4 para mirar u oír lo generado sin que pase por la función.
 * La firma se hace aquí, con node:crypto: no hay ninguna llamada a Google.
 * @param {string[]} rutas rutas lógicas, hasta 200.
 * @param {{minutos?:number}} [opciones] validez; por defecto 6 horas.
 * @returns {Promise<Record<string,string>>} ruta lógica → URL firmada.
 */
export async function firmar(rutas, { minutos = 360 } = {}) {
  const lista = Array.isArray(rutas) ? rutas : [rutas];

  if (lista.length > MAXIMO_RUTAS) {
    throw new ErrorDeCara(
      `Se han pedido ${lista.length} enlaces de una vez y el máximo por llamada es ${MAXIMO_RUTAS}. Pide menos y repite: la pantalla los va cogiendo por tandas.`,
      { reintentable: false, http: 400 }
    );
  }

  const vigencia = Math.floor(Math.max(1, Math.min(Number(minutos) || 0, MAXIMO_MINUTOS)) * 60);
  const ent = entorno();
  const sa = ent.sa;

  if (!sa?.client_email) {
    throw new ErrorDeCara(
      'No se pueden preparar los enlaces para ver lo generado: al JSON de la service account le falta el correo de la cuenta, y ese correo forma parte de la firma.',
      { reintentable: false, http: 500 }
    );
  }

  const clave = clavePrivada(sa);

  // Paso 0: la fecha manda en la firma. Formato básico ISO-8601 en UTC,
  // «20260905T104500Z», y su día suelto «20260905».
  const marca = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const dia = marca.slice(0, 8);

  // Paso 1: el ámbito de la credencial, siempre con «auto» como región y
  // «goog4_request» al final.
  const ambito = `${dia}/auto/storage/goog4_request`;
  const credencial = `${sa.client_email}/${ambito}`;

  const urls = {};

  for (const ruta of lista) {
    const objeto = aFisica(ruta, ent);

    // Paso 2: el recurso canónico. Es «/bucket/objeto» con cada segmento
    // codificado en RFC 3986 pero dejando las barras tal cual: si se codifican,
    // la firma no cuadra y Google devuelve un 403 que parece falta de permisos.
    const recurso = `/${codificarSegmentos(ent.bucket)}/${codificarSegmentos(objeto)}`;

    // Paso 3: la query canónica. Los cinco parámetros de la firma, cada clave y
    // cada valor codificados enteros (aquí la barra de la credencial SÍ se
    // codifica), ordenados por clave y unidos con «&».
    const parametros = [
      ['X-Goog-Algorithm', 'GOOG4-RSA-SHA256'],
      ['X-Goog-Credential', credencial],
      ['X-Goog-Date', marca],
      ['X-Goog-Expires', String(vigencia)],
      ['X-Goog-SignedHeaders', 'host']
    ];
    const query = parametros
      .map(([c, v]) => [codificar(c), codificar(v)])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
      .map(([c, v]) => `${c}=${v}`)
      .join('&');

    // Paso 4: las cabeceras firmadas. Solo «host», en minúscula, con salto de
    // línea al final, y la lista de nombres firmados aparte.
    const cabeceras = `host:${ANFITRION}\n`;
    const firmadas = 'host';

    // Paso 5: la petición canónica. Seis líneas, en este orden y sin sobras.
    // El cuerpo va como UNSIGNED-PAYLOAD porque un GET no lleva cuerpo.
    const peticionCanonica = [
      'GET',
      recurso,
      query,
      cabeceras,
      firmadas,
      'UNSIGNED-PAYLOAD'
    ].join('\n');

    // Paso 6: la cadena a firmar. Algoritmo, fecha, ámbito y el SHA-256 de la
    // petición canónica en hexadecimal minúscula.
    const cadena = [
      'GOOG4-RSA-SHA256',
      marca,
      ambito,
      createHash('sha256').update(peticionCanonica, 'utf8').digest('hex')
    ].join('\n');

    // Paso 7: la firma RSA-SHA256 con la clave privada de la cuenta, también en
    // hexadecimal minúscula.
    let firma;
    try {
      firma = createSign('RSA-SHA256').update(cadena, 'utf8').sign(clave, 'hex');
    } catch (fallo) {
      throw new ErrorDeCara(
        'La clave privada de la service account no se puede usar para firmar los enlaces: node no la reconoce como una clave válida. Vuelve a pegar en GCP_SERVICE_ACCOUNT el archivo tal cual lo descargaste de Google.',
        { detalle: fallo?.message ?? null, reintentable: false, http: 500 }
      );
    }

    // Paso 8: la URL final es el recurso, la misma query en el mismo orden, y
    // la firma pegada al final.
    urls[ruta] = `https://${ANFITRION}${recurso}?${query}&X-Goog-Signature=${firma}`;
  }

  return urls;
}

/**
 * Traduce una ruta lógica a la dirección gs:// completa que entiende Vertex.
 * @param {string} ruta ruta lógica; puede acabar en «/» para nombrar una carpeta.
 * @returns {string} «gs://{bucket}/{prefijo}/{ruta}»
 */
export function gsUri(ruta) {
  const ent = entorno();
  return `gs://${ent.bucket}/${aFisica(ruta, ent, { permitirCarpeta: true })}`;
}

/**
 * Traduce una dirección gs:// a ruta lógica.
 * @param {string} uri por ejemplo «gs://bucket/prefijo/veo/teaser/C3/1/x.mp4».
 * @returns {string|null} la ruta lógica, o null si no es de este bucket o cae
 *   fuera del prefijo del proyecto.
 */
export function desdeGsUri(uri) {
  if (typeof uri !== 'string' || !uri.startsWith('gs://')) return null;
  const resto = uri.slice('gs://'.length);
  const corte = resto.indexOf('/');
  if (corte < 0) return null;

  const ent = entorno();
  if (resto.slice(0, corte) !== ent.bucket) return null;
  return aLogica(resto.slice(corte + 1), ent);
}

// --- Cocina interna -------------------------------------------------------

/** Descarga un objeto con alt=media. null si no existe. */
async function descargar(ruta) {
  const ent = entorno();
  const objeto = aFisica(ruta, ent);
  const url = new URL(`${API}/${encodeURIComponent(ent.bucket)}/o/${encodeURIComponent(objeto)}`);
  url.searchParams.set('alt', 'media');

  const respuesta = await pedir(url, { method: 'GET' }, `leer «${ruta}» del bucket`);

  if (respuesta.status === 404) {
    await respuesta.arrayBuffer();
    return null;   // no existir no es un fallo: es una respuesta
  }
  if (!respuesta.ok) throw traducir(respuesta.status, await respuesta.text(), `leer «${ruta}» del bucket`);

  const datos = Buffer.from(await respuesta.arrayBuffer());
  return {
    datos,
    generacion: respuesta.headers.get('x-goog-generation') ?? '',
    bytes: datos.length
  };
}

/** Una petición a la API con token, límite de tiempo y errores en español. */
async function pedir(url, opciones, contexto) {
  const acceso = await token(AMBITOS.almacen);

  const aborto = new AbortController();
  const reloj = setTimeout(() => aborto.abort(), LIMITE_MS);
  try {
    return await fetch(url, {
      ...opciones,
      headers: { ...(opciones.headers ?? {}), Authorization: `Bearer ${acceso}` },
      signal: aborto.signal
    });
  } catch (fallo) {
    throw new ErrorDeCara(
      aborto.signal.aborted
        ? `El bucket ha tardado demasiado al ${contexto}. Puede ser un momento malo de la red; inténtalo otra vez.`
        : `No se ha podido hablar con el bucket al ${contexto}. Puede ser la red; inténtalo otra vez.`,
      { detalle: fallo?.message ?? null, reintentable: true, http: 504 }
    );
  } finally {
    clearTimeout(reloj);
  }
}

/** Convierte una respuesta mala en ErrorDeCara, con el texto de Google literal. */
function traducir(http, texto, contexto) {
  if (http === 401 || http === 403) {
    return new ErrorDeCara(
      `La service account no tiene permiso para ${contexto}. Dale a esa cuenta el papel de administrador de objetos de almacenamiento sobre el bucket y vuelve a probar.`,
      { detalle: texto || null, reintentable: false, http }
    );
  }
  return deGoogle(http, texto, contexto);
}

/** El prefijo del proyecto, sin barras sueltas a los lados. */
function raizDelProyecto(ent) {
  return String(ent.prefijo ?? '').replace(/^\/+|\/+$/g, '');
}

/** Ruta lógica → nombre de objeto real, con el prefijo del proyecto delante. */
function aFisica(ruta, ent, { permitirCarpeta = false } = {}) {
  const limpia = validarRuta(ruta, { permitirCarpeta });
  const raiz = raizDelProyecto(ent);
  return raiz ? `${raiz}/${limpia}` : limpia;
}

/** Nombre de objeto real → ruta lógica. null si cae fuera del prefijo. */
function aLogica(nombre, ent) {
  const raiz = raizDelProyecto(ent);
  if (!raiz) return nombre;
  if (nombre === raiz) return '';
  if (!nombre.startsWith(`${raiz}/`)) return null;
  return nombre.slice(raiz.length + 1);
}

/** Prefijo lógico → prefijo real. El vacío significa «el proyecto entero». */
function prefijoFisico(prefijo, ent) {
  const raiz = raizDelProyecto(ent);
  const texto = String(prefijo ?? '').replace(/^\/+/, '');
  if (texto.split('/').includes('..')) {
    throw new ErrorDeCara(
      `«${prefijo}» no es un sitio válido dentro del proyecto: no se puede salir de su carpeta.`,
      { reintentable: false, http: 400 }
    );
  }
  if (!raiz) return texto;
  return texto ? `${raiz}/${texto}` : `${raiz}/`;
}

/** Comprueba que una ruta lógica es utilizable y la devuelve limpia. */
function validarRuta(ruta, { permitirCarpeta = false } = {}) {
  if (typeof ruta !== 'string' || ruta.trim() === '') {
    throw new ErrorDeCara(
      'Se ha pedido un archivo del bucket sin decir cuál. Es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 400 }
    );
  }
  const limpia = ruta.replace(/^\/+/, '');
  if (limpia === '') {
    throw new ErrorDeCara(
      'Se ha pedido un archivo del bucket sin decir cuál. Es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 400 }
    );
  }
  if (limpia.split('/').includes('..')) {
    throw new ErrorDeCara(
      `«${ruta}» no es un archivo válido dentro del proyecto: no se puede salir de su carpeta.`,
      { reintentable: false, http: 400 }
    );
  }
  if (!permitirCarpeta && limpia.endsWith('/')) {
    throw new ErrorDeCara(
      `«${ruta}» nombra una carpeta, no un archivo. Es un fallo del propio estudio, no de tu cuenta.`,
      { reintentable: false, http: 400 }
    );
  }
  return limpia;
}

/** Lo que se escribe siempre acaba en Buffer, venga como venga. */
function aBuffer(datos, ruta) {
  if (Buffer.isBuffer(datos)) return datos;
  if (typeof datos === 'string') return Buffer.from(datos, 'utf8');
  if (datos instanceof Uint8Array || datos instanceof ArrayBuffer) return Buffer.from(datos);
  throw new ErrorDeCara(
    `Se ha intentado guardar «${ruta}» con un contenido que no es ni texto ni bytes. Es un fallo del propio estudio, no de tu cuenta.`,
    { reintentable: false, http: 500 }
  );
}

/** Tipo de contenido a ojo de la extensión, para no repetirlo en cada llamada. */
function tipoPorExtension(ruta) {
  const punto = ruta.lastIndexOf('.');
  const extension = punto >= 0 ? ruta.slice(punto + 1).toLowerCase() : '';
  return TIPOS[extension] ?? 'application/octet-stream';
}

/**
 * Codificación RFC 3986 completa: encodeURIComponent deja sin tocar !'()*, y
 * la firma V4 los quiere codificados.
 */
function codificar(texto) {
  return encodeURIComponent(texto).replace(/[!'()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

/** Igual que codificar(), pero respetando las barras que separan carpetas. */
function codificarSegmentos(ruta) {
  return String(ruta).split('/').map(codificar).join('/');
}
