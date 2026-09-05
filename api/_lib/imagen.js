// Generación de imagen contra `:generateContent` del modelo del nivel pedido.
//
// Aquí se juntan dos trampas ya pagadas, y las dos están escritas en la forma
// del código, no en un aviso:
//
//   1. CADA REFERENCIA VA SEGUIDA, INMEDIATAMENTE, DE UNA LÍNEA QUE DICE QUÉ
//      COPIAR DE ELLA. El orden de las `parts` es el mensaje: imagen, su
//      instrucción, imagen, su instrucción… y al final el prompt. Si una imagen
//      viaja sin su línea pegada detrás, el modelo copia el ENCUADRE en vez de
//      la IDENTIDAD y salen once criptas distintas y siete Saharis distintas.
//      Por eso una referencia sin instrucción se rechaza antes de gastar.
//
//   2. La «K» de `2K` va en MAYÚSCULA. En minúscula lo rechaza.
//
// El PNG que vuelve pesa ~6,8 MB (~9,1 MB en base64): NO CABE en los 4,5 MB de
// la respuesta de la función. Este módulo devuelve el base64 a quien lo llamó
// para que lo suba al bucket; lo que viaja al navegador es la ruta y una URL
// firmada, nunca la imagen.

import { Buffer } from 'node:buffer';
import { entorno } from './entorno.js';
import { nivelImagen } from './datos.js';
import { ErrorDeCara } from './errores.js';
import { llamar, urlModelo } from './vertex.js';

// Formato de la serie. El 16:9 tiene que coincidir con el `aspectRatio` de Veo
// o el clip recorta la imagen que se aprobó.
const PROPORCION = '16:9';

// La K, en mayúscula. En minúscula Google rechaza la petición.
const TAMANO = '2K';

// Generar una imagen 2K puede llevar su tiempo; el límite sigue por debajo del
// de la plataforma, que es lo único que importa.
const LIMITE_MS = 45_000;

// Firmas de archivo, para poner el tipo cuando no viene dicho. Se miran los
// primeros bytes: es lo único que no miente sobre lo que es un archivo.
const FIRMAS = [
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] }
];

/**
 * Genera una imagen.
 *
 * @param {{texto:string, negativo?:string|null,
 *          referencias?:Array<{datos:Buffer|Uint8Array, mime?:string, instruccion:string, cupo?:string}>,
 *          nivel?:string}} encargo
 *        `texto` es el prompt YA SELLADO por `prompt.js` (lleva pegado
 *        `estilo.bloque`; sellarlo es trabajo de `sellar()`, no de aquí).
 *        `referencias` son las placas ya leídas del bucket, cada una con la
 *        línea que dice qué copiar de ella.
 *        `nivel` es `calidad`, `medio` o `economico`; si no se dice, el que
 *        marque `modelos.imagen.por_defecto` en datos/serie.json.
 * @returns {Promise<{b64:string, mime:string, bytes:number}>}
 */
export async function generar({ texto, negativo = null, referencias = [], nivel } = {}) {
  const prompt = comprobarTexto(texto);
  const refs = comprobarReferencias(referencias);

  // El id del modelo no se escribe aquí: sale de datos/serie.json y lo puede
  // sustituir la variable IMAGE_MODEL sin tocar una línea de código.
  const modelo = nivelImagen(nivel);
  const ent = entorno();

  const cuerpo = {
    contents: [
      {
        role: 'user',
        parts: componerPartes(refs, conNegativo(prompt, negativo))
      }
    ],
    generationConfig: {
      // Se pide imagen y solo imagen: sin esto el modelo puede contestar con
      // texto describiendo lo que dibujaría.
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: PROPORCION,
        // La K en MAYÚSCULA. En minúscula lo rechaza.
        //
        // docs/contrato.md §12 nombra este campo `resolution`; la API de Vertex
        // lo llama `imageSize` dentro de `imageConfig`. Si la cuenta devolviera
        // un error por el NOMBRE del campo, ese error de Google se ve tal cual
        // en pantalla —llega literal en `detalle`— y aquí no se sustituye nada
        // en silencio: se cambia esta línea a conciencia y se anota en el
        // contrato. Cambiar de campo o de modelo por nuestra cuenta haría que el
        // resultado saliera distinto sin que nadie supiera por qué.
        imageSize: TAMANO
      }
    }
  };

  const respuesta = await llamar(urlModelo(modelo, 'generateContent', ent.sa.project_id), cuerpo, {
    metodo: 'POST',
    limiteMs: LIMITE_MS,
    contexto: {
      que: 'generar la imagen',
      modelo: modelo.id,
      region: modelo.region,
      variable: modelo.variable
    }
  });

  return sacarImagen(respuesta, modelo);
}

// ---------------------------------------------------------------------------
// El cuerpo de la petición
// ---------------------------------------------------------------------------

/**
 * Las `parts`, en el ORDEN EXACTO que hace que el modelo copie la identidad y
 * no el encuadre: por cada referencia, la imagen y pegada detrás su línea; y al
 * final del todo, el prompt sellado.
 */
function componerPartes(referencias, prompt) {
  const partes = [];

  for (const ref of referencias) {
    partes.push({ inlineData: { mimeType: ref.mime, data: ref.b64 } });
    // Pegada. Sin esta línea justo detrás de su imagen, la referencia no dice
    // qué copiar y el modelo reproduce el encuadre.
    partes.push({ text: ref.instruccion });
  }

  partes.push({ text: prompt });
  return partes;
}

/**
 * `:generateContent` no tiene campo de negativo: el negativo viaja dentro del
 * texto, y ahí lo deja ya `sellar()`. Si el que llama pasa uno que no está en
 * el prompt, se pega al final con la misma fórmula que usa `sellar()`, para no
 * duplicarlo ni perderlo.
 */
function conNegativo(prompt, negativo) {
  const linea = String(negativo ?? '').trim();
  if (!linea) return prompt;
  if (prompt.includes(linea)) return prompt;
  return `${prompt}\nnegativo: ${linea}`;
}

// ---------------------------------------------------------------------------
// Comprobaciones antes de gastar
// ---------------------------------------------------------------------------

/** El prompt tiene que existir. Sin texto no hay nada que dibujar. */
function comprobarTexto(texto) {
  const prompt = String(texto ?? '').trim();
  if (!prompt) {
    throw new ErrorDeCara(
      'Se ha pedido generar una imagen sin prompt. El prompt lo compone la función a partir de ' +
      'datos/serie.json, así que esto es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }
  return prompt;
}

/**
 * Cada referencia tiene que traer imagen y línea. Se comprueba aquí, antes de
 * llamar, porque una referencia sin línea no falla: sale mal y cuesta dinero.
 *
 * Los cupos por modelo (6 de objeto + 5 de personaje en el Pro, etc.) los
 * comprueba `comprobarCupos()` en `prompt.js`, que es quien sabe de qué cupo es
 * cada referencia.
 */
function comprobarReferencias(referencias) {
  if (referencias === null || referencias === undefined) return [];
  if (!Array.isArray(referencias)) {
    throw new ErrorDeCara(
      'Las referencias de una imagen tienen que venir en una lista. Es un fallo del propio ' +
      'estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }

  return referencias.map((ref, i) => {
    const cual = `la referencia ${i + 1} de ${referencias.length}`;

    if (!ref || typeof ref !== 'object') {
      throw new ErrorDeCara(
        `No se entiende ${cual} que se adjunta a la imagen. Es un fallo del propio estudio, no de ` +
        'tu cuenta.',
        { reintentable: false, http: 500 }
      );
    }

    const datos = aBuffer(ref.datos, cual);
    if (datos.length === 0) {
      throw new ErrorDeCara(
        `${primeraMayuscula(cual)} está vacía: el archivo que se ha leído del bucket no tiene ` +
        'contenido. Vuelve a generar y a aprobar esa placa antes de usarla como referencia.',
        { reintentable: false, http: 500 }
      );
    }

    const instruccion = String(ref.instruccion ?? '').trim();
    if (!instruccion) {
      // Esta es la trampa ya pagada, y por eso se para aquí en vez de mandarla.
      throw new ErrorDeCara(
        `${primeraMayuscula(cual)} viaja sin la línea que dice qué copiar de ella. Sin esa línea ` +
        'el modelo copia el encuadre de la referencia en vez de la identidad del personaje, y la ' +
        'imagen sale mal habiéndola pagado. Las líneas están en ' +
        '«instrucciones_referencia» de datos/serie.json.',
        { reintentable: false, http: 500 }
      );
    }

    const mime = String(ref.mime ?? '').trim() || mimeDeBytes(datos);
    if (!mime) {
      throw new ErrorDeCara(
        `No se sabe qué clase de imagen es ${cual}: no lo dice y no se reconoce por sus primeros ` +
        'bytes. Solo se adjuntan PNG y JPEG.',
        { reintentable: false, http: 500 }
      );
    }

    return { mime, instruccion, b64: datos.toString('base64') };
  });
}

/** Acepta Buffer, Uint8Array o ArrayBuffer. Cualquier otra cosa se explica. */
function aBuffer(datos, cual) {
  if (Buffer.isBuffer(datos)) return datos;
  if (datos instanceof Uint8Array) return Buffer.from(datos.buffer, datos.byteOffset, datos.byteLength);
  if (datos instanceof ArrayBuffer) return Buffer.from(datos);
  throw new ErrorDeCara(
    `${primeraMayuscula(cual)} no trae la imagen leída del bucket, sino otra cosa. Es un fallo ` +
    'del propio estudio, no de tu cuenta.',
    { reintentable: false, http: 500 }
  );
}

// ---------------------------------------------------------------------------
// La respuesta
// ---------------------------------------------------------------------------

/**
 * Saca el base64 de la primera `part` que traiga imagen. Si no hay ninguna
 * —filtro de seguridad, por ejemplo— se lanza con el motivo LITERAL de Google.
 */
function sacarImagen(respuesta, modelo) {
  const candidatos = Array.isArray(respuesta?.candidates) ? respuesta.candidates : [];

  for (const candidato of candidatos) {
    const partes = Array.isArray(candidato?.content?.parts) ? candidato.content.parts : [];
    for (const parte of partes) {
      // Vertex contesta en camelCase; se mira también el snake_case por si
      // alguna versión de la API lo devuelve así.
      const dato = parte?.inlineData ?? parte?.inline_data;
      const b64 = typeof dato?.data === 'string' ? dato.data.trim() : '';
      if (!b64) continue;

      const mime = String(dato.mimeType ?? dato.mime_type ?? '').trim() || 'image/png';
      return { b64, mime, bytes: bytesDeBase64(b64) };
    }
  }

  throw sinImagen(respuesta, modelo, candidatos);
}

/**
 * El modelo ha contestado, pero sin imagen. El motivo va tal cual lo dio Google
 * —en el mensaje, para que se lea en pantalla, y entero en `detalle`—, porque
 * es lo único que dice qué hay que cambiar del prompt.
 */
function sinImagen(respuesta, modelo, candidatos) {
  const motivos = [];

  const feedback = respuesta?.promptFeedback ?? respuesta?.prompt_feedback ?? null;
  const bloqueo = feedback?.blockReason ?? feedback?.block_reason ?? null;
  if (bloqueo) motivos.push(String(bloqueo));
  const bloqueoTexto = feedback?.blockReasonMessage ?? feedback?.block_reason_message ?? null;
  if (bloqueoTexto) motivos.push(String(bloqueoTexto));

  for (const candidato of candidatos) {
    const fin = candidato?.finishReason ?? candidato?.finish_reason ?? null;
    if (fin) motivos.push(String(fin));
    const finTexto = candidato?.finishMessage ?? candidato?.finish_message ?? null;
    if (finTexto) motivos.push(String(finTexto));

    const valoraciones = candidato?.safetyRatings ?? candidato?.safety_ratings ?? [];
    for (const v of Array.isArray(valoraciones) ? valoraciones : []) {
      if (v?.blocked) motivos.push(String(v.category ?? 'categoría sin nombre'));
    }

    // Si en vez de dibujar ha escrito, lo que escribió explica por qué.
    const partes = Array.isArray(candidato?.content?.parts) ? candidato.content.parts : [];
    for (const parte of partes) {
      if (typeof parte?.text === 'string' && parte.text.trim()) motivos.push(parte.text.trim());
    }
  }

  const motivo = [...new Set(motivos.map((m) => m.trim()).filter(Boolean))].join(' · ');
  const porQue = motivo
    ? `Google dice, literalmente: «${recorte(motivo)}».`
    : 'Google no ha dicho por qué: ha contestado sin imagen y sin motivo.';

  return new ErrorDeCara(
    `El modelo «${modelo.id}» no ha devuelto ninguna imagen. ${porQue} ` +
    'Suele ser el filtro de seguridad, que se dispara con la violencia o con la edad de un ' +
    'personaje descritas en el prompt. Repetir tal cual da el mismo resultado: hay que cambiar la ' +
    `descripción de la placa o de la toma en datos/serie.json. El modelo no se sustituye por otro ` +
    `(se cambia a conciencia con la variable ${modelo.variable}).`,
    { detalle: comoTexto(respuesta), reintentable: false, http: 502 }
  );
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/**
 * Cuánto pesa lo que representa un base64, sin decodificarlo: son 6,8 MB de
 * imagen y no hace falta copiarlos en memoria solo para medirlos.
 */
function bytesDeBase64(b64) {
  const limpio = String(b64).replace(/\s+/g, '');
  const relleno = limpio.endsWith('==') ? 2 : limpio.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((limpio.length * 3) / 4) - relleno);
}

/** El tipo de imagen leído de sus primeros bytes. '' si no se reconoce. */
function mimeDeBytes(buf) {
  for (const firma of FIRMAS) {
    if (buf.length < firma.bytes.length) continue;
    let coincide = true;
    for (let i = 0; i < firma.bytes.length; i += 1) {
      if (buf[i] !== firma.bytes[i]) { coincide = false; break; }
    }
    if (coincide) return firma.mime;
  }
  // WEBP: «RIFF» … «WEBP», con el tamaño en medio.
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return '';
}

/** La respuesta entera, para `detalle`, sin que un ciclo tumbe el error. */
function comoTexto(valor) {
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

function recorte(texto, maximo = 600) {
  const t = String(texto);
  return t.length <= maximo ? t : `${t.slice(0, maximo)}…`;
}

function primeraMayuscula(t) {
  return t.length ? t[0].toUpperCase() + t.slice(1) : t;
}
