// La única puerta del navegador hacia fuera.
//
// Todo lo que la aplicación pide al mundo pasa por `llamar(modo, campos)`: un
// POST a `/api/g` con el modo dentro del cuerpo. Ninguna pantalla habla con
// Google, ninguna pantalla ve una credencial y ninguna pantalla compone un
// prompt. Manda un id y recibe datos (docs/contrato.md §0).
//
// POR QUÉ EL PESO SE MIDE Y NO SE RAZONA. El límite de la plataforma son 4,5 MB
// de petición y de respuesta, y el de la respuesta es el traicionero: cuando se
// pasa, el fallo no dice «no cabe», parece un tiempo agotado. La función pone en
// cada respuesta la cabecera `X-Peso-Respuesta` con el tamaño real del cuerpo ya
// serializado, y aquí se guarda el MÁXIMO visto por modo. Eso es lo que enseña la
// pantalla de Salud, y es la única prueba de que el invariante se cumple.
//
// POR QUÉ EL CUERPO SE LEE COMO TEXTO ANTES DE INTENTAR ENTENDERLO. Cuando algo
// se rompe por debajo de la función —la plataforma devuelve su propia página de
// error, un despliegue a medias, una redirección de acceso— lo que llega no es
// JSON sino HTML. Si se llamara a `respuesta.json()` a pelo, el usuario leería
// «Unexpected token < in JSON at position 0», que no significa nada para nadie.
// Aquí se lee el texto, se intenta entender, y si no se entiende se dice con
// palabras que la función no ha respondido como debía y se enseñan los primeros
// caracteres de lo que sí llegó.
//
// POR QUÉ EL 401 SE TRATA APARTE. La clave de acceso es un pestillo opcional
// (`CLAVE_ACCESO`), no un login. Si la instalación lo tiene puesto y la clave
// guardada ya no vale, insistir con ella no sirve de nada: se borra y se pide una
// nueva por pantalla mediante un evento. Este módulo no dibuja: avisa.

/** La puerta. Se sirve del mismo sitio que la aplicación, así que va relativa. */
const RUTA = '/api/g';

/** Dónde se guarda el pestillo en este navegador. No es una credencial de nube. */
const LLAVE_GUARDADA = 'la-mirada.clave';

/**
 * Lo que se espera como mucho por una llamada. Va por encima de los 60 s de la
 * plataforma a propósito: si la función se apaga sola, quien contesta es ella con
 * su mensaje. Este límite es solo para que una petición que se queda colgada no
 * bloquee la cola para siempre.
 */
const LIMITE_MS = 90000;

/** Cuántos caracteres del cuerpo se enseñan cuando no se entiende lo que llegó. */
const MUESTRA_DETALLE = 300;

/**
 * Nombre del evento con el que este módulo pide una clave nueva.
 *
 * Se dispara sobre `window` con
 * `detail: { mensaje, modo }`, y quien lo escuche (la pantalla de Salud) enseña
 * el campo y llama a `guardarClave()` con lo que escriba el usuario.
 *
 * FALTA EN EL CONTRATO: docs/contrato.md §1 describe el pestillo y §12 fija
 * `llamar()` y `pesos()`, pero no dice con qué nombre se pide la clave nueva ni
 * quién la guarda. Se resuelve aquí con el nombre más obvio en español para que
 * se revise.
 */
export const EVENTO_CLAVE_NECESARIA = 'clave-necesaria';

// ---------------------------------------------------------------------------
// El error que se enseña
// ---------------------------------------------------------------------------

/**
 * El mismo error que usa la función, del lado del navegador: un mensaje en
 * español que se pinta tal cual, lo que dijo el otro lado en `detalle`, si vale
 * la pena reintentar, y el código HTTP para quien lo necesite.
 *
 * `reintentable` no se regala: aunque quien crea el error lo pida, un 4xx nunca
 * se reintenta y un 413 menos todavía. Ese cerrojo está aquí y no en la cola,
 * para que no se pueda saltar por descuido desde ninguna pantalla.
 */
export class ErrorDeCara extends Error {
  /**
   * @param {string} mensaje frase en español, lista para pintarse
   * @param {{detalle?:string|null, reintentable?:boolean, http?:number}} [opciones]
   */
  constructor(mensaje, { detalle = null, reintentable = false, http = 500 } = {}) {
    super(String(mensaje));
    this.name = 'ErrorDeCara';
    this.mensaje = String(mensaje);
    this.detalle = detalle == null ? null : String(detalle);
    this.http = Number.isFinite(Number(http)) ? Number(http) : 500;
    this.reintentable = Boolean(reintentable) && esReintentable(this.http);
  }
}

/**
 * 408, 429 y 5xx sí. Cualquier otro 4xx no. El 413, jamás: el tamaño no cambia
 * por insistir. Sin código (no hubo respuesta, se cortó la red) cuenta como 408.
 * @param {number} http
 * @returns {boolean}
 */
function esReintentable(http) {
  const codigo = Number(http);
  if (!Number.isFinite(codigo) || codigo <= 0) return true;
  if (codigo === 413) return false;
  if (codigo === 408 || codigo === 429) return true;
  if (codigo >= 400 && codigo < 500) return false;
  if (codigo >= 500) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Los pesos
// ---------------------------------------------------------------------------

/** El máximo que ha pesado la respuesta de cada modo en esta sesión. */
const pesosMaximos = Object.create(null);

/**
 * Lo medido hasta ahora, modo a modo, en bytes.
 *
 * Es una copia: quien la reciba puede guardarla en `estado.pesos` sin que nadie
 * se la cambie por debajo. `app/estado.js` la funde en el estado del bucket cada
 * vez que escribe, así que la medida sobrevive al cierre del navegador.
 *
 * @returns {Object<string, number>}
 */
export function pesos() {
  return { ...pesosMaximos };
}

/**
 * Apunta lo que ha pesado una respuesta, quedándose con el máximo.
 * @param {string} modo
 * @param {number} bytes
 */
function anotarPeso(modo, bytes) {
  const cuantos = Number(bytes);
  if (!Number.isFinite(cuantos) || cuantos < 0) return;
  const antes = Number(pesosMaximos[modo]) || 0;
  if (cuantos > antes) pesosMaximos[modo] = cuantos;
}

// ---------------------------------------------------------------------------
// El pestillo
// ---------------------------------------------------------------------------

/**
 * Si ya se ha pedido una clave y nadie ha contestado todavía, no se vuelve a
 * pedir: con tres generaciones a la vez, un 401 se convertiría en tres avisos
 * encima del mismo campo. Se reabre en cuanto se guarda o se olvida una clave.
 */
let pidiendoClave = false;

/**
 * La clave guardada en este navegador, o cadena vacía si no hay.
 * `localStorage` puede no existir o estar prohibido (navegación privada); eso no
 * es un fallo que contar, es sencillamente no tener clave guardada.
 * @returns {string}
 */
function claveGuardada() {
  try {
    const guardada = window.localStorage.getItem(LLAVE_GUARDADA);
    return typeof guardada === 'string' ? guardada.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Guarda la clave del pestillo en este navegador.
 * @param {string} clave
 * @returns {boolean} false si el navegador no deja guardar nada
 *
 * FALTA EN EL CONTRATO: ver `EVENTO_CLAVE_NECESARIA`.
 */
export function guardarClave(clave) {
  const limpia = String(clave ?? '').trim();
  pidiendoClave = false;
  try {
    if (limpia) window.localStorage.setItem(LLAVE_GUARDADA, limpia);
    else window.localStorage.removeItem(LLAVE_GUARDADA);
    return true;
  } catch {
    return false;
  }
}

/**
 * Borra la clave guardada.
 * @returns {void}
 *
 * FALTA EN EL CONTRATO: ver `EVENTO_CLAVE_NECESARIA`.
 */
export function olvidarClave() {
  pidiendoClave = false;
  try {
    window.localStorage.removeItem(LLAVE_GUARDADA);
  } catch {
    // Si no se puede borrar es que nunca se pudo guardar: no hay nada que borrar.
  }
}

/**
 * Si hay una clave guardada en este navegador.
 * @returns {boolean}
 *
 * FALTA EN EL CONTRATO: ver `EVENTO_CLAVE_NECESARIA`.
 */
export function hayClave() {
  return claveGuardada() !== '';
}

/**
 * Pide una clave nueva por pantalla. No dibuja nada: lanza el evento y quien
 * pinte decide cómo pedirla.
 * @param {string} mensaje lo que dijo la función, para enseñarlo junto al campo
 * @param {string} modo qué se estaba pidiendo cuando saltó
 */
function pedirClaveNueva(mensaje, modo) {
  if (pidiendoClave) return;
  pidiendoClave = true;
  try {
    window.dispatchEvent(
      new CustomEvent(EVENTO_CLAVE_NECESARIA, { detail: { mensaje, modo } })
    );
  } catch {
    // Un navegador sin eventos personalizados no existe, pero si existiera, el
    // error se enseña igual: `llamar()` lo lanza justo después de esto.
    pidiendoClave = false;
  }
}

// ---------------------------------------------------------------------------
// La llamada
// ---------------------------------------------------------------------------

/**
 * Pide algo a la función y devuelve los datos.
 *
 * @param {string} modo uno de los de docs/contrato.md §2
 * @param {object} [campos] los campos de ese modo
 * @returns {Promise<object>} lo que devolvió la función, sin el `ok`
 * @throws {ErrorDeCara} siempre con `.mensaje` en español, listo para pintarse
 */
export async function llamar(modo, campos = {}) {
  const nombre = String(modo ?? '').trim();
  if (!nombre) {
    throw new ErrorDeCara(
      'Se ha intentado pedir algo sin decir qué. Es un fallo del propio estudio, no de tu cuenta: ' +
        'una pantalla ha llamado a la función sin indicar el modo.',
      { reintentable: false, http: 400 }
    );
  }

  const cuerpo = serializar(nombre, campos);
  const cabeceras = { 'Content-Type': 'application/json' };
  const clave = claveGuardada();
  if (clave) cabeceras['X-Clave'] = clave;

  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), LIMITE_MS);

  let respuesta;
  try {
    respuesta = await fetch(RUTA, {
      method: 'POST',
      headers: cabeceras,
      body: cuerpo,
      cache: 'no-store',
      signal: corte.signal
    });
  } catch (fallo) {
    throw deLaRed(fallo, nombre);
  } finally {
    clearTimeout(reloj);
  }

  // El peso, antes que nada: incluso una respuesta que trae un fallo cuenta para
  // saber cuánto ocupa ese modo.
  const texto = await leerElTexto(respuesta, nombre);
  anotarPeso(nombre, pesoDeLaRespuesta(respuesta, texto));

  const datos = entender(texto, respuesta, nombre);

  if (!respuesta.ok || datos.ok === false) throw comoError(datos, respuesta, nombre);

  delete datos.ok;
  return datos;
}

// ---------------------------------------------------------------------------
// Preparar lo que se manda
// ---------------------------------------------------------------------------

/**
 * El cuerpo de la petición. El modo va el último a propósito: así ningún campo
 * suelto puede pisarlo por accidente.
 * @param {string} modo
 * @param {object} campos
 * @returns {string}
 */
function serializar(modo, campos) {
  try {
    return JSON.stringify({ ...(campos || {}), modo });
  } catch (fallo) {
    throw new ErrorDeCara(
      `No se ha podido preparar la petición de «${modo}»: lo que se le pasa a la función no se ` +
        'puede convertir en texto. Es un fallo del propio estudio, no de tu cuenta.',
      { detalle: mensajeDe(fallo), reintentable: false, http: 400 }
    );
  }
}

// ---------------------------------------------------------------------------
// Entender lo que vuelve
// ---------------------------------------------------------------------------

/**
 * El cuerpo de la respuesta como texto. Se lee siempre como texto, incluso
 * cuando todo ha ido bien, porque es la única forma de poder enseñar los
 * primeros caracteres cuando lo que llega no es JSON.
 * @param {Response} respuesta
 * @param {string} modo
 * @returns {Promise<string>}
 */
async function leerElTexto(respuesta, modo) {
  try {
    return await respuesta.text();
  } catch (fallo) {
    throw new ErrorDeCara(
      `La respuesta de «${modo}» se ha cortado a mitad de camino y no se ha podido leer entera. ` +
        'Suele ser la conexión: vuelve a intentarlo.',
      { detalle: mensajeDe(fallo), reintentable: true, http: 0 }
    );
  }
}

/**
 * Lo que pesó la respuesta. La cabecera la pone la función con el tamaño real ya
 * serializado; si por lo que sea no viniera, se mide aquí lo que ha llegado, que
 * es el mismo número.
 * @param {Response} respuesta
 * @param {string} texto
 * @returns {number}
 */
function pesoDeLaRespuesta(respuesta, texto) {
  let dicho = null;
  try {
    dicho = respuesta.headers.get('X-Peso-Respuesta');
  } catch {
    dicho = null;
  }
  const cuantos = Number(dicho);
  if (dicho !== null && dicho !== '' && Number.isFinite(cuantos) && cuantos >= 0) return cuantos;
  try {
    return new TextEncoder().encode(texto).length;
  } catch {
    return texto.length;
  }
}

/**
 * El texto convertido en objeto, o una explicación con palabras de por qué no.
 *
 * Aquí es donde muere el «Unexpected token < in JSON»: si lo que ha llegado no
 * es JSON, lo más probable es que no haya contestado la función sino la
 * plataforma con una página suya, y eso hay que decirlo así.
 *
 * @param {string} texto
 * @param {Response} respuesta
 * @param {string} modo
 * @returns {object}
 */
function entender(texto, respuesta, modo) {
  const limpio = String(texto ?? '').trim();

  if (!limpio) {
    if (respuesta.ok) {
      throw new ErrorDeCara(
        `La función ha contestado a «${modo}» sin decir nada: la respuesta ha llegado vacía. Vuelve ` +
          'a intentarlo, y si sigue pasando mira la pantalla de Salud, que dice si la función está ' +
          'bien desplegada.',
        { detalle: `HTTP ${respuesta.status}`, reintentable: true, http: respuesta.status || 0 }
      );
    }
    throw new ErrorDeCara(
      `La función no ha podido atender «${modo}» y ha contestado ${elCodigo(respuesta)} sin ninguna ` +
        'explicación dentro. Si acabas de tocar las variables de entorno en Vercel, recuerda que ' +
        'una variable nueva no se aplica a un despliegue ya construido: hay que ir a Deployments, ' +
        'a los tres puntos del último, y pulsar Redeploy.',
      { detalle: null, reintentable: esReintentable(respuesta.status), http: respuesta.status || 0 }
    );
  }

  let leido;
  try {
    leido = JSON.parse(limpio);
  } catch {
    throw new ErrorDeCara(
      `La función no ha respondido como debía a «${modo}»: lo que ha llegado no es una respuesta ` +
        'del estudio sino otra cosa, seguramente una página de error de la plataforma. Debajo están ' +
        'los primeros caracteres tal cual llegaron. Mira la pantalla de Salud: casi siempre es que ' +
        'la función no está desplegada, que ha caducado el despliegue, o que falta una variable de ' +
        'entorno y Vercel necesita un Redeploy para aplicarla.',
      {
        detalle: recorte(limpio),
        reintentable: esReintentable(respuesta.status),
        http: respuesta.status || 0
      }
    );
  }

  if (!leido || typeof leido !== 'object' || Array.isArray(leido)) {
    throw new ErrorDeCara(
      `La función no ha respondido como debía a «${modo}»: lo que ha llegado es JSON, pero no un ` +
        'objeto con los datos dentro. Es un fallo del propio estudio, no de tu cuenta.',
      {
        detalle: recorte(limpio),
        reintentable: esReintentable(respuesta.status),
        http: respuesta.status || 0
      }
    );
  }

  return leido;
}

/**
 * Convierte `{ ok:false, error:{...} }` en el error que se enseña.
 *
 * Si el 401 dice que el pestillo no está contento, la clave guardada se borra
 * aquí mismo y se pide otra por pantalla: dejarla puesta solo serviría para
 * fallar igual en la siguiente llamada.
 *
 * @param {object} datos
 * @param {Response} respuesta
 * @param {string} modo
 * @returns {ErrorDeCara}
 */
function comoError(datos, respuesta, modo) {
  const http = Number(respuesta.status) || 500;
  const dicho = datos && typeof datos.error === 'object' && datos.error ? datos.error : null;

  const mensaje =
    dicho && typeof dicho.mensaje === 'string' && dicho.mensaje.trim()
      ? dicho.mensaje.trim()
      : `La función no ha podido atender «${modo}» y ha contestado ${elCodigo(respuesta)}, pero no ` +
        'ha explicado por qué. Es un fallo del propio estudio, no de tu cuenta.';

  const codigo = Number.isFinite(Number(dicho && dicho.http)) ? Number(dicho.http) : http;

  const fallo = new ErrorDeCara(mensaje, {
    detalle: dicho && dicho.detalle != null ? String(dicho.detalle) : null,
    reintentable: dicho ? Boolean(dicho.reintentable) : esReintentable(codigo),
    http: codigo
  });

  // Lo que venga al lado del error se conserva: el 409 de `estado-escribir`
  // viaja con `estado` y `generacion` dentro para que el navegador vuelva a
  // aplicar su cambio encima sin pedir el estado otra vez (docs/contrato.md §2).
  //
  // FALTA EN EL CONTRATO: §12 fija `llamar()` pero no dice dónde deja esos
  // acompañantes del lado del navegador. Se guardan en `.extra`, con el mismo
  // nombre que usa la función por dentro.
  const extra = {};
  let hayExtra = false;
  for (const campo of Object.keys(datos)) {
    if (campo === 'ok' || campo === 'error') continue;
    extra[campo] = datos[campo];
    hayExtra = true;
  }
  if (hayExtra) fallo.extra = extra;

  if (codigo === 401) {
    olvidarClave();
    pedirClaveNueva(fallo.mensaje, modo);
  }

  return fallo;
}

// ---------------------------------------------------------------------------
// Cuando no hubo ni respuesta
// ---------------------------------------------------------------------------

/**
 * El fallo de `fetch`, contado con palabras. Un `fetch` que revienta no trae
 * código ni cuerpo: o se cortó la espera, o no se pudo llegar.
 * @param {*} fallo
 * @param {string} modo
 * @returns {ErrorDeCara}
 */
function deLaRed(fallo, modo) {
  const nombre = fallo && fallo.name ? String(fallo.name) : '';

  if (nombre === 'AbortError' || nombre === 'TimeoutError') {
    return new ErrorDeCara(
      `«${modo}» ha estado ${Math.round(LIMITE_MS / 1000)} segundos sin contestar y se ha dejado de ` +
        'esperar. Puede ser que la función se haya quedado sin tiempo, o que la respuesta se haya ' +
        'pasado de los 4,5 MB que admite la plataforma, que es un fallo que siempre parece un ' +
        'tiempo agotado. La pantalla de Salud enseña cuánto pesa la respuesta de cada modo.',
      { detalle: mensajeDe(fallo), reintentable: true, http: 408 }
    );
  }

  return new ErrorDeCara(
    `No se ha podido llegar a la función para pedir «${modo}». Comprueba la conexión del teléfono; ` +
      'si tienes cobertura, lo más probable es que la aplicación no esté desplegada o que el ' +
      'despliegue esté a medias.',
    { detalle: mensajeDe(fallo), reintentable: true, http: 0 }
  );
}

// ---------------------------------------------------------------------------
// Menudencias
// ---------------------------------------------------------------------------

/** El código HTTP dicho en español, para meterlo en una frase. */
function elCodigo(respuesta) {
  const codigo = Number(respuesta && respuesta.status);
  return Number.isFinite(codigo) && codigo > 0 ? `con un ${codigo}` : 'sin código';
}

/** Los primeros caracteres de algo, en una sola línea, para el detalle. */
function recorte(texto) {
  const plano = String(texto).replace(/\s+/g, ' ').trim();
  return plano.length > MUESTRA_DETALLE ? `${plano.slice(0, MUESTRA_DETALLE)}…` : plano;
}

/** Lo que dijo un fallo del navegador, literal, para el detalle. */
function mensajeDe(fallo) {
  if (!fallo) return null;
  if (typeof fallo === 'string') return fallo;
  if (fallo.message) return String(fallo.message);
  return String(fallo);
}
