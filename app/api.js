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
 * Lo que se espera como mucho por una llamada. Va por encima del plazo de la
 * función a propósito —ella se apaga sola y contesta con su mensaje—, y este
 * límite es solo para que una petición colgada no bloquee la cola para siempre.
 *
 * ESTABA EN 90 s Y ERA UN PROBLEMA, no un seguro. La función tiene 300 s de
 * plazo, así que a los 90 el navegador abandonaba una generación que seguía
 * viva: Google la terminaba, se cobraba, el archivo quedaba en el bucket y aquí
 * se contaba como fallo. Cortar antes que la función no ahorra dinero, lo tira.
 * Ahora va por encima, y quien manda el mensaje es siempre la función.
 */
const LIMITE_MS = 320000;

/** Cuántos caracteres del cuerpo se enseñan cuando no se entiende lo que llegó. */
const MUESTRA_DETALLE = 300;

// ---------------------------------------------------------------------------
// El freno, que se ajusta solo
// ---------------------------------------------------------------------------
//
// PORTADO DE UN PROYECTO DEL MISMO AUTOR QUE YA LLEVA MESES GENERANDO TANDAS DE
// CIENTOS DE IMÁGENES SIN QUE EL USUARIO VEA UN SOLO ERROR DE CUOTA. La idea no
// es mía y funciona; lo que sigue es por qué.
//
// Vertex no limita por «cuántas a la vez» sino POR MINUTO. Esta cola ya va de una
// en una, así que la concurrencia nunca fue el problema: el problema es que
// cuarenta imágenes seguidas, aunque vayan en fila india, se salen de la cuota
// del minuto igual. Ir de una en una SIN PAUSA no es ir despacio.
//
// Y un 429 no es un fallo, es un «ahora no». Tratarlo como fallo definitivo es lo
// que dejaba la lista entera en rojo.
//
// Así que hay un freno que se aprieta solo: cada 429 DOBLA la pausa entre
// llamadas, y cada cinco aciertos seguidos la afloja un cuarto. Sube fuerte y
// baja despacio, que es como se regula cualquier cosa que no conoce su propio
// límite; subir multiplicando y bajar de golpe es un oscilador, no un regulador,
// y se pasa la tanda chocando cada pocas imágenes.
//
// Las cifras importan en los dos sentidos. El primer frenazo son OCHO segundos
// —siete llamadas por minuto, que cabe en la cuota más apretada que reparte
// Vertex a un proyecto nuevo—; cuatro segundos serían quince por minuto y no
// evitarían nada.

/** Un minuto entre llamadas es una por minuto: por debajo de eso ya no es la cuota. */
const PAUSA_MAX = 60_000;

/** El primer frenazo: 8 s son siete llamadas por minuto. */
const PAUSA_INICIAL = 8_000;

/** Por debajo de esto el freno ya no sirve de nada y se quita del todo. */
const PAUSA_MINIMA = 1_500;

/** Cuántos aciertos seguidos hacen falta para aflojar. Uno solo puede ser suerte. */
const ACIERTOS_PARA_AFLOJAR = 5;

/**
 * Las esperas cuando el proveedor dice «ahora no». Media hora de paciencia no
 * cabe aquí: si tras minuto y medio la ventana sigue cerrada, no es la cuota por
 * minuto —esa se abre sola— sino una mayor, y de esa se encarga la cola, que para
 * la tanda entera. Dos capas, cada una con su trabajo.
 */
const ESPERAS_DE_CUOTA = [30_000, 60_000, 90_000];

/** Nada de aquí duerme más que esto de una sentada, ni aunque lo pida Google. */
const TECHO_DE_ESPERA = 120_000;

/**
 * A QUÉ SE LE PONE EL FRENO, y por qué no a todo.
 *
 * La cuota que se agota es la de los MODELOS. Leer el estado, escribirlo, firmar
 * una URL o listar el bucket hablan con Cloud Storage, que no tiene nada que ver
 * y cuya cuota no se agota jamás con este uso. Frenar esas dejaría la aplicación
 * arrastrándose —el estado se lee constantemente— sin ganar ni un poco de cuota.
 *
 * Así que el freno es solo para lo que llama a Vertex. La lista se escribe entera
 * y a mano a propósito: si mañana hay un modo nuevo que llama a un modelo y a
 * nadie se le ocurre añadirlo aquí, lo que pasa es que ese modo no frena —que es
 * como está todo hoy— y no que se frene de más media aplicación.
 */
const GASTAN_CUOTA = new Set([
  'imagen',
  'veo-lanzar',
  'veo-consultar',
  'musica',
  'voz',
  'voz-muestra',
  'alinear',
  'desglosar-escena',
  'salud',
]);

/** Cuánto se espera ahora entre llamadas. */
let pausaEntreLlamadas = 0;

/** Aciertos seguidos desde el último frenazo. */
let aciertosSeguidos = 0;

/**
 * El suelo del ritmo: lo que el usuario dice que aguanta su cuenta.
 *
 * El freno de arriba aprende chocando, y aprender chocando cuesta una llamada
 * fallida y una espera cada vez. Quien ya sabe que su proyecto aguanta dos
 * imágenes por minuto lo dice y se va a treinta segundos por imagen desde la
 * primera, sin chocar ni una vez. Es un suelo, no un valor fijo: si aun así se
 * choca, el freno sube por encima.
 */
let sueloDelRitmo = 0;

/**
 * Pone el ritmo mínimo entre llamadas, en milisegundos.
 * @param {number} ms
 */
export function ponerRitmoMinimo(ms) {
  sueloDelRitmo = Math.max(0, Math.min(PAUSA_MAX, Number(ms) || 0));
  if (sueloDelRitmo > pausaEntreLlamadas) pausaEntreLlamadas = sueloDelRitmo;
}

/** Cuánto se está esperando ahora entre llamadas, para poder enseñarlo y guardarlo. */
export function ritmoActual() {
  return pausaEntreLlamadas;
}

/** Un «ahora no» del proveedor: se frena y se insiste, no se da por perdido. */
function frenar() {
  aciertosSeguidos = 0;
  pausaEntreLlamadas = Math.min(
    PAUSA_MAX,
    pausaEntreLlamadas ? pausaEntreLlamadas * 2 : PAUSA_INICIAL
  );
}

/** Va bien: se afloja, pero despacio y nunca por debajo de lo que dijo el usuario. */
function aflojar() {
  if (pausaEntreLlamadas <= sueloDelRitmo) return;
  if (++aciertosSeguidos < ACIERTOS_PARA_AFLOJAR) return;
  aciertosSeguidos = 0;
  const siguiente = Math.round(pausaEntreLlamadas * 0.75);
  pausaEntreLlamadas = Math.max(sueloDelRitmo, siguiente < PAUSA_MINIMA ? 0 : siguiente);
}

/** Duerme, y se despierta si se aborta. */
function dormir(ms) {
  return new Promise((listo) => setTimeout(listo, ms));
}

/** ¿Es un «espera» y no un «no»? */
function esEspera(http, texto) {
  return http === 429 || http === 503 ||
    /RESOURCE_EXHAUSTED|has been exhausted|quota|rate limit|try again later/i.test(String(texto || ''));
}

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
export async function llamar(modo, campos = {}, { alEsperar } = {}) {
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

  // Cuántas veces se ha esperado por cuota en ESTA llamada. Un «espera» no gasta
  // intento: no ha fallado, es que no le tocaba.
  let esperas = 0;

  for (;;) {
    // EL FRENO, ANTES DE LLAMAR. Si algo chocó antes con la cuota, esto es lo que
    // hace que esta no vuelva a chocar. Solo para lo que gasta cuota de modelo:
    // ver `GASTAN_CUOTA`.
    if (pausaEntreLlamadas && GASTAN_CUOTA.has(nombre)) {
      avisarDeLaEspera(alEsperar, pausaEntreLlamadas, 'ritmo', nombre);
      await dormir(pausaEntreLlamadas);
    }

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

    if (respuesta.ok && datos.ok !== false) {
      // Solo cuenta como acierto lo que de verdad pasó por un modelo: cien
      // lecturas de estado seguidas no demuestran que la cuota se haya repuesto.
      if (GASTAN_CUOTA.has(nombre)) aflojar();
      delete datos.ok;
      return datos;
    }

    const error = comoError(datos, respuesta, nombre);

    // UN «AHORA NO» NO ES UN «NO». Aquí está la diferencia entre una tanda que
    // termina sola y una lista entera en rojo: un 429 se frenaba y se daba por
    // perdido, así que la siguiente llamada iba a la misma pared a toda
    // velocidad. Ahora se frena Y SE INSISTE, con la paciencia que pide una
    // ventana de cuota, y quien lo pidió no llega a enterarse.
    if (esEspera(error.http, `${error.mensaje} ${error.detalle || ''}`)) {
      frenar();

      if (esperas < ESPERAS_DE_CUOTA.length) {
        // Si Google dice cuánto esperar se le hace caso, PERO CON UN TECHO: una
        // cuota diaria puede contestar «vuelve dentro de 40.000 segundos», y eso
        // serían once horas quieto sin forma de saber que no está colgado.
        const dice = Math.min(Number(respuesta.headers.get('retry-after')) * 1000 || 0, TECHO_DE_ESPERA);
        const cuanto = Math.max(dice, ESPERAS_DE_CUOTA[esperas]);
        esperas += 1;
        avisarDeLaEspera(alEsperar, cuanto, 'cuota', nombre);
        await dormir(cuanto);
        continue;
      }

      // Se acabó la paciencia de esta capa. El error sale TAL CUAL lo dijo Google
      // —sin sustituirlo por una suposición— y de aquí en adelante decide la cola,
      // que para la tanda entera sin perder el trabajo.
    }

    throw error;
  }
}

/**
 * Le cuenta a quien esté mirando que se está esperando, si es que hay alguien.
 * Nunca lanza: un aviso que rompe la llamada que estaba avisando sería absurdo.
 */
function avisarDeLaEspera(alEsperar, ms, por, modo) {
  if (typeof alEsperar !== 'function') return;
  try {
    alEsperar(ms, por, modo);
  } catch {
    // El que avisa se ha roto. No es motivo para perder la generación.
  }
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

  // Si el error viene como TEXTO en vez de como objeto, ese texto se usa. Antes
  // se tiraba y se ponía la frase genérica de abajo, que es la peor de las dos
  // porque dice «no ha explicado por qué» cuando sí lo había explicado. Pasa con
  // las respuestas que no compone esta función —una página de error de la
  // plataforma que sí es JSON, por ejemplo—, y ahí es donde más falta hace.
  const enTexto = typeof (datos && datos.error) === 'string' ? datos.error.trim() : '';

  const mensaje =
    dicho && typeof dicho.mensaje === 'string' && dicho.mensaje.trim()
      ? dicho.mensaje.trim()
      : enTexto ||
        `La función no ha podido atender «${modo}» y ha contestado ${elCodigo(respuesta)}, pero no ` +
        'ha explicado por qué. Es un fallo del propio estudio, no de tu cuenta.';

  // OJO CON EL `dicho &&` DENTRO DEL Number(): estaba mal y reventaba.
  // `Number(null)` es 0, que ES finito, así que con `dicho` a null la condición
  // daba verdadera y la rama buena leía `.http` de null: un TypeError en el
  // camino que sirve para contar errores, o sea el peor sitio posible. Pasa
  // siempre que la respuesta no traiga el error como objeto —una página de error
  // de la plataforma, un cuerpo de otra forma—, que es justo cuando más falta
  // hace saber qué pasó. Lo cazó `npm run freno` la primera vez que se ejecutó.
  const codigo = dicho && Number.isFinite(Number(dicho.http)) ? Number(dicho.http) : http;

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
