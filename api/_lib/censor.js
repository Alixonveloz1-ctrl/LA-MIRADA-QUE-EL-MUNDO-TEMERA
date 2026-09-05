// El censor.
//
// Se instala en la primera línea del handler, antes de cualquier `await`, y
// sobrescribe TODOS los caminos de salida de la respuesta: `res.json`,
// `res.end`, y también `res.send` y `res.write` si existen. No se puede saltar
// por olvido porque no queda ninguna puerta sin vigilar.
//
// Qué se tacha, esté a la profundidad que esté, en cadenas, en arrays, en
// objetos y en los propios nombres de las claves (docs/contrato.md §3):
//
//   · la clave privada y su id       — nunca, sin excepción, ni un fragmento
//   · el client_email y cualquier …@….iam.gserviceaccount.com
//   · el project_id y el número de proyecto
//   · el nombre del bucket y el prefijo
//   · ya29.…, cabeceras Bearer y cualquier JWT de tres tramos
//
// LA ÚNICA EXCEPCIÓN, escrita a propósito: una URL firmada V4 de
// storage.googleapis.com se deja pasar entera. Lleva el bucket en la ruta y el
// correo de la service account dentro de X-Goog-Credential, y sin esas dos
// cosas no es una URL: es texto roto. Es lo que permite mirar el PNG y
// reproducir el MP4 sin que pasen por la función —que es justo lo que salva el
// límite de 4,5 MB— y caduca en seis horas. La clave privada NO entra en la
// excepción: si apareciera dentro de una URL, se tacha igual.
//
// Rendimiento: los secretos se compilan UNA vez (y se reutilizan mientras el
// entorno sea el mismo) en una sola expresión regular, y cada cadena se recorre
// de una pasada. Nada de encadenar replace tras replace sobre textos largos.

import { Buffer } from 'node:buffer';

/** Lo que se ve en lugar del secreto. Igual en enmascarar(): se lee siempre igual. */
const TACHADO = '«tachado»';

/** Un literal más corto que esto tacharía media respuesta. Ver nota en literales(). */
const MINIMO_LITERAL = 3;

/** Marca para no volver a envolver una respuesta ya vigilada. */
const YA_VIGILADA = Symbol.for('mirada.censor.instalado');

/**
 * Patrones que valen siempre, haya entorno o no: son formas, no valores.
 * El orden importa: en una alternancia gana la primera que casa, así que las
 * más largas van antes.
 *
 * Todos los «muchos» van con tope. Un `+` suelto delante de un carácter
 * obligatorio (una arroba, un punto) hace que sobre un texto largo el motor
 * pruebe desde cada posición y retroceda hasta el final: eso es el reemplazo
 * O(n²) que hay que evitar. Con tope, el trabajo es lineal. Los topes son muy
 * superiores a lo que mide cualquiera de estas cosas de verdad.
 */
const PATRONES = [
  // Bloque PEM completo. Cualquier clave, sea la nuestra o la de otro.
  '-----BEGIN[\\s\\S]{0,16384}?-----END[^-\\n]{0,64}-----',
  // Bloque PEM sin cerrar (una clave cortada a la mitad sigue siendo una clave).
  '-----BEGIN[\\s\\S]*',
  // El par "private_key": "…" dentro de un JSON que venga como texto.
  '"(?:private_key|private_key_id|client_secret|access_token|refresh_token|id_token)"\\s{0,8}:\\s{0,8}"(?:[^"\\\\]|\\\\.){0,16384}"',
  // El correo de cualquier service account, sea la nuestra o no.
  '[\\w.+-]{1,64}@[\\w-]{1,63}\\.iam\\.gserviceaccount\\.com',
  // Token de acceso de Google.
  '\\bya29\\.[\\w.\\-]{1,4096}',
  // Cabecera de autorización.
  '\\bBearer\\s{1,8}[A-Za-z0-9._~+/=-]{1,4096}',
  // JWT con cabecera reconocible.
  '\\beyJ[A-Za-z0-9_-]{5,4096}\\.[A-Za-z0-9_-]{8,4096}\\.[A-Za-z0-9_-]{8,4096}',
  // JWT de tres tramos aunque no empiece por eyJ. Los tramos largos evitan
  // confundirlo con un id de modelo ("gemini-3.1-flash-image" no llega). El
  // tope de 512 no es capricho: es el único patrón que puede intentarse en
  // muchísimas posiciones de un texto largo, y con él un texto de varios MB
  // sigue costando décimas de segundo en vez de minutos.
  '\\b[A-Za-z0-9_-]{16,512}\\.[A-Za-z0-9_-]{16,512}\\.[A-Za-z0-9_-]{16,512}\\b',
  // El número de proyecto, que es como aparece en todo lo que dice Google.
  'projects/\\d{4,}',
];

/**
 * Nombres de campo cuyo valor no se enseña jamás, venga de donde venga y valga
 * lo que valga. Se comparan sin mayúsculas, guiones ni subrayados.
 */
const CLAVES_SENSIBLES = new Set([
  'privatekey', 'privatekeyid', 'privatekeypem', 'clientemail', 'clientid',
  'clientsecret', 'clientx509certurl', 'accesstoken', 'refreshtoken', 'idtoken',
  'authorization', 'proxyauthorization', 'xclave', 'apikey', 'xgoogapikey',
  'token', 'bearer', 'credentials', 'serviceaccount', 'gcpserviceaccount',
  'gcpprojectnumber', 'claveacceso',
]);

/** Secretos ya compilados por entorno: el mismo `ent` no se compila dos veces. */
const compilados = new WeakMap();
let soloPatrones = null;

// ---------------------------------------------------------------------------
// Instalación
// ---------------------------------------------------------------------------

/**
 * Sobrescribe las salidas de `res` para que nada salga sin pasar por aquí.
 * Se llama en la primera línea del handler. Acepta `ent` vacío: entonces vigila
 * solo por patrones, que es justo lo que hace falta cuando el fallo es que el
 * entorno no se ha podido leer.
 *
 * Devuelve los secretos compilados, por si el handler quiere tachar algo a mano.
 */
export function instalarCensor(res, ent) {
  const secretos = compilarSecretos(ent);
  if (!res || typeof res !== 'object') return secretos;
  if (res[YA_VIGILADA]) return res[YA_VIGILADA];

  const original = {
    json: typeof res.json === 'function' ? res.json.bind(res) : null,
    send: typeof res.send === 'function' ? res.send.bind(res) : null,
    end: typeof res.end === 'function' ? res.end.bind(res) : null,
    write: typeof res.write === 'function' ? res.write.bind(res) : null,
  };

  // Casi todas las plataformas implementan `json` llamando a `send`, y `send`
  // llamando a `end`. Como las tres están vigiladas, una misma respuesta se
  // repasaría tres veces. Ya limpia la primera, así que mientras dura una
  // salida las de dentro pasan tal cual: se revisa una vez, no tres.
  let saliendo = false;
  const unaVez = (revisada, cruda) => function (...args) {
    if (saliendo) return cruda(...args);   // ya viene revisada de la capa de fuera
    saliendo = true;
    try {
      return revisada(...args);
    } finally {
      saliendo = false;
    }
  };

  if (original.json) {
    res.json = unaVez((cuerpo) => original.json(tachar(cuerpo, secretos)), original.json);
  }

  // `res.send` no lo nombra el contrato, pero es una salida como las demás:
  // dejarla sin vigilar sería dejar la puerta de atrás abierta.
  if (original.send) {
    res.send = unaVez((cuerpo) => original.send(tacharSalida(cuerpo, secretos)), original.send);
  }

  if (original.end) {
    res.end = unaVez((trozo, ...resto) => (
      trozo == null || typeof trozo === 'function'
        ? original.end(trozo, ...resto)
        : original.end(tacharSalida(trozo, secretos), ...resto)
    ), original.end);
  }

  // Igual que `send`: quien escriba por trozos también tiene que pasar por aquí.
  if (original.write) {
    res.write = unaVez((trozo, ...resto) => (
      trozo == null || typeof trozo === 'function'
        ? original.write(trozo, ...resto)
        : original.write(tacharSalida(trozo, secretos), ...resto)
    ), original.write);
  }

  Object.defineProperty(res, YA_VIGILADA, {
    value: secretos, enumerable: false, writable: false, configurable: true,
  });

  return secretos;
}

// ---------------------------------------------------------------------------
// Tachar
// ---------------------------------------------------------------------------

/**
 * Recorre lo que sea —cadenas, arrays, objetos, claves de objeto y texto
 * suelto— y devuelve una copia con los secretos sustituidos por «tachado».
 * No toca el original.
 *
 * `secretos` admite lo compilado por compilarSecretos(), el objeto de
 * entorno(), una lista de cadenas, o nada (y entonces vigila solo por patrones).
 */
export function tachar(valor, secretos) {
  return recorrer(valor, normalizar(secretos), new WeakSet());
}

/**
 * true solo si el valor COMPLETO es una URL firmada V4 de storage.googleapis.com.
 * Un texto que contenga una URL no cuenta: la excepción es para la URL entera.
 */
export function esUrlFirmada(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  // Una firmada V4 nunca es corta: este corte se salta el 99 % de las cadenas.
  if (t.length < 80 || !/^https:\/\//i.test(t)) return false;
  if (!t.toLowerCase().includes('storage.googleapis.com')) return false;

  let url;
  try {
    url = new URL(t);
  } catch {
    return false;
  }

  const anfitrion = url.hostname.toLowerCase();
  if (anfitrion !== 'storage.googleapis.com' && !anfitrion.endsWith('.storage.googleapis.com')) {
    return false;
  }

  const p = url.searchParams;
  const algoritmo = p.get('X-Goog-Algorithm') || '';
  return algoritmo.startsWith('GOOG4-')
    && Boolean(p.get('X-Goog-Credential'))
    && Boolean(p.get('X-Goog-Date'))
    && Boolean(p.get('X-Goog-Expires'))
    && Boolean(p.get('X-Goog-SignedHeaders'))
    && Boolean(p.get('X-Goog-Signature'));
}

/**
 * Compila la lista de secretos de un entorno en una sola expresión regular.
 * Se hace una vez y se guarda: recompilar por cadena sería el error de
 * rendimiento clásico de un censor.
 *
 * Acepta el objeto de entorno(), o { extras:[...] } con cadenas sueltas.
 */
export function compilarSecretos(ent) {
  if (ent && typeof ent === 'object') {
    const guardado = compilados.get(ent);
    if (guardado) return guardado;
  }

  const literales = ordenar(literalesDe(ent));
  const literalesDeClave = ordenar(clavesDe(ent));

  const compilado = {
    compilado: true,
    literales,
    // Para comparar números sueltos (el número de proyecto puede llegar como number).
    exactos: new Set(literales),
    expresion: expresion([...literales.map(escapar), ...PATRONES]),
    // Solo la clave privada: es lo único que se tacha incluso dentro de una URL firmada.
    clave: expresion([...literalesDeClave.map(escapar), PATRONES[0], PATRONES[1], PATRONES[2]]),
  };

  if (ent && typeof ent === 'object') compilados.set(ent, compilado);
  return compilado;
}

// ---------------------------------------------------------------------------
// Las tripas
// ---------------------------------------------------------------------------

function normalizar(secretos) {
  if (!secretos) {
    if (!soloPatrones) soloPatrones = compilarSecretos(null);
    return soloPatrones;
  }
  if (secretos.compilado === true) return secretos;
  if (Array.isArray(secretos)) return compilarSecretos({ extras: secretos });
  if (typeof secretos === 'object') return compilarSecretos(secretos);
  return compilarSecretos({ extras: [String(secretos)] });
}

function recorrer(valor, sec, enCamino) {
  if (valor === null || valor === undefined) return valor;

  const tipo = typeof valor;
  if (tipo === 'string') return tacharCadena(valor, sec);
  if (tipo === 'number' || tipo === 'bigint') {
    // El número de proyecto puede llegar sin comillas.
    return sec.exactos.has(String(valor)) ? TACHADO : valor;
  }
  if (tipo === 'boolean') return valor;
  if (tipo === 'function' || tipo === 'symbol') return undefined;

  // A partir de aquí es un objeto.
  if (enCamino.has(valor)) return '«ciclo»';   // sin esto, un ciclo se lo come todo
  if (valor instanceof Date) return valor;
  // Bytes: no son texto y no se serializan como texto. Se dejan estar.
  if (Buffer.isBuffer(valor) || ArrayBuffer.isView(valor) || valor instanceof ArrayBuffer) {
    return valor;
  }

  enCamino.add(valor);
  try {
    if (Array.isArray(valor)) return valor.map((v) => recorrer(v, sec, enCamino));

    const salida = {};
    for (const [clave, dentro] of Object.entries(valor)) {
      // La clave también puede llevar un secreto dentro (un bucket, un correo).
      let nombre = tacharCadena(String(clave), sec);
      if (nombre !== String(clave) && Object.hasOwn(salida, nombre)) {
        // Dos claves distintas que acaban tachadas igual no se pisan.
        let n = 2;
        while (Object.hasOwn(salida, `${nombre} (${n})`)) n += 1;
        nombre = `${nombre} (${n})`;
      }
      salida[nombre] = esClaveSensible(clave) ? TACHADO : recorrer(dentro, sec, enCamino);
    }
    return salida;
  } finally {
    enCamino.delete(valor);
  }
}

function tacharCadena(s, sec) {
  if (!s) return s;

  if (esUrlFirmada(s)) {
    // LA EXCEPCIÓN. Se deja entera porque el bucket en la ruta y el correo en
    // X-Goog-Credential son parte de la firma: sin ellos la URL no abre nada.
    // Ni siquiera aquí pasa la clave privada.
    return sec.clave ? s.replace(sec.clave, sustituto) : s;
  }

  return sec.expresion ? s.replace(sec.expresion, sustituto) : s;
}

function sustituto(coincidencia) {
  // Del número de proyecto se tacha el número y se deja "projects/", que no es
  // secreto y ayuda a entender de qué hablaba el mensaje.
  if (/^projects\//i.test(coincidencia)) return `projects/${TACHADO}`;
  return TACHADO;
}

/** Un trozo de respuesta puede ser texto, bytes o un objeto por serializar. */
function tacharSalida(trozo, sec) {
  if (typeof trozo === 'string') return tacharCadena(trozo, sec);

  if (Buffer.isBuffer(trozo)) return deBytes(trozo, trozo.toString('utf8'), sec);
  if (trozo instanceof Uint8Array) {
    const copia = Buffer.from(trozo.buffer, trozo.byteOffset, trozo.byteLength);
    return deBytes(trozo, copia.toString('utf8'), sec);
  }

  if (trozo && typeof trozo === 'object') return tachar(trozo, sec);
  return trozo;
}

/**
 * Si en los bytes no había nada que tachar se devuelven los bytes originales,
 * intactos. Solo se reescriben cuando de verdad había un secreto dentro: entre
 * conservar unos bytes y no filtrar, no filtrar.
 */
function deBytes(original, texto, sec) {
  const limpio = tacharCadena(texto, sec);
  return limpio === texto ? original : Buffer.from(limpio, 'utf8');
}

function esClaveSensible(clave) {
  return CLAVES_SENSIBLES.has(String(clave).toLowerCase().replace(/[\s_.-]/g, ''));
}

// ---------------------------------------------------------------------------
// De dónde salen los literales
// ---------------------------------------------------------------------------

function literalesDe(ent) {
  const fuera = [];
  if (!ent || typeof ent !== 'object') return fuera;

  const sa = ent.sa && typeof ent.sa === 'object' ? ent.sa : null;
  if (sa) {
    apunta(fuera, sa.project_id);
    apunta(fuera, sa.client_email);
    apunta(fuera, sa.client_id);
    apunta(fuera, sa.private_key_id);
    apunta(fuera, sa.client_x509_cert_url);   // lleva el correo dentro
    for (const forma of formasDeClave(sa.private_key)) apunta(fuera, forma);
  }

  apunta(fuera, ent.bucket);
  if (ent.prefijo) apunta(fuera, ent.prefijo);   // el vacío no se tacha: no hay nada que tachar
  apunta(fuera, ent.numeroProyecto);
  apunta(fuera, ent.clave);                      // CLAVE_ACCESO es una credencial
  apunta(fuera, ent.montajeKey);                 // MONTAJE_KEY también: la comparten esta función y el montador

  if (Array.isArray(ent.extras)) for (const extra of ent.extras) apunta(fuera, extra);

  return fuera;
}

function clavesDe(ent) {
  const fuera = [];
  const sa = ent && typeof ent === 'object' && ent.sa && typeof ent.sa === 'object' ? ent.sa : null;
  if (!sa) return fuera;
  apunta(fuera, sa.private_key_id);
  for (const forma of formasDeClave(sa.private_key)) apunta(fuera, forma);
  return fuera;
}

/**
 * Todas las caras que puede tener la misma clave privada:
 *   · entera, tal cual
 *   · con los saltos escapados, que es como la guardan casi todos los paneles
 *   · sin saltos ninguno
 *   · línea a línea del cuerpo base64
 *   · ventanas de 32 caracteres dentro de cada línea, con paso 16
 *
 * Las ventanas nunca cruzan un salto de línea, así que valen igual para la
 * forma con saltos, la escapada y la de sin saltos: son los mismos caracteres
 * seguidos en las tres. Con eso, un trozo suelto de 48 caracteres o más de la
 * clave tampoco sale. Y 32 caracteres de base64 son 24 bytes de clave: que eso
 * aparezca por casualidad en otro sitio no pasa.
 */
function formasDeClave(clavePrivada) {
  if (!clavePrivada || typeof clavePrivada !== 'string') return [];

  const formas = [clavePrivada, clavePrivada.replace(/\n/g, '\\n'), clavePrivada.replace(/\s+/g, '')];

  const lineas = clavePrivada
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 16 && !l.startsWith('-----'));

  for (const linea of lineas) {
    formas.push(linea);
    for (let i = 0; i + 32 <= linea.length; i += 16) formas.push(linea.slice(i, i + 32));
  }

  return formas;
}

/**
 * Se descartan los literales de menos de tres caracteres. Un prefijo de una
 * letra convertiría media respuesta en «tachado» y dejaría al usuario sin el
 * mensaje que explica el fallo, que es peor remedio que la enfermedad.
 */
function apunta(lista, valor) {
  if (valor === null || valor === undefined) return;
  const s = String(valor);
  if (s.length < MINIMO_LITERAL) return;
  lista.push(s);
}

/** Sin repetidos y de más largo a más corto: en una alternancia gana el primero. */
function ordenar(lista) {
  return [...new Set(lista)].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
}

function escapar(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function expresion(trozos) {
  const utiles = trozos.filter(Boolean);
  if (!utiles.length) return null;
  return new RegExp(utiles.join('|'), 'gi');
}
