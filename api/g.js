// La puerta. Un solo endpoint para todo el estudio: `POST /api/g`, con el campo
// `modo` dentro del cuerpo.
//
// Este archivo no sabe hacer nada. Lo que sabe es en qué ORDEN se hacen las
// cosas, y ese orden es el de docs/contrato.md §12, sin excepciones:
//
//   1. `instalarCensor(res, ent)` — la primera línea, antes de cualquier await.
//   2. El método: solo POST (y OPTIONS, para el preflight si algún día hace falta).
//   3. La clave, si `CLAVE_ACCESO` está puesta.
//   4. El cuerpo, y dentro el `modo`.
//   5. El despacho contra la tabla de `_lib/modos.js`.
//   6. `X-Peso-Respuesta` con el tamaño real, puesto ANTES de enviar.
//   7. Y todo dentro de un try que no deja escapar ni una excepción.
//
// POR QUÉ EL CENSOR VA EN LA PRIMERA LÍNEA. Sobrescribe `res.json` y `res.end`,
// así que a partir de ahí no queda ninguna salida sin vigilar. Si se instalara
// más abajo, cualquier `return` de arriba —un 405, un 401, un fallo al leer el
// entorno— saldría sin pasar por él, y esos son justamente los caminos donde
// aparece el JSON de la service account. `entornoSiSePuede()` es síncrona, no
// toca `res` y no lanza: solo sirve para que el censor sepa qué literales tachar
// cuando el entorno se puede leer. El fallo de verdad, si lo hay, lo vuelve a
// levantar `entorno()` dentro del try, ya vigilado y con su frase en español.
//
// POR QUÉ `X-Peso-Respuesta` SE MIDE Y NO SE RAZONA. El límite de la plataforma
// son 4,5 MB por petición y por respuesta, y el de la respuesta es el traicionero:
// pasarse parece un tiempo agotado. La única forma de cumplirlo es medir el
// cuerpo ya serializado, modo a modo, y eso es lo que el navegador guarda en
// `estado.pesos` y enseña la pantalla de Salud.
//
// POR QUÉ NO HAY CORS ABIERTO. La aplicación se sirve del mismo sitio que esta
// función, así que no hay petición de otro origen que permitir. Abrirlo a `*`
// dejaría que cualquier página del mundo gastara la cuenta cuando `CLAVE_ACCESO`
// no está puesta, que es el caso por defecto.

import { Buffer } from 'node:buffer';
import { createHash, timingSafeEqual } from 'node:crypto';

import { instalarCensor, tachar } from './_lib/censor.js';
import { entorno } from './_lib/entorno.js';
import { ErrorDeCara, comoRespuesta } from './_lib/errores.js';
import { MODOS } from './_lib/modos.js';
import { abrirPlazo } from './_lib/plazo.js';

/**
 * Lo que la plataforma le da a esta función, en milisegundos.
 *
 * TIENE QUE SER EL MISMO NÚMERO QUE `maxDuration` EN vercel.json. Si aquí
 * sobrara, la función se creería con más tiempo del que tiene y volvería a morir
 * cortada; si faltara, se rendiría antes de tiempo. Se escribe en los dos sitios
 * porque vercel.json no es código y no se puede importar, y los invariantes
 * comprueban que coinciden.
 */
const PRESUPUESTO_MS = 300_000;

/** Lo que la puerta admite. Cualquier otra cosa es un 405 con palabras. */
const METODOS = ['POST', 'OPTIONS'];

/** Tope de la plataforma, para poder decirlo en el mensaje del 413. */
const LIMITE_CUERPO = 4.5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// El handler
// ---------------------------------------------------------------------------

/**
 * @param {import('node:http').IncomingMessage & {body?:any}} req
 * @param {import('node:http').ServerResponse & {status?:Function, json?:Function}} res
 */
export default async function handler(req, res) {
  const secretos = instalarCensor(res, entornoSiSePuede()); // ← LA PRIMERA LÍNEA

  // El plazo, lo SEGUNDO. A partir de aquí ninguna llamada de dentro puede
  // esperar más de lo que le quede a la función, y cuando se acaba se contesta
  // con palabras en vez de dejar que la plataforma corte por lo sano.
  //
  // Sin esto, una imagen de 2K que tarde 45 s en Vertex más los siete megas de
  // subida al bucket se pasaban del techo, y lo que llegaba era un 504 en bruto:
  // sin mensaje, sin excepción y sin una sola línea en los registros del
  // servidor. Se comprobó en producción —siete 504 seguidos, cero errores—, y es
  // lo que hacía que TODAS las generaciones fallaran sin decir por qué.
  abrirPlazo(PRESUPUESTO_MS);

  try {
    // 2. El método. El preflight se contesta sin abrir nada.
    const metodo = String((req && req.method) || 'GET').toUpperCase();

    if (metodo === 'OPTIONS') {
      res.setHeader('Allow', METODOS.join(', '));
      responder(res, 204, null, secretos);
      return;
    }

    if (metodo !== 'POST') {
      res.setHeader('Allow', METODOS.join(', '));
      throw new ErrorDeCara(
        `Esta dirección solo entiende peticiones POST, y ha llegado un ${metodo}. No es un ` +
          'problema de tu cuenta: la aplicación manda siempre POST con un cuerpo que dice qué se ' +
          'le pide. Si has abierto esta dirección en el navegador, no hay nada que ver aquí: la ' +
          'herramienta es la página, no este camino.',
        { reintentable: false, http: 405 }
      );
    }

    // 3. La clave. `entorno()` está cacheado, así que esta llamada no repite
    //    trabajo; lo que hace es levantar el fallo que la primera línea se tragó.
    const ent = entorno();
    comprobarLaClave(req, ent);

    // 4. El cuerpo y el modo.
    const cuerpo = await cuerpoDeLaPeticion(req);
    const modo = nombreDelModo(cuerpo);

    // 5. El despacho.
    const datos = await MODOS[modo](cuerpo);

    // 6. La respuesta, con su peso medido antes de salir.
    responder(res, 200, { ok: true, ...(datos || {}) }, secretos);
  } catch (fallo) {
    // 7. Aquí no se escapa nada. Ni un ErrorDeCara, ni un fallo que nadie
    //    previó: `comoRespuesta()` convierte cualquier cosa en una frase en
    //    español con lo que dijo el programa, literal, en `detalle`.
    responderAlFallo(res, fallo, secretos);
  }
}

// ---------------------------------------------------------------------------
// 1. El entorno para el censor
// ---------------------------------------------------------------------------

/**
 * `entorno()` si se puede leer, y null si no. Síncrona y sin efectos: existe
 * solo para que el censor pueda compilar los literales de la cuenta antes de que
 * exista ningún camino de salida. Cuando devuelve null, el censor sigue tachando
 * por forma —claves PEM, correos de service account, tokens—, que es justo lo que
 * hace falta cuando el fallo es que el entorno no se entiende.
 * @returns {object|null}
 */
function entornoSiSePuede() {
  try {
    return entorno();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 3. El pestillo
// ---------------------------------------------------------------------------

/**
 * Si `CLAVE_ACCESO` está puesta, exige la cabecera `X-Clave` con ese valor. Si no
 * lo está, la puerta queda abierta: no es login ni son cuentas, es un pestillo.
 * @param {object} req
 * @param {object} ent
 */
function comprobarLaClave(req, ent) {
  const esperada = ent && typeof ent.clave === 'string' ? ent.clave : '';
  if (!esperada) return;

  const recibida = cabecera(req, 'x-clave');

  if (!recibida) {
    throw new ErrorDeCara(
      'Falta la clave de acceso. Esta instalación tiene puesto el pestillo (la variable de ' +
        'entorno CLAVE_ACCESO), así que la aplicación tiene que mandar esa misma clave en cada ' +
        'petición y aquí no ha llegado ninguna. Vuelve a escribirla en la pantalla de Salud, o ' +
        'quita CLAVE_ACCESO si no quieres pestillo.',
      { reintentable: false, http: 401 }
    );
  }

  if (!coinciden(esperada, recibida)) {
    throw new ErrorDeCara(
      'La clave de acceso no es la que espera esta instalación. La que vale es exactamente el ' +
        'valor de la variable de entorno CLAVE_ACCESO, sin espacios de más ni saltos de línea. Si ' +
        'la acabas de cambiar en Vercel, recuerda que una variable nueva no se aplica a un ' +
        'despliegue ya construido: hay que ir a Deployments, a los tres puntos del último, y ' +
        'pulsar Redeploy.',
      { reintentable: false, http: 401 }
    );
  }
}

/**
 * Compara dos claves sin que el tiempo que tarda diga nada sobre cuántos
 * caracteres se acertaron. Se comparan sus resúmenes, que siempre miden lo mismo.
 * @param {string} esperada
 * @param {string} recibida
 * @returns {boolean}
 */
function coinciden(esperada, recibida) {
  const a = createHash('sha256').update(String(esperada), 'utf8').digest();
  const b = createHash('sha256').update(String(recibida), 'utf8').digest();
  return timingSafeEqual(a, b);
}

/** Una cabecera, venga sola o repetida. Node las da siempre en minúscula. */
function cabecera(req, nombre) {
  const cabeceras = (req && req.headers) || {};
  const valor = cabeceras[nombre];
  if (Array.isArray(valor)) return String(valor[0] ?? '').trim();
  return typeof valor === 'string' ? valor.trim() : '';
}

// ---------------------------------------------------------------------------
// 4. El cuerpo y el modo
// ---------------------------------------------------------------------------

/**
 * El cuerpo de la petición, ya como objeto.
 *
 * Vercel lo parsea solo cuando el tipo de contenido es JSON, pero no siempre:
 * también puede llegar como cadena, como bytes, o no llegar parseado en absoluto.
 * Se admiten las cuatro formas, porque un cuerpo que no se entiende tiene que
 * salir como una frase en español y no como un fallo de programa.
 *
 * @param {object} req
 * @returns {Promise<object>}
 */
async function cuerpoDeLaPeticion(req) {
  const crudo = req && req.body !== undefined && req.body !== null ? req.body : await flujo(req);

  if (Buffer.isBuffer(crudo) || crudo instanceof Uint8Array) {
    return comoJson(Buffer.from(crudo).toString('utf8'));
  }
  if (typeof crudo === 'string') return comoJson(crudo);
  if (Array.isArray(crudo)) {
    throw new ErrorDeCara(
      'El cuerpo de la petición es una lista, y tiene que ser un objeto con un campo «modo» ' +
        'dentro. Es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 400 }
    );
  }
  if (crudo && typeof crudo === 'object') return crudo;

  throw new ErrorDeCara(
    'La petición ha llegado sin cuerpo. Esta dirección espera siempre un objeto JSON con un campo ' +
      '«modo» que dice qué se le pide. Es un fallo del propio estudio, no de tu cuenta.',
    { reintentable: false, http: 400 }
  );
}

/** Lee el cuerpo del flujo cuando la plataforma no lo ha parseado. */
async function flujo(req) {
  if (!req || typeof req[Symbol.asyncIterator] !== 'function') return '';
  const trozos = [];
  let cuantos = 0;
  for await (const trozo of req) {
    const bytes = Buffer.isBuffer(trozo) ? trozo : Buffer.from(trozo);
    cuantos += bytes.length;
    if (cuantos > LIMITE_CUERPO) {
      throw new ErrorDeCara(
        `No cabe: el límite es de ${(LIMITE_CUERPO / 1024 / 1024).toFixed(1).replace('.', ',')} MB ` +
          'por petición y lo que se está mandando ya lo ha pasado. No se reintenta, porque el ' +
          'tamaño no cambia por insistir: a Veo se le manda una copia reducida a 1280 px en JPEG, ' +
          'nunca el master en 2K.',
        { reintentable: false, http: 413 }
      );
    }
    trozos.push(bytes);
  }
  return Buffer.concat(trozos).toString('utf8');
}

/** Un texto que tiene que ser JSON, y si no lo es se dice con palabras. */
function comoJson(texto) {
  const limpio = String(texto).trim();
  if (!limpio) {
    throw new ErrorDeCara(
      'La petición ha llegado con el cuerpo vacío. Esta dirección espera siempre un objeto JSON ' +
        'con un campo «modo». Es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 400 }
    );
  }

  let leido;
  try {
    leido = JSON.parse(limpio);
  } catch (fallo) {
    throw new ErrorDeCara(
      'El cuerpo de la petición no se entiende: no es JSON válido. Es un fallo del propio estudio, ' +
        'no de tu cuenta.',
      {
        detalle: fallo && fallo.message ? fallo.message : String(fallo),
        reintentable: false,
        http: 400
      }
    );
  }

  if (!leido || typeof leido !== 'object' || Array.isArray(leido)) {
    throw new ErrorDeCara(
      'El cuerpo de la petición es JSON válido pero no es un objeto, así que no puede llevar ' +
        'dentro el campo «modo». Es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 400 }
    );
  }

  return leido;
}

/**
 * El modo pedido, comprobado contra la tabla. Un modo que no existe se contesta
 * diciendo cuáles hay: es un fallo de programación, y la lista es lo único que
 * ayuda a encontrarlo.
 * @param {object} cuerpo
 * @returns {string}
 */
function nombreDelModo(cuerpo) {
  const pedido = typeof cuerpo.modo === 'string' ? cuerpo.modo.trim() : '';

  if (!pedido) {
    throw new ErrorDeCara(
      'La petición no dice qué se le pide: le falta el campo «modo». Los modos que entiende esta ' +
        `puerta son: ${Object.keys(MODOS).join(', ')}. Es un fallo del propio estudio, no de tu ` +
        'cuenta.',
      { reintentable: false, http: 400 }
    );
  }

  if (!Object.hasOwn(MODOS, pedido) || typeof MODOS[pedido] !== 'function') {
    throw new ErrorDeCara(
      `«${pedido}» no es nada que esta puerta sepa hacer. Los modos que entiende son: ` +
        `${Object.keys(MODOS).join(', ')}. Es un fallo del propio estudio, no de tu cuenta: la ` +
        'pantalla ha pedido algo que la función no tiene.',
      { reintentable: false, http: 400 }
    );
  }

  return pedido;
}

// ---------------------------------------------------------------------------
// 6 y 7. Contestar
// ---------------------------------------------------------------------------

/**
 * Manda la respuesta con `X-Peso-Respuesta` puesta ANTES de enviarla.
 *
 * El cuerpo se tacha aquí para poder medir lo que de verdad va a salir. Después
 * se entrega a `res.json`, que vuelve a pasarlo por el censor: eso es a propósito
 * y no es un despiste. El censor recorre valor a valor, y esa es la única forma
 * de que una URL firmada —que lleva el bucket en la ruta y el correo de la cuenta
 * dentro de la firma— salga entera mientras todo lo demás se tacha. Serializar
 * primero y censurar el texto después rompería esas URLs, y sin ellas no se
 * puede mirar ni oír nada de lo generado.
 *
 * @param {object} res
 * @param {number} http
 * @param {object|null} cuerpo null para un 204, que no lleva cuerpo.
 * @param {object} secretos lo que devolvió `instalarCensor()`.
 */
function responder(res, http, cuerpo, secretos) {
  if (res.headersSent) return;

  res.setHeader('Cache-Control', 'no-store');

  if (cuerpo === null) {
    res.setHeader('X-Peso-Respuesta', '0');
    estado(res, http);
    res.end();
    return;
  }

  const limpio = tachar(cuerpo, secretos);
  const texto = serializar(limpio);

  res.setHeader('X-Peso-Respuesta', String(Buffer.byteLength(texto, 'utf8')));
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  estado(res, http);

  if (typeof res.json === 'function') {
    res.json(limpio);
    return;
  }

  // Camino de emergencia, para una plataforma que no traiga `res.json`. En
  // Vercel no se usa nunca. Sale ya tachado; el censor lo repasará como texto,
  // que es más severo de la cuenta con una URL firmada, pero antes severo que
  // filtrando.
  res.end(texto);
}

/**
 * Convierte cualquier fallo en la respuesta de docs/contrato.md §1 y la manda.
 * No lanza: si aquí se rompiera algo, la petición se quedaría colgada hasta que
 * la plataforma la apagara sin decir nada, que es justo lo que no puede pasar.
 * @param {object} res
 * @param {*} fallo
 * @param {object} secretos
 */
function responderAlFallo(res, fallo, secretos) {
  try {
    const cuerpo = comoRespuesta(fallo);

    // Algunos fallos traen compañía: el 409 de `estado-escribir` viaja con el
    // estado bueno y su generación dentro, para que el navegador vuelva a
    // aplicar su cambio encima sin tener que pedirlo otra vez.
    if (fallo && typeof fallo === 'object' && fallo.extra && typeof fallo.extra === 'object') {
      Object.assign(cuerpo, fallo.extra);
    }

    responder(res, cuerpo.error.http || 500, cuerpo, secretos);
  } catch {
    // El manejador de errores también puede fallar (una respuesta gigantesca que
    // no se puede serializar, por ejemplo). Aquí se contesta lo mínimo, a mano,
    // porque una petición sin respuesta es peor que cualquier mensaje.
    try {
      if (res.headersSent) return;
      const minimo = JSON.stringify({
        ok: false,
        error: {
          mensaje:
            'Se ha roto algo al preparar la respuesta y ni siquiera se ha podido explicar bien qué. ' +
            'Vuelve a intentarlo; si sigue pasando, mira la pantalla de Salud.',
          detalle: null,
          reintentable: true,
          http: 500
        }
      });
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('X-Peso-Respuesta', String(Buffer.byteLength(minimo, 'utf8')));
      estado(res, 500);
      res.end(minimo);
    } catch {
      // Ya no queda nada que hacer con esta respuesta.
    }
  }
}

/** El código de estado, con `res.status` si la plataforma lo trae y sin él si no. */
function estado(res, http) {
  const codigo = Number.isFinite(Number(http)) ? Number(http) : 500;
  if (typeof res.status === 'function') {
    res.status(codigo);
    return;
  }
  res.statusCode = codigo;
}

/** JSON.stringify sin que un ciclo tumbe la respuesta entera. */
function serializar(valor) {
  const vistos = new WeakSet();
  try {
    return (
      JSON.stringify(valor, (_clave, v) => {
        if (v && typeof v === 'object') {
          if (vistos.has(v)) return '«ciclo»';
          vistos.add(v);
        }
        return v;
      }) ?? 'null'
    );
  } catch {
    return 'null';
  }
}
