// Reducir el master antes de mandarlo a Veo. Esta es la trampa más cara del
// proyecto y este archivo entero existe para no volver a pagarla.
//
// EL PROBLEMA, CON NÚMEROS. Un keyframe en 2K sale del bucket como PNG y pesa
// unos 6,8 MB. Metido en JSON como base64 se hincha un tercio más: unos 9,1 MB. El
// límite de la plataforma son 4,5 MB por petición, así que no cabe ni de lejos. Y
// lo peor no es que falle: es CÓMO falla. Pasarse de tamaño no da un «no cabe»,
// da un corte que parece un tiempo agotado, y se busca el fallo en la cuota de
// Vertex, en la región del modelo o en la red, que es donde no está.
//
// LA SOLUCIÓN. El master 2K se queda en el bucket y no viaja nunca. Lo que se
// manda a Veo es esto: una copia de 1280 px de ancho, en JPEG de calidad 0,86,
// hecha aquí en el navegador. Son unos 200-400 KB, y con `lastFrame` viajan dos,
// así que las dos van reducidas. Veo trabaja igual de bien con ella: el
// fotograma inicial le sirve de referencia de composición y de color, no de
// resolución final.
//
// POR QUÉ SE DESCARGA CON `fetch` Y NO SE PINTA UN `<img>` DIRECTO. Un `<img>` de
// otro origen se enseña sin permiso ninguno, pero en cuanto un canvas lo lee, el
// canvas queda «contaminado» y el navegador prohíbe sacar los píxeles. O sea: se
// vería la imagen y fallaría justo al convertirla, que es el peor sitio para
// enterarse. Bajándola con `fetch` el permiso se comprueba ANTES de dibujar nada,
// y si falta, falta con nombre y apellidos: le falta CORS al bucket. Además la
// imagen decodificada sale de datos ya descargados, así que el canvas no se
// contamina nunca.

import { ErrorDeCara } from './api.js';

/**
 * El ancho al que se reduce todo lo que va a Veo. 1280 px sobre 16:9 son 720 de
 * alto: cabe de sobra en los 4,5 MB y no se nota en el resultado.
 */
export const ANCHO_VEO = 1280;

/** La calidad del JPEG. Por debajo se ven los bloques; por encima no cabe tan holgado. */
const CALIDAD_JPEG = 0.86;

// ---------------------------------------------------------------------------
// Reducir
// ---------------------------------------------------------------------------

/**
 * Descarga el master por su URL firmada y devuelve una copia reducida, lista
 * para viajar dentro de la petición.
 *
 * @param {string} url la URL firmada que devolvió la función
 * @returns {Promise<{b64:string, ancho:number, alto:number, bytes:number}>}
 *   `b64` sin el prefijo `data:`, `bytes` lo que pesa el JPEG de verdad.
 *   Lo que ocupa al viajar es un tercio más: eso lo dice `pesoDeB64()`.
 */
export async function reducirParaVeo(url) {
  const direccion = String(url ?? '').trim();
  if (!direccion) {
    throw new ErrorDeCara(
      'Se ha intentado preparar una imagen para el vídeo sin decir cuál. Es un fallo del propio ' +
        'estudio, no de tu cuenta.',
      { reintentable: false, http: 400 }
    );
  }

  const original = await descargar(direccion);
  const lamina = await decodificar(original);

  try {
    const anchoOriginal = Number(lamina.naturalWidth || lamina.width) || 0;
    const altoOriginal = Number(lamina.naturalHeight || lamina.height) || 0;

    if (!anchoOriginal || !altoOriginal) {
      throw new ErrorDeCara(
        'La imagen se ha descargado del bucket pero no tiene tamaño: ha llegado vacía o a medias. ' +
          'Vuelve a generarla, o mírala primero en la pantalla del banco para ver si está bien.',
        { reintentable: false, http: 500 }
      );
    }

    // No se agranda nunca lo que ya viene pequeño: sería peso de más sin un solo
    // detalle de más.
    const escala = anchoOriginal > ANCHO_VEO ? ANCHO_VEO / anchoOriginal : 1;
    const ancho = Math.max(1, Math.round(anchoOriginal * escala));
    const alto = Math.max(1, Math.round(altoOriginal * escala));

    const lienzo = dibujar(lamina, ancho, alto);
    const jpeg = await aJpeg(lienzo);
    const b64 = await aBase64(jpeg);

    return { b64, ancho, alto, bytes: jpeg.size };
  } finally {
    // Un `ImageBitmap` ocupa memoria de verdad hasta que se cierra, y en un
    // teléfono con 400 planos eso se nota.
    if (lamina && typeof lamina.close === 'function') lamina.close();
    if (lamina && lamina.__soltar) lamina.__soltar();
  }
}

/**
 * Lo que pesa un base64 al viajar dentro de la petición, en bytes.
 *
 * Es la cuenta que importa: el JPEG puede pesar 300 KB en disco, pero lo que
 * cuenta contra los 4,5 MB es el texto en base64 que va dentro del JSON, que es
 * un tercio más grande. Con `lastFrame` viajan dos, así que se suman.
 *
 * @param {string} b64 con o sin el prefijo `data:`
 * @returns {number} bytes que ocupa la cadena tal cual se manda
 */
export function pesoDeB64(b64) {
  if (typeof b64 !== 'string' || !b64) return 0;
  const coma = b64.startsWith('data:') ? b64.indexOf(',') : -1;
  // Base64 es ASCII puro: un carácter, un byte.
  return coma >= 0 ? b64.length - coma - 1 : b64.length;
}

// ---------------------------------------------------------------------------
// Bajar el master
// ---------------------------------------------------------------------------

/**
 * Baja la imagen por su URL firmada.
 * @param {string} direccion
 * @returns {Promise<Blob>}
 */
async function descargar(direccion) {
  let respuesta;
  try {
    respuesta = await fetch(direccion, { mode: 'cors', cache: 'no-store' });
  } catch (fallo) {
    // Aquí es donde aparece la falta de CORS: `fetch` revienta sin código y sin
    // cuerpo, y el navegador no cuenta por qué. Es esto casi siempre.
    throw faltaCors(mensajeDe(fallo));
  }

  if (!respuesta.ok) {
    const codigo = Number(respuesta.status) || 0;

    if (codigo === 403 || codigo === 401) {
      throw new ErrorDeCara(
        'El enlace de la imagen ya no vale: las URL firmadas caducan a las seis horas. No es un ' +
          'problema de permisos ni de tu cuenta. Vuelve a entrar en la pantalla para que pida ' +
          'enlaces nuevos y repite la operación.',
        { detalle: `HTTP ${codigo}`, reintentable: false, http: codigo }
      );
    }

    if (codigo === 404) {
      throw new ErrorDeCara(
        'La imagen ya no está en el bucket: el enlace apunta a un archivo que no existe. Si la ' +
          'has borrado, vuelve a generarla; si no la has borrado tú, mira la pantalla de Salud ' +
          'para comprobar que se está usando el bucket que crees.',
        { detalle: `HTTP ${codigo}`, reintentable: false, http: codigo }
      );
    }

    throw new ErrorDeCara(
      `No se ha podido bajar la imagen del bucket: ha contestado con un ${codigo}. Vuelve a ` +
        'intentarlo, y si sigue igual mira la pantalla de Salud, que comprueba de verdad si el ' +
        'bucket se lee y se escribe.',
      { detalle: `HTTP ${codigo}`, reintentable: codigo >= 500, http: codigo }
    );
  }

  try {
    return await respuesta.blob();
  } catch (fallo) {
    throw new ErrorDeCara(
      'La imagen se ha empezado a bajar del bucket pero se ha cortado a mitad. Suele ser la ' +
        'conexión del teléfono: vuelve a intentarlo.',
      { detalle: mensajeDe(fallo), reintentable: true, http: 0 }
    );
  }
}

// ---------------------------------------------------------------------------
// Decodificar y dibujar
// ---------------------------------------------------------------------------

/**
 * Convierte los bytes bajados en algo que se pueda dibujar. Nunca contamina el
 * lienzo: lo que se decodifica son datos que ya están en esta página.
 * @param {Blob} original
 * @returns {Promise<ImageBitmap|HTMLImageElement>}
 */
async function decodificar(original) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(original);
    } catch (fallo) {
      throw noSeEntiende(original, mensajeDe(fallo));
    }
  }

  // Camino para un navegador sin `createImageBitmap`. La dirección `blob:` es de
  // esta misma página, así que tampoco contamina el lienzo. Todo va dentro del
  // try: aquí no puede escaparse un fallo del navegador sin traducir, porque
  // saldría a pantalla en inglés y sin decir qué hacer.
  let direccion = null;
  try {
    direccion = URL.createObjectURL(original);
    const imagen = new Image();
    imagen.decoding = 'sync';

    await new Promise((bien, mal) => {
      imagen.onload = () => bien();
      imagen.onerror = () => mal(new Error('el navegador no ha podido decodificar la imagen'));
      imagen.src = direccion;
    });

    const suelta = direccion;
    imagen.__soltar = () => soltar(suelta);
    return imagen;
  } catch (fallo) {
    soltar(direccion);
    throw noSeEntiende(original, mensajeDe(fallo));
  }
}

/** Suelta una dirección `blob:` sin hacer ruido si ya no se puede. */
function soltar(direccion) {
  if (!direccion) return;
  try {
    URL.revokeObjectURL(direccion);
  } catch {
    // El navegador ya la ha soltado por su cuenta: no hay nada que arreglar.
  }
}

/**
 * Pinta la imagen ya decodificada en un lienzo del tamaño de destino.
 * @param {ImageBitmap|HTMLImageElement} lamina
 * @param {number} ancho
 * @param {number} alto
 * @returns {HTMLCanvasElement}
 */
function dibujar(lamina, ancho, alto) {
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;

  // Sin canal alfa: el JPEG no tiene transparencia, y así el fondo es el mismo
  // en todos los navegadores en vez de depender de cómo cada uno aplaste lo
  // transparente. Se pinta el negro a mano para que quede escrito cuál es.
  const pincel = lienzo.getContext('2d', { alpha: false });
  if (!pincel) {
    throw new ErrorDeCara(
      'Este navegador no deja dibujar imágenes fuera de pantalla, y sin eso no se puede reducir el ' +
        'keyframe antes de mandarlo a Veo. Prueba con otro navegador: en el teléfono, el que trae ' +
        'el sistema.',
      { reintentable: false, http: 500 }
    );
  }

  pincel.fillStyle = '#000';
  pincel.fillRect(0, 0, ancho, alto);
  pincel.imageSmoothingEnabled = true;
  pincel.imageSmoothingQuality = 'high';
  pincel.drawImage(lamina, 0, 0, ancho, alto);

  return lienzo;
}

/**
 * Saca el JPEG del lienzo.
 *
 * Si el lienzo estuviera contaminado, aquí es donde el navegador lo diría, y lo
 * diría con un `SecurityError` que no menciona CORS por ningún lado. Se traduce.
 *
 * @param {HTMLCanvasElement} lienzo
 * @returns {Promise<Blob>}
 */
async function aJpeg(lienzo) {
  if (typeof lienzo.toBlob === 'function') {
    try {
      const trozo = await new Promise((bien) => {
        lienzo.toBlob((resultado) => bien(resultado), 'image/jpeg', CALIDAD_JPEG);
      });
      if (trozo) return trozo;
    } catch (fallo) {
      throw traducirSeguridad(fallo);
    }
    throw new ErrorDeCara(
      'El navegador no ha podido convertir la imagen reducida a JPEG y no ha dicho por qué. Suele ' +
        'ser falta de memoria en el teléfono: cierra pestañas y vuelve a intentarlo.',
      { reintentable: true, http: 500 }
    );
  }

  // Camino de emergencia para un navegador sin `toBlob`.
  let texto;
  try {
    texto = lienzo.toDataURL('image/jpeg', CALIDAD_JPEG);
  } catch (fallo) {
    throw traducirSeguridad(fallo);
  }
  return aTrozo(texto);
}

/**
 * El JPEG en base64, sin el prefijo `data:`.
 * @param {Blob} jpeg
 * @returns {Promise<string>}
 */
async function aBase64(jpeg) {
  const texto = await new Promise((bien, mal) => {
    const lector = new FileReader();
    lector.onload = () => bien(String(lector.result || ''));
    lector.onerror = () => mal(lector.error || new Error('no se ha podido leer el JPEG reducido'));
    lector.readAsDataURL(jpeg);
  }).catch((fallo) => {
    throw new ErrorDeCara(
      'La imagen se ha reducido bien pero el navegador no ha podido prepararla para mandarla. ' +
        'Suele ser falta de memoria en el teléfono: cierra pestañas y vuelve a intentarlo.',
      { detalle: mensajeDe(fallo), reintentable: true, http: 500 }
    );
  });

  const coma = texto.indexOf(',');
  if (coma < 0) {
    throw new ErrorDeCara(
      'El navegador ha devuelto la imagen reducida en un formato que no se entiende. Es un fallo ' +
        'del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }
  return texto.slice(coma + 1);
}

/**
 * Un `data:` convertido en bytes, para el camino sin `toBlob`.
 * @param {string} texto
 * @returns {Blob}
 */
function aTrozo(texto) {
  const coma = String(texto).indexOf(',');
  const crudo = atob(coma >= 0 ? texto.slice(coma + 1) : texto);
  const bytes = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i += 1) bytes[i] = crudo.charCodeAt(i);
  return new Blob([bytes], { type: 'image/jpeg' });
}

// ---------------------------------------------------------------------------
// Los fallos, con palabras
// ---------------------------------------------------------------------------

/**
 * El error de CORS, que es el único que hay que saberse de memoria en este
 * archivo. Se dice qué falta, por qué hace falta y cómo se pone.
 * @param {string|null} detalle lo que dijo el navegador, literal
 * @returns {ErrorDeCara}
 */
function faltaCors(detalle) {
  return new ErrorDeCara(
    'No se ha podido leer la imagen del bucket, y esto casi siempre significa una sola cosa: al ' +
      'bucket le falta CORS. El navegador enseña sin problema una imagen que viene de otro sitio, ' +
      'pero para reducirla a 1280 px antes de mandarla a Veo tiene que leerla entera, y para leerla ' +
      'necesita permiso del bucket. Se arregla una vez y no se vuelve a tocar: se guarda un archivo ' +
      'cors.json con el origen de esta aplicación (el mismo que ves en la barra de direcciones), el ' +
      'método GET y la cabecera Content-Type, y se aplica al bucket con «gcloud storage buckets ' +
      'update gs://TU-BUCKET --cors-file=cors.json». El JSON exacto, listo para copiar, está en ' +
      'docs/despliegue.md. La pantalla de Salud comprueba esto mismo con un archivo de un píxel: si ' +
      'ahí también falla, es CORS seguro. Si CORS ya está puesto, entonces mira la conexión.',
    { detalle, reintentable: false, http: 0 }
  );
}

/**
 * Un `SecurityError` del lienzo es exactamente lo mismo: falta CORS. Cualquier
 * otro fallo se cuenta tal cual.
 * @param {*} fallo
 * @returns {ErrorDeCara}
 */
function traducirSeguridad(fallo) {
  const nombre = fallo && fallo.name ? String(fallo.name) : '';
  if (nombre === 'SecurityError' || nombre === 'NS_ERROR_NOT_AVAILABLE') {
    return faltaCors(mensajeDe(fallo));
  }
  return new ErrorDeCara(
    'El navegador no ha podido convertir la imagen reducida a JPEG. Suele ser falta de memoria en ' +
      'el teléfono: cierra pestañas y vuelve a intentarlo.',
    { detalle: mensajeDe(fallo), reintentable: true, http: 500 }
  );
}

/**
 * Lo que se bajó no era una imagen. Casi siempre es que la URL firmada ha
 * caducado y lo que ha llegado es la queja del bucket en XML, con un 200 por
 * delante en algunas configuraciones.
 * @param {Blob} original
 * @param {string|null} detalle
 * @returns {ErrorDeCara}
 */
function noSeEntiende(original, detalle) {
  const tipo = original && original.type ? String(original.type) : 'sin tipo';
  const cuantos = original && Number.isFinite(Number(original.size)) ? Number(original.size) : 0;
  return new ErrorDeCara(
    'Lo que se ha bajado del bucket no es una imagen que el navegador sepa abrir. Si el enlace lleva ' +
      'rato en pantalla, lo más probable es que haya caducado —duran seis horas— y lo que ha llegado ' +
      'sea la queja del bucket en vez del archivo: vuelve a entrar en la pantalla para pedir enlaces ' +
      'nuevos. Si acaba de generarse, vuelve a generar la imagen.',
    { detalle: `${tipo}, ${cuantos} bytes${detalle ? `: ${detalle}` : ''}`, reintentable: false, http: 0 }
  );
}

/** Lo que dijo un fallo del navegador, literal, para el detalle. */
function mensajeDe(fallo) {
  if (!fallo) return null;
  if (typeof fallo === 'string') return fallo;
  if (fallo.message) return String(fallo.message);
  return String(fallo);
}
