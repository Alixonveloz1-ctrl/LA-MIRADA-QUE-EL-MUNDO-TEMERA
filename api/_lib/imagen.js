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
import { nivelImagen, serie } from './datos.js';
import { ErrorDeCara } from './errores.js';
import { llamar, urlModelo, conGrafias, comoGrafia } from './vertex.js';

// Formato de la serie. El 16:9 tiene que coincidir con el `aspectRatio` de Veo
// o el clip recorta la imagen que se aprobó.
const PROPORCION = '16:9';

// Las que se pueden pedir. La K, en MAYÚSCULA: en minúscula Google rechaza la
// petición. Cuál se usa lo decide quien paga, desde la pantalla de Salud; lo de
// aquí es solo qué valores son válidos, porque un valor inventado se lo come
// Google con un error en inglés que no dice esto.
//
// Y «auto», QUE NO ES UNA RESOLUCIÓN: es no decir ninguna.
//
// Eso importa por una razón que no se ve leyendo el código y que salió mirando
// la consola de cuotas de una cuenta de verdad: Vertex reparte la cuota de
// imagen por modelo Y POR RESOLUCIÓN, en cubos separados. En esa cuenta, el cubo
// «gemini-3.1-flash-image_default_res» tenía 34 millones por minuto y un 0 % de
// uso, mientras las peticiones que SÍ decían resolución se estrellaban contra un
// 429. Pedir sin decir resolución cae en ese cubo ancho.
const RESOLUCIONES = ['1K', '2K'];
const SIN_DECIR = 'auto';

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
 *        `resolucion` es «1K» o «2K»; si no se dice, la de
 *        `modelos.imagen.parametros.resolution`. Es el otro multiplicador del
 *        gasto además del nivel, y por eso se puede pedir llamada a llamada.
 * @returns {Promise<{b64:string, mime:string, bytes:number}>}
 */
export async function generar({ texto, negativo = null, referencias = [], nivel, resolucion } = {}) {
  const prompt = comprobarTexto(texto);
  const refs = comprobarReferencias(referencias);

  // El id del modelo no se escribe aquí: sale de datos/serie.json y lo puede
  // sustituir la variable IMAGE_MODEL sin tocar una línea de código.
  const modelo = nivelImagen(nivel);
  const ent = entorno();

  const partes = componerPartes(refs, conNegativo(prompt, negativo));

  // `null` significa no mandar el campo: Google elige, y la petición cae en el
  // cubo de cuota más ancho.
  const tamano = resolucionValida(resolucion);

  // Se prueban las grafías del modelo en orden: Vertex publica el mismo modelo
  // con el nombre de preview y el definitivo, y cuál contesta depende del
  // proyecto. Pedir solo uno y recibir 404 se lee como «no lo tienes».
  let respuesta;
  try {
    respuesta = await conGrafias(modelo, (id) =>
      llamar(urlModelo(comoGrafia(modelo, id), 'generateContent', ent.sa.project_id), cuerpoPara(id, partes, tamano), {
        metodo: 'POST',
        limiteMs: LIMITE_MS,
        contexto: {
          que: 'generar la imagen',
          modelo: id,
          region: modelo.region,
          variable: modelo.variable
        }
      }),
    );
  } catch (fallo) {
    throw quizaEsElTamano(fallo, tamano, modelo);
  }

  return sacarImagen(respuesta, modelo);
}

/**
 * El cuerpo de la petición, que NO es el mismo para las dos familias.
 *
 * Las dos diferencias las paga quien no las sabe, porque el error que devuelve
 * Google no dice que sea por esto:
 *
 *   · `responseModalities`: la familia 3 EXIGE ['TEXT','IMAGE']. El 2.5 solo
 *     acepta ['IMAGE']. Con el valor equivocado la petición se rechaza.
 *   · `imageSize`: solo lo acepta la familia 3. Mandárselo al 2.5 es un error.
 *
 * @param {string} id la grafía concreta que se está probando
 * @param {object[]} partes
 * @returns {object}
 */
/**
 * Un tiempo agotado generando una imagen a 2K casi nunca es mala suerte: es que
 * no cabe.
 *
 * Una imagen no es como un vídeo. El vídeo se lanza y se consulta después, así
 * que puede tardar lo que quiera; la imagen se pide y se espera, y lo que se
 * puede esperar es lo que la plataforma deje vivir a la función: menos de un
 * minuto en el plan gratuito. A 2K, una imagen con referencias se acerca
 * demasiado a ese techo y unas veces entra y otras no.
 *
 * El mensaje de siempre dice «se puede volver a intentar», y ahí eso es medio
 * engañoso: volver a intentarlo a 2K vuelve a tardar lo mismo. Lo que de verdad
 * lo arregla es bajar a 1K, así que se dice, y se dice DÓNDE se cambia.
 */
function quizaEsElTamano(fallo, tamano, modelo) {
  if (!fallo || fallo.http !== 504 || tamano !== '2K') return fallo;

  return new ErrorDeCara(
    'La imagen se ha pasado del tiempo que la función puede esperar. Con «2K» pasa a menudo: una ' +
      'imagen de ese tamaño con referencias se acerca al minuto, y ahí es donde la plataforma corta. ' +
      'Volver a intentarlo a 2K vuelve a tardar lo mismo. Lo que lo arregla es bajar a «1K» en ' +
      'Salud, en «Con qué se genera»: se genera de sobra dentro del tiempo y para un keyframe ' +
      'sobra, porque el vídeo sale a 720p de todas formas. El 2K solo se nota en las placas del ' +
      'banco, que son las que se miran de cerca.',
    { detalle: fallo.detalle || null, reintentable: true, http: 504 }
  );
}

function resolucionValida(pedida) {
  const texto = typeof pedida === 'string' ? pedida.trim().toUpperCase() : '';

  // No decir ninguna es una opción, y a veces la única que funciona.
  if (texto === SIN_DECIR.toUpperCase()) return null;

  // SI SE PIDE UNA Y NO VALE, SE FALLA. Caer al valor por defecto en silencio
  // esconde el defecto de quien la pidió: la imagen saldría a 2K, se pagaría a
  // 2K, y quien creía haber elegido 1K no se enteraría nunca.
  if (texto && !RESOLUCIONES.includes(texto)) {
    throw new ErrorDeCara(
      `«${pedida}» no es una resolución de imagen. Las que hay son ${RESOLUCIONES.join(' y ')}, ` +
        'y se eligen en la pantalla de Salud.',
      { reintentable: false, http: 400 }
    );
  }
  if (texto) return texto;

  // No se ha pedido ninguna: la de los datos, que es la de la serie.
  const escrita = String(
    ((serie.modelos && serie.modelos.imagen && serie.modelos.imagen.parametros) || {}).resolution || ''
  ).trim().toUpperCase();
  if (RESOLUCIONES.includes(escrita)) return escrita;

  throw new ErrorDeCara(
    `datos/serie.json declara «${escrita || 'nada'}» como resolución de imagen en ` +
      `modelos.imagen.parametros.resolution, y las que hay son ${RESOLUCIONES.join(' y ')}. ` +
      'Es un fallo de los datos, no de tu cuenta.',
    { reintentable: false, http: 500 }
  );
}

function cuerpoPara(id, partes, tamano) {
  const familia3 = /^gemini-3/i.test(String(id));
  const imageConfig = { aspectRatio: PROPORCION };

  // La K en MAYÚSCULA. En minúscula lo rechaza. docs/contrato.md §12 nombra este
  // campo `resolution`; la API de Vertex lo llama `imageSize` dentro de
  // `imageConfig`, y solo en la familia 3.
  // Sin tamaño no se manda el campo: decide Google. No es lo mismo que mandar
  // uno «normal», porque la cuota de Vertex va por modelo Y resolución.
  if (familia3 && tamano) imageConfig.imageSize = tamano;

  return {
    contents: [{ role: 'user', parts: partes }],
    generationConfig: {
      responseModalities: familia3 ? ['TEXT', 'IMAGE'] : ['IMAGE'],
      imageConfig
    }
  };
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
