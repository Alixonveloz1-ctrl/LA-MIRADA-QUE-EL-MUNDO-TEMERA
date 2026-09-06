// Errores que se pueden enseñar.
//
// Aquí no hay códigos para el usuario. Un fallo es una frase en español que se
// pinta tal cual en la pantalla del teléfono, y debajo, sin tocar, lo que dijo
// Google. Traducir a Google es mentir: su texto va literal en `.detalle`.
//
// Reglas duras de docs/contrato.md §4, que este módulo hace imposibles de
// saltarse:
//   · Un 413 no se reintenta NUNCA, y su mensaje dice cuánto pesaba.
//   · Un 4xx no se reintenta: no va a cambiar.
//   · Un 404 de un Gemini 3.x explica que esos modelos solo viven en «global»,
//     porque ese 404 parece falta de acceso y no lo es.
//
// Este módulo no importa nada: lo importan todos los demás.

/** Tope de la plataforma, por petición y por respuesta. */
const LIMITE_CUERPO = 4.5 * 1024 * 1024;

/** Un cuerpo de error de Google puede venir enorme (una página HTML entera). */
const MAXIMO_DETALLE = 8000;

/** Códigos de red que no traen HTTP pero sí merecen otro intento. */
const CODIGOS_DE_RED = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN',
  'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_SOCKET',
]);

// ---------------------------------------------------------------------------
// La clase
// ---------------------------------------------------------------------------

/**
 * El error que se enseña. `mensaje` se pinta sin adornos; `detalle` es lo que
 * contestó Google, literal, o null.
 */
export class ErrorDeCara extends Error {
  constructor(mensaje, { detalle = null, reintentable = false, http = 500 } = {}) {
    super(String(mensaje));
    this.name = 'ErrorDeCara';
    this.mensaje = String(mensaje);
    this.detalle = detalle == null ? null : recortar(String(detalle));
    this.http = Number.isFinite(Number(http)) ? Number(http) : 500;
    // El que crea el error puede pedir reintento, pero no puede regalarlo: si
    // el código no lo admite (cualquier 4xx, y el 413 el primero), se cae aquí.
    // Es el cerrojo que impide que un 413 vuelva a intentarse por descuido.
    this.reintentable = Boolean(reintentable) && esReintentable(this.http);
  }
}

// ---------------------------------------------------------------------------
// Reintentos
// ---------------------------------------------------------------------------

/**
 * 408, 429 y 5xx sí. Cualquier otro 4xx no. El 413, jamás.
 * Sin código (se cortó la red, no hubo respuesta) cuenta como 408: sí.
 */
export function esReintentable(http) {
  const codigo = Number(http);
  if (!Number.isFinite(codigo) || codigo <= 0) return true; // no hubo respuesta
  if (codigo === 413) return false;                          // el tamaño no cambia por insistir
  if (codigo === 408 || codigo === 429) return true;
  if (codigo >= 400 && codigo < 500) return false;           // no va a cambiar
  if (codigo >= 500) return true;                            // es de ellos, no nuestro
  return false;                                              // 2xx y 3xx no son fallo
}

// ---------------------------------------------------------------------------
// Traducir una respuesta de Google
// ---------------------------------------------------------------------------

/**
 * Convierte una respuesta no-2xx de Google en un ErrorDeCara.
 *
 * @param {number} http        el código que devolvió Google (0 si no hubo respuesta)
 * @param {string|object} cuerpoTexto  el cuerpo tal cual llegó
 * @param {object|string} contexto     lo que sabemos de la llamada:
 *        { que, modelo, region, variable, bytes, ruta, servicio }
 *        · `que`      — qué se estaba haciendo, en español ("generar la placa saharis-ancla")
 *        · `modelo`   — id del modelo pedido
 *        · `region`   — región a la que se pidió
 *        · `variable` — variable de entorno que lo sustituye (IMAGE_MODEL, VEO_MODEL…)
 *        · `bytes`    — tamaño real de lo que se mandó o se iba a devolver (para el 413)
 */
export function deGoogle(http, cuerpoTexto, contexto = {}) {
  const ctx = typeof contexto === 'string' ? { que: contexto } : (contexto || {});
  const codigo = Number.isFinite(Number(http)) ? Number(http) : 0;
  const { detalle, texto } = leerCuerpoDeGoogle(cuerpoTexto);
  const mensaje = mensajeDeCodigo(codigo, ctx, texto);
  return new ErrorDeCara(mensaje, {
    detalle,
    reintentable: esReintentable(codigo),
    // Si Google no llegó a contestar, lo contamos como fallo de pasarela.
    http: codigo || 502,
  });
}

/**
 * La forma en que sale por la puerta: docs/contrato.md §1.
 * Acepta cualquier cosa que se haya lanzado, no solo un ErrorDeCara.
 */
export function comoRespuesta(err) {
  const e = err instanceof ErrorDeCara ? err : deLoInesperado(err);
  return {
    ok: false,
    error: {
      mensaje: e.mensaje,
      detalle: e.detalle,
      reintentable: e.reintentable,
      http: e.http,
    },
  };
}

// ---------------------------------------------------------------------------
// Los mensajes, uno por código
// ---------------------------------------------------------------------------

function mensajeDeCodigo(codigo, ctx, textoCrudo) {
  const donde = ctx.que ? `${primeraMayuscula(String(ctx.que))}: ` : '';
  const cual = detalleDelModelo(ctx);

  switch (codigo) {
    case 400:
      return `${donde}Google ha rechazado la petición por cómo está formada (400)${cual}. ` +
        'No se reintenta: con el mismo cuerpo la respuesta será la misma. Debajo está, ' +
        'palabra por palabra, lo que ha contestado.';

    case 401:
      return `${donde}Google no ha aceptado las credenciales (401). Es la service account: ` +
        'comprueba que GCP_SERVICE_ACCOUNT lleva el JSON completo, con la private_key entera ' +
        'y sus saltos de línea, que la cuenta sigue activa y que la hora del servidor no va ' +
        'desviada, porque el token va firmado con fecha.';

    case 403:
      return `${donde}Google dice que esta service account no tiene permiso para hacerlo (403)${cual}. ` +
        'Son dos cosas distintas que se ven igual: los papeles de la cuenta (Vertex AI User, y ' +
        'Storage Object Admin sobre el bucket) y las APIs habilitadas en el proyecto ' +
        '(aiplatform.googleapis.com, storage.googleapis.com, texttospeech.googleapis.com, ' +
        'speech.googleapis.com y run.googleapis.com). Revisa las dos.';

    case 404:
      return mensaje404(donde, ctx, textoCrudo, cual);

    case 405:
      return `${donde}Google dice que ese camino no acepta este método (405). Es la petición, ` +
        'no la cuenta: se está llamando al sitio correcto de la forma equivocada.';

    case 408:
      return `${donde}Google ha tardado más de lo permitido y la llamada se ha cortado (408). ` +
        'Se puede volver a intentar. Si pasa siempre, lo que se pide es demasiado para el ' +
        'tiempo que hay: pártelo en trozos más pequeños.';

    case 409:
      return `${donde}Otro cambio ha llegado antes que este (409). No se pisa nada: se vuelve ` +
        'a leer el estado del bucket, se aplica el cambio encima y se guarda otra vez.';

    case 413:
      return mensaje413(donde, ctx);

    case 415:
      return `${donde}Google no entiende el formato de lo que se le manda (415). Revisa el tipo ` +
        'de contenido de la petición.';

    case 429:
      return `${donde}Se ha pasado de cuota en Vertex (429)${cual}. No es falta de acceso, ` +
        'aunque el texto lo parezca, y no es un fallo del estudio: es la cuota de tu cuenta de ' +
        'Google, que en una cuenta nueva es muy corta. El estudio ya genera de una en una, así ' +
        'que esto no se arregla bajando ningún número ni generando más despacio. Al recibirlo se ' +
        'para LA COLA ENTERA —no solo este trabajo— y se vuelve a probar a los 30 s, al minuto y ' +
        'al minuto y medio, porque las cuotas de Vertex se reponen por minutos. Si aun así vuelve, ' +
        'lo único que lo arregla es pedir más cuota para ese modelo en la consola de Google Cloud, ' +
        'en «IAM y administración → Cuotas», buscando por el nombre del modelo.';

    case 499:
      return `${donde}La llamada se ha cancelado antes de que Google terminara (499). Suele ser ` +
        'el límite de tiempo propio de la función, puesto a propósito por debajo del de la ' +
        'plataforma para que el fallo se vea en pantalla en vez de morir en silencio.';

    case 500:
      return `${donde}Google ha fallado por su lado (500)${cual}. No es la petición: se puede ` +
        'volver a intentar dentro de un momento.';

    case 503:
      return `${donde}El modelo no está disponible ahora mismo, o está saturado (503)${cual}. ` +
        'Se puede volver a intentar dentro de un momento; no hace falta cambiar nada.';

    case 504:
      return `${donde}Google no ha contestado a tiempo (504)${cual}. Se puede volver a intentar.`;

    default:
      if (codigo >= 500) {
        return `${donde}Google ha fallado por su lado (código ${codigo})${cual}. Se puede volver ` +
          'a intentar dentro de un momento.';
      }
      if (codigo > 0) {
        return `${donde}Google ha contestado con el código ${codigo}${cual}, que no tiene una ` +
          'explicación preparada. Debajo está, literal, lo que ha dicho.';
      }
      return `${donde}Google no ha llegado a contestar${cual}: se cortó la conexión o se agotó ` +
        'el tiempo antes de recibir nada. Se puede volver a intentar.';
  }
}

function mensaje404(donde, ctx, textoCrudo, cual) {
  const id = ctx.modelo ? String(ctx.modelo) : '';
  const region = ctx.region ? String(ctx.region) : '';
  const variable = ctx.variable ? String(ctx.variable) : '';
  const esTres = esGemini3(id) || (!id && /gemini-3/i.test(textoCrudo || ''));

  if (esTres && region && region !== 'global') {
    return `${donde}Google no encuentra el modelo «${id || 'gemini-3.x'}» en la región ` +
      `«${region}» (404). Parece falta de acceso y no lo es: los modelos Gemini 3.x solo se ` +
      'sirven desde la región «global». Hay que pedirlo a «global»' +
      (variable ? `, o cambiar el modelo con la variable ${variable}.` : '.');
  }

  if (esTres) {
    return `${donde}Google no encuentra el modelo «${id || 'gemini-3.x'}» (404), y ya se está ` +
      'pidiendo a la región «global», que es la única que sirve los Gemini 3.x. Entonces es el ' +
      'id o el acceso: comprueba que el id existe tal cual y que el proyecto tiene ese modelo ' +
      'habilitado' + (variable ? `. Se puede sustituir con la variable ${variable}.` : '.');
  }

  if (id) {
    return `${donde}Google no encuentra el modelo «${id}»` +
      (region ? ` en la región «${region}»` : '') + ' (404). Revisa que el id esté escrito tal ' +
      'cual y que se pida a la región donde ese modelo se sirve' +
      (variable ? `; se cambia con la variable ${variable}, sin tocar el código.` : '.');
  }

  return `${donde}Google dice que no existe lo que se le ha pedido (404). Revisa la ruta y el ` +
    'nombre del recurso; con un 404 no se reintenta, porque no va a aparecer solo.';
}

function mensaje413(donde, ctx) {
  const tope = conComa(LIMITE_CUERPO / 1024 / 1024);
  const pesaba = ctx.bytes != null && Number.isFinite(Number(ctx.bytes))
    ? `y esto pesaba ${peso(Number(ctx.bytes))}`
    : 'y no se ha podido medir cuánto pesaba esto';
  return `${donde}No cabe: el límite es de ${tope} MB por petición y por respuesta, ${pesaba}. ` +
    'No se reintenta, porque el tamaño no cambia por insistir. El master en 2K se queda en el ' +
    'bucket y no viaja nunca: a Veo va una copia reducida a 1280 px en JPEG, y lo demás se mira ' +
    'por URL firmada.';
}

function detalleDelModelo(ctx) {
  if (!ctx.modelo) return ctx.servicio ? ` (servicio ${ctx.servicio})` : '';
  const trozos = [`modelo «${ctx.modelo}»`];
  if (ctx.region) trozos.push(`región «${ctx.region}»`);
  if (ctx.variable) trozos.push(`se sustituye con ${ctx.variable}`);
  return ` (${trozos.join(', ')})`;
}

/** Los Gemini 3.x son los que solo viven en «global». */
function esGemini3(id) {
  return /^gemini-3(\.\d+)?[-.]/i.test(String(id || ''));
}

// ---------------------------------------------------------------------------
// Leer el cuerpo que manda Google sin reescribirlo
// ---------------------------------------------------------------------------

/**
 * Saca el mensaje de Google del cuerpo, sea JSON o no. Nunca lo reformula: lo
 * único que se hace es recortarlo si viene descomunal, y se dice que se recortó.
 */
function leerCuerpoDeGoogle(cuerpo) {
  const texto = typeof cuerpo === 'string'
    ? cuerpo
    : (cuerpo == null ? '' : aTextoSeguro(cuerpo));

  if (!texto.trim()) return { detalle: null, texto: '' };

  let dato = null;
  try {
    dato = JSON.parse(texto);
  } catch {
    // No era JSON (una página de error, un HTML, un texto suelto): va tal cual.
    return { detalle: recortar(texto.trim()), texto };
  }

  const nudo = nudoDeError(dato);
  if (!nudo) return { detalle: recortar(texto.trim()), texto };

  let detalle = typeof nudo === 'string' ? nudo : (nudo.message ?? nudo.mensaje ?? null);
  if (detalle == null) return { detalle: recortar(texto.trim()), texto };

  detalle = String(detalle);

  // Los `details` de Google llevan el motivo de la cuota o del permiso. Se
  // pegan literales, en su JSON, sin interpretarlos.
  const extras = typeof nudo === 'object' && Array.isArray(nudo.details) && nudo.details.length
    ? aTextoSeguro(nudo.details)
    : null;
  if (extras && detalle.length + extras.length + 1 < MAXIMO_DETALLE) {
    detalle = `${detalle}\n${extras}`;
  }

  return { detalle: recortar(detalle), texto };
}

/** El nudo `error` puede venir suelto, dentro de un array o como `error.error`. */
function nudoDeError(dato) {
  if (dato == null) return null;
  if (Array.isArray(dato)) {
    for (const trozo of dato) {
      const encontrado = nudoDeError(trozo);
      if (encontrado) return encontrado;
    }
    return null;
  }
  if (typeof dato !== 'object') return null;
  if (dato.error != null) {
    if (typeof dato.error === 'string') return dato.error;
    if (typeof dato.error === 'object') return dato.error;
  }
  if (typeof dato.message === 'string') return dato;
  return null;
}

// ---------------------------------------------------------------------------
// Lo que se rompe sin haberlo previsto
// ---------------------------------------------------------------------------

function deLoInesperado(err) {
  const nombre = err && typeof err === 'object' ? String(err.name || '') : '';
  const codigoDeRed = err && typeof err === 'object'
    ? String(err.code || (err.cause && err.cause.code) || '')
    : '';
  const dicho = err && typeof err === 'object' && err.message ? String(err.message) : String(err);

  if (nombre === 'AbortError' || nombre === 'TimeoutError') {
    return new ErrorDeCara(
      'Se ha agotado el tiempo de la llamada y se ha cortado a propósito, antes de que la ' +
      'plataforma apagara la función sin decir nada. Se puede volver a intentar; si es una ' +
      'operación de Veo, sigue viva y se consulta después.',
      { detalle: dicho, reintentable: true, http: 504 },
    );
  }

  if (CODIGOS_DE_RED.has(codigoDeRed)) {
    return new ErrorDeCara(
      'Se ha caído la conexión con Google a mitad de la llamada. No es la cuenta ni la ' +
      'petición: se puede volver a intentar.',
      { detalle: `${codigoDeRed}: ${dicho}`, reintentable: true, http: 502 },
    );
  }

  return new ErrorDeCara(
    'Se ha roto algo que no estaba previsto y no tiene una explicación preparada. Debajo está, ' +
    'sin traducir, lo que ha dicho el programa.',
    { detalle: dicho, reintentable: false, http: 500 },
  );
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

function recortar(texto, maximo = MAXIMO_DETALLE) {
  const t = String(texto);
  if (t.length <= maximo) return t;
  return `${t.slice(0, maximo)}… (recortado: eran ${t.length} caracteres)`;
}

/** JSON.stringify sin que un ciclo tumbe el manejador de errores. */
function aTextoSeguro(valor) {
  const vistos = new WeakSet();
  try {
    return JSON.stringify(valor, (_clave, v) => {
      if (v && typeof v === 'object') {
        if (vistos.has(v)) return '«ciclo»';
        vistos.add(v);
      }
      return v;
    }) ?? String(valor);
  } catch {
    return String(valor);
  }
}

/** Tamaños con coma decimal, como se escriben en español. */
function peso(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return 'un tamaño que no se ha podido medir';
  if (n < 1024) return `${n} bytes`;
  const kb = n / 1024;
  if (kb < 1024) return `${conComa(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${conComa(mb)} MB`;
  return `${conComa(mb / 1024)} GB`;
}

function conComa(x) {
  return x.toFixed(1).replace('.', ',');
}

function primeraMayuscula(t) {
  return t.length ? t[0].toUpperCase() + t.slice(1) : t;
}
