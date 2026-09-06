// El montador de «La mirada que el mundo temerá».
//
// Un Job de Cloud Run con ffmpeg dentro. Recibe la RUTA de un manifiesto en la
// variable MANIFIESTO y todo lo demás sale de ahí.
//
// Tres ideas gobiernan este archivo entero, y las tres están escritas en la
// forma del código y no en un aviso:
//
//   1. NO CONOCE NINGÚN ARCHIVO POR SU NOMBRE. Aquí no hay ni un nombre de clip,
//      ni de pista, ni de salida, ni el del bucket, ni el del proyecto. Todo
//      llega como datos: el manifiesto (docs/contrato.md §7) y tres variables de
//      entorno. El motivo real es que el montador se despliega A MANO y por
//      tanto siempre va por detrás del repositorio: si añadir un material nuevo
//      obligara a redesplegar el contenedor, el diseño estaría mal.
//
//   2. UN CÓDIGO DE SALIDA NO ES UN MENSAJE DE ERROR. El usuario trabaja desde
//      un teléfono y no lee los registros de la nube. Así que TODA queja se
//      escribe con palabras, en español, en «montaje/{trabajo}/queja.txt» DENTRO
//      DEL BUCKET y ANTES de salir con error, con las últimas líneas de ffmpeg
//      pegadas debajo. Eso incluye las excepciones que nadie ha previsto y las
//      señales: si a este proceso lo matan, deja dicho que lo mataron.
//
//   3. SE AUTENTICA CON EL SERVIDOR DE METADATOS, no con una clave. Dentro de
//      Cloud Run, `metadata.google.internal` entrega un token de la cuenta con
//      la que se ejecuta el job. Aquí no hay ninguna credencial escrita ni
//      montada: si a esa cuenta le falta permiso sobre el bucket, el montaje
//      falla al escribir el resultado y la queja lo dice con esas palabras,
//      porque es la trampa que más caro sale (docs/parche-despliegue.md §6).
//
// Node 20+, ESM, cero dependencias de npm: solo built-ins y `fetch` global.

import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import zlib from 'node:zlib';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { timingSafeEqual } from 'node:crypto';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Constantes. Ninguna identifica una cuenta: son técnica, no configuración.
// ---------------------------------------------------------------------------

// El servidor de metadatos de Google. Es una dirección fija de dentro de la
// máquina, igual para todo el mundo; no dice de quién es el proyecto.
const METADATOS = 'http://metadata.google.internal/computeMetadata/v1';

// El host de Cloud Storage. Tampoco identifica ninguna cuenta: es la puerta.
const ALMACEN = 'https://storage.googleapis.com';

// Dónde vive el montaje dentro del bucket (docs/contrato.md §11). Son rutas
// LÓGICAS: el bucket y el prefijo del proyecto se los pone `aFisica()`.
const CARPETA = 'montaje';

// Las capas de docs/contrato.md §7.
const CAPAS = ['escena', 'acto', 'episodio', 'pieza'];

// Las pistas que sabe mezclar. «musica» y «ambiente» se agachan bajo la voz.
const PISTAS = ['musica', 'voz', 'ambiente'];

// Margen para comparar segundos. Un fotograma a 24 fps dura 0,0417 s: por
// debajo de eso lo que hay no es un hueco, es el redondeo de un número escrito
// con dos decimales.
const MARGEN_S = 0.05;

// Todo el audio se remuestrea AQUÍ antes de mezclar. El TTS viene a 24 kHz y
// Lyria a otro muestreo: mezclarlos sin igualarlos primero da un desastre de
// tono y de velocidad. Es una de las trampas ya pagadas del plan.
const MUESTREO = 48000;

// Cuánto se agachan la música y el ambiente bajo una línea de voz, y con qué
// suavidad. Ver `envolventeDeAgache()` para por qué es una envolvente y no un
// compresor de cadena lateral.
const AGACHE_DB = -9;
const ANTICIPO_S = 0.15;   // empieza a bajar ANTES de la primera sílaba
const COLA_S = 0.25;       // y tarda en volver después de la última
const RAMPA_BAJADA_S = 0.25;
const RAMPA_SUBIDA_S = 0.45;

// Los tramos de «silencios» bajan TODO a cero. La rampa es de tres centésimas:
// lo justo para que el corte no chasque y no lo bastante para oírse.
const RAMPA_SILENCIO_S = 0.03;

// El segundo actual dentro de una expresión de `volume`. No se escribe «t» a
// secas porque el filtro evalúa la expresión UNA VEZ al configurarse, cuando
// todavía no hay tiempo, y con «t» valiendo NaN suelta un aviso que parece un
// error de verdad y acaba pegado en la queja asustando a quien la lea.
const AHORA = 'if(isnan(t),0,t)';

// La normalización final. `loudnorm` iguala volumen y brillo entre bloques de
// voz grabados en llamadas distintas, que es buena parte de lo que el oído lee
// como «otra persona». En modo lineal aplica una ganancia constante: no toca el
// timbre, que es justo lo que se quiere.
const LOUDNORM_I = -16;
const LOUDNORM_TP = -1.5;
const LOUDNORM_LRA = 11;

// Por debajo de esto lo medido es silencio y normalizarlo solo amplificaría el
// ruido de fondo hasta convertirlo en el protagonista.
const SILENCIO_LUFS = -60;

// Calidad. El intermedio de cada plano se vuelve a codificar una vez para el
// montaje final, así que va más holgado que la salida.
const CRF_INTERMEDIO = 14;
const CRF_SALIDA = 18;
const PRESET_INTERMEDIO = 'veryfast';
const PRESET_SALIDA = 'medium';
const BITS_AUDIO = '192k';

// Una base de tiempo común en todos los MP4 que salen de aquí. El demuxer
// «concat» pega archivos sin recodificar y para eso tienen que ser iguales:
// esta línea es la que hace que un episodio se pueda montar copiando.
const ESCALA_DE_TIEMPO = '90000';

// Cuántas líneas de ffmpeg se guardan para pegarlas en la queja. Con las
// últimas cuarenta se ve siempre qué archivo o qué filtro se atragantó.
const LINEAS_GUARDADAS = 80;
const LINEAS_EN_LA_QUEJA = 40;

// Subir por trozos, que es lo que permite reintentar sin volver a empezar. El
// trozo tiene que ser múltiplo de 256 KiB: lo pide Google.
const TROZO_SUBIDA = 16 * 1024 * 1024;

// Reintentos de red. Un 4xx NO se reintenta nunca: no va a cambiar.
const INTENTOS_RED = 4;
const ESPERA_BASE_MS = 1500;

// Límite propio de cada petición. Sin él, una llamada que se queda colgada se
// come la hora entera que tiene concedida el trabajo y el montaje muere de
// tiempo sin que nadie sepa por qué. Descargar dos gigas puede tardar, así que
// ese límite es holgado; pedir un token, no.
const LIMITE_TOKEN_MS = 10_000;
const LIMITE_DESCARGA_MS = 30 * 60_000;
const LIMITE_TROZO_MS = 5 * 60_000;
const LIMITE_CORTO_MS = 30_000;

// Hiragana, katakana, kanji y katakana de media anchura. Último cerrojo de un
// invariante de la serie: en pantalla no hay ni una palabra en japonés. El
// japonés únicamente se oye. Lo que se quema en la imagen ya no se quita.
const JAPONES = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9d]/;

// ---------------------------------------------------------------------------
// Lo que se sabe en cada momento, para poder quejarse con precisión
// ---------------------------------------------------------------------------

const enCurso = {
  bucket: '',
  prefijo: '',
  trabajo: '',
  paso: 'arrancar',
  ffmpeg: [],          // las últimas líneas de la última llamada a ffmpeg
  hijo: null,          // el ffmpeg que corre ahora, para poder matarlo
  yaSeSalio: false,
};

// ---------------------------------------------------------------------------
// El error que se enseña
// ---------------------------------------------------------------------------

/**
 * Un fallo con una frase en español dentro. Es lo único que el usuario va a
 * leer, así que la frase dice qué ha pasado y, cuando se puede, qué hacer.
 */
class ErrorDeCara extends Error {
  constructor(mensaje, { detalle = null } = {}) {
    super(mensaje);
    this.name = 'ErrorDeCara';
    this.mensaje = mensaje;
    this.detalle = detalle;
  }
}

// ---------------------------------------------------------------------------
// El entorno
// ---------------------------------------------------------------------------

/**
 * Las variables que recibe el montador. No hay ninguna más y ninguna se escribe
 * en el código.
 *
 * @returns {{manifiesto:string, bucket:string, prefijo:string, clave:string,
 *            claveEsperada:string, directorio:string}}
 */
function entorno() {
  const manifiesto = texto(process.env.MANIFIESTO);
  const bucket = texto(process.env.GCS_BUCKET);
  const prefijo = texto(process.env.GCS_PREFIX).replace(/^\/+|\/+$/g, '');

  if (!bucket) {
    throw new ErrorDeCara(
      'El montador no sabe en qué bucket trabajar: le falta la variable GCS_BUCKET. La pone quien ' +
        'le encarga el montaje, así que esto no es un fallo de tu cuenta sino del propio estudio. Si ' +
        'has lanzado el job a mano desde Cloud Shell, hay que pasarle GCS_BUCKET, GCS_PREFIX y ' +
        'MANIFIESTO.',
    );
  }
  if (!manifiesto) {
    throw new ErrorDeCara(
      'El montador no sabe qué tiene que montar: le falta la variable MANIFIESTO, que es la ruta de ' +
        'la hoja de montaje dentro del bucket. Es lo único que se le pasa además del bucket, porque ' +
        'no conoce ningún archivo por su nombre.',
    );
  }
  if (!esRutaLogica(manifiesto)) {
    throw new ErrorDeCara(
      `La variable MANIFIESTO trae «${manifiesto}», y eso no es una ruta dentro del proyecto. Tiene ` +
        'que ser una ruta lógica como «montaje/teaser-3/manifiesto.json»: sin «gs://», sin ' +
        '«https://» y sin barra al principio, porque el bucket y la carpeta se los pone el montador.',
    );
  }

  return {
    manifiesto,
    bucket,
    prefijo,
    clave: texto(process.env.MONTAJE_KEY),
    // FALTA EN EL CONTRATO: la enmienda §13.4 dice que MONTAJE_KEY «viaja al
    // contenedor y el montador la comprueba antes de trabajar», pero no dice
    // contra qué la compara. No puede ser contra MONTAJE_KEY: esa la manda quien
    // llama y pisaría a la de la imagen. Así que la copia buena, la que el
    // instalador deja grabada en el job al desplegarlo, se llama MONTAJE_CLAVE.
    // Si no está, no hay pestillo y se monta igual (como CLAVE_ACCESO en la
    // puerta). Conviene apuntarlo en el contrato.
    claveEsperada: texto(process.env.MONTAJE_CLAVE),
    // Dónde se descarga y se trabaja. Por defecto /tmp, que en Cloud Run vive en
    // la memoria: por eso un episodio entero pide más memoria o un volumen
    // montado. Se puede cambiar sin tocar código, que es de lo que se trata.
    directorio: texto(process.env.DIRECTORIO_TRABAJO) || '/tmp/montaje',
  };
}

/**
 * El pestillo entre el endpoint y el montador. Se compara sin filtrar el tiempo
 * de respuesta, que es gratis y evita la única forma tonta de adivinarla.
 */
function comprobarLaClave(ent) {
  if (!ent.claveEsperada) {
    console.log(
      'Aviso: este montador no tiene clave propia (MONTAJE_CLAVE), así que monta lo que le manden. ' +
        'Es lo mismo que dejar la puerta abierta y no rompe nada, pero el instalador la pone.',
    );
    return;
  }
  const dada = Buffer.from(ent.clave, 'utf8');
  const buena = Buffer.from(ent.claveEsperada, 'utf8');
  const igual = dada.length === buena.length && timingSafeEqual(dada, buena);
  if (!igual) {
    throw new ErrorDeCara(
      'Este montaje no se ha hecho porque el encargo no traía la clave del montador, o traía otra. ' +
        'La clave la genera el instalador y tiene que estar puesta en dos sitios con el mismo valor: ' +
        'en Vercel, como MONTAJE_KEY, y en el propio job de Cloud Run. Si acabas de cambiarla, ' +
        'recuerda que Vercel no aplica una variable nueva a un despliegue ya construido: hay que ir a ' +
        'Deployments, los tres puntos del último, Redeploy.',
    );
  }
}

// ---------------------------------------------------------------------------
// El token, del servidor de metadatos
// ---------------------------------------------------------------------------

let tokenGuardado = { valor: '', caduca: 0 };

/**
 * El token de la cuenta con la que se ejecuta el job. No hay clave privada por
 * ninguna parte: se le pide a la máquina.
 */
async function token() {
  const ahora = Date.now();
  if (tokenGuardado.valor && ahora < tokenGuardado.caduca) return tokenGuardado.valor;

  const url = `${METADATOS}/instance/service-accounts/default/token`;
  let ultimo = null;

  for (let intento = 1; intento <= INTENTOS_RED; intento += 1) {
    let respuesta;
    try {
      respuesta = await fetch(url, {
        headers: { 'Metadata-Flavor': 'Google' },
        signal: AbortSignal.timeout(LIMITE_TOKEN_MS),
      });
    } catch (error) {
      // Al arrancar el contenedor, el servidor de metadatos tarda a veces un
      // instante en contestar. Eso sí se reintenta.
      ultimo = error;
      await dormir(ESPERA_BASE_MS * intento);
      continue;
    }

    const cuerpo = await respuesta.text();

    if (respuesta.ok) {
      let json;
      try {
        json = JSON.parse(cuerpo);
      } catch {
        throw new ErrorDeCara(
          'La máquina donde corre el montador ha contestado algo que no es un token al pedirle la ' +
            'credencial de su cuenta. Sin credencial no puede ni leer el material ni guardar el ' +
            'resultado.',
          { detalle: recorte(cuerpo, 400) },
        );
      }
      const valor = texto(json.access_token);
      if (!valor) {
        throw new ErrorDeCara(
          'La máquina donde corre el montador ha contestado sin token al pedirle la credencial de su ' +
            'cuenta, así que no puede tocar el bucket.',
          { detalle: recorte(cuerpo, 400) },
        );
      }
      const dura = Number(json.expires_in);
      // Se guarda con un minuto de margen: pedir uno nuevo es barato y quedarse
      // sin él a mitad de una subida de dos gigas, carísimo.
      tokenGuardado = {
        valor,
        caduca: ahora + (Number.isFinite(dura) && dura > 60 ? (dura - 60) * 1000 : 300_000),
      };
      return valor;
    }

    if (respuesta.status === 404) {
      throw new ErrorDeCara(
        'La máquina donde corre el montador dice que no tiene ninguna cuenta de servicio asociada, ' +
          'así que no puede ni leer el material ni escribir el resultado. El job de Cloud Run tiene ' +
          'que desplegarse con una cuenta de servicio; el instalador usa la cuenta de compute del ' +
          'proyecto, la que acaba en «-compute@developer.gserviceaccount.com».',
        { detalle: recorte(cuerpo, 400) },
      );
    }
    if (respuesta.status < 500 && respuesta.status !== 429 && respuesta.status !== 408) {
      throw new ErrorDeCara(
        'La máquina donde corre el montador no ha querido dar la credencial de su cuenta, así que no ' +
          'se puede tocar el bucket. Debajo está lo que ha contestado, tal cual.',
        { detalle: recorte(cuerpo, 400) },
      );
    }

    ultimo = new Error(`HTTP ${respuesta.status}`);
    await dormir(ESPERA_BASE_MS * intento);
  }

  throw new ErrorDeCara(
    'No se ha podido conseguir la credencial de la cuenta con la que corre el montador después de ' +
      'varios intentos, así que no hay manera de leer el material ni de guardar el resultado.',
    { detalle: ultimo ? String(ultimo.message || ultimo) : null },
  );
}

// ---------------------------------------------------------------------------
// El bucket
// ---------------------------------------------------------------------------

/** Ruta lógica → nombre del objeto real, con el prefijo del proyecto delante. */
function aFisica(ruta, ent) {
  const limpia = String(ruta).replace(/^\/+/, '');
  return ent.prefijo ? `${ent.prefijo}/${limpia}` : limpia;
}

/**
 * Descarga un objeto del bucket a un archivo, en flujo: un clip de ocho
 * segundos son treinta y cinco megas y un episodio, dos gigas. Nada de eso se
 * carga entero en memoria.
 *
 * @returns {Promise<number>} bytes escritos.
 */
async function descargar(ruta, destino, ent) {
  const objeto = encodeURIComponent(aFisica(ruta, ent));
  const url = `${ALMACEN}/storage/v1/b/${encodeURIComponent(ent.bucket)}/o/${objeto}?alt=media`;

  // La credencial se pide fuera del bucle a propósito: si no se puede tener, eso
  // no se arregla insistiendo cuatro veces y su explicación es mejor que la de
  // «no se ha podido descargar».
  const credencial = await token();

  let ultimo = null;

  for (let intento = 1; intento <= INTENTOS_RED; intento += 1) {
    let respuesta;
    try {
      respuesta = await fetch(url, {
        headers: { Authorization: `Bearer ${credencial}` },
        signal: AbortSignal.timeout(LIMITE_DESCARGA_MS),
      });
    } catch (error) {
      ultimo = error;
      await dormir(ESPERA_BASE_MS * intento);
      continue;
    }

    if (respuesta.ok && respuesta.body) {
      await mkdir(path.dirname(destino), { recursive: true });
      try {
        await pipeline(Readable.fromWeb(respuesta.body), createWriteStream(destino));
      } catch (error) {
        // Un corte a mitad de descarga sí se reintenta: el archivo se vuelve a
        // pedir entero desde el principio.
        ultimo = error;
        await dormir(ESPERA_BASE_MS * intento);
        continue;
      }
      const info = await stat(destino);
      if (info.size === 0) {
        throw new ErrorDeCara(
          `El archivo «${ruta}» está en el bucket pero no tiene ni un byte dentro, así que no se ` +
            'puede montar con él. Vuelve a generarlo desde la pantalla que lo hizo y repite el ' +
            'montaje.',
        );
      }
      return info.size;
    }

    const cuerpo = await respuesta.text().catch(() => '');

    if (respuesta.status === 404) {
      throw new ErrorDeCara(
        `Falta un archivo que el montaje necesita: «${ruta}» no está en el bucket. El montador no ` +
          'conoce ningún archivo por su nombre, así que este se lo ha pedido el manifiesto; o se ha ' +
          'borrado, o se generó en otra carpeta. Compruébalo en la pantalla de donde salga ese ' +
          'material y vuelve a montar.',
        { detalle: recorte(cuerpo, 400) },
      );
    }
    if (respuesta.status === 401 || respuesta.status === 403) {
      throw new ErrorDeCara(
        `La cuenta con la que corre el montador no tiene permiso para leer «${ruta}» del bucket. Es ` +
          'una trampa conocida y tiene arreglo de una línea: el montador NO se ejecuta con la cuenta ' +
          'de Vercel, sino con la cuenta de compute del proyecto (la que acaba en ' +
          '«-compute@developer.gserviceaccount.com»), y esa cuenta necesita su propio permiso de ' +
          'administrador de objetos sobre el bucket. El instalador del montador lo hace; si el ' +
          'montador se desplegó a mano, hay que darlo a mano.',
        { detalle: recorte(cuerpo, 400) },
      );
    }
    if (respuesta.status < 500 && respuesta.status !== 429 && respuesta.status !== 408) {
      throw new ErrorDeCara(
        `El bucket no ha dejado leer «${ruta}» y no es cosa de volver a intentarlo. Debajo está lo ` +
          'que ha contestado Google, tal cual.',
        { detalle: recorte(cuerpo, 400) },
      );
    }

    ultimo = new Error(`HTTP ${respuesta.status}: ${recorte(cuerpo, 200)}`);
    await dormir(ESPERA_BASE_MS * intento);
  }

  throw new ErrorDeCara(
    `No se ha podido descargar «${ruta}» del bucket después de varios intentos. Si el problema ` +
      'sigue, vuelve a lanzar el montaje dentro de un rato: lo que ya estaba montado en capas de ' +
      'abajo no se pierde.',
    { detalle: ultimo ? String(ultimo.message || ultimo) : null },
  );
}

/**
 * Escribe un texto corto en el bucket. Es lo que usa la queja, así que va lo más
 * simple que se puede: una sola petición y sin nada que pueda fallar de más.
 */
async function subirTexto(ruta, contenido, ent, tipo = 'text/plain; charset=utf-8') {
  const url = new URL(`${ALMACEN}/upload/storage/v1/b/${encodeURIComponent(ent.bucket)}/o`);
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('name', aFisica(ruta, ent));
  url.searchParams.set('fields', 'name,size');

  const cuerpo = Buffer.from(String(contenido), 'utf8');

  const respuesta = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Type': tipo,
      'Content-Length': String(cuerpo.length),
    },
    body: cuerpo,
    signal: AbortSignal.timeout(LIMITE_CORTO_MS),
  });

  if (!respuesta.ok) {
    const dicho = await respuesta.text().catch(() => '');
    throw new ErrorDeCara(
      `No se ha podido escribir «${ruta}» en el bucket.`,
      { detalle: `HTTP ${respuesta.status}: ${recorte(dicho, 300)}` },
    );
  }
  return cuerpo.length;
}

/**
 * Sube un archivo grande al bucket por trozos (subida reanudable).
 *
 * Por qué reanudable y no de un tirón: el resultado de un episodio pesa uno o
 * dos gigas y se sube al final, cuando ya se ha hecho TODO el trabajo. Que un
 * corte de red a los mil ochocientos megas obligue a volver a montar el episodio
 * entero sería absurdo; así, el trozo que falle se repite solo.
 */
async function subirArchivo(ruta, origen, ent, tipo) {
  const info = await stat(origen);
  const total = info.size;

  const url = new URL(`${ALMACEN}/upload/storage/v1/b/${encodeURIComponent(ent.bucket)}/o`);
  url.searchParams.set('uploadType', 'resumable');
  url.searchParams.set('name', aFisica(ruta, ent));

  const arranque = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await token()}`,
      'Content-Length': '0',
      'X-Upload-Content-Type': tipo,
      'X-Upload-Content-Length': String(total),
    },
    signal: AbortSignal.timeout(LIMITE_CORTO_MS),
  });

  if (!arranque.ok) {
    const dicho = await arranque.text().catch(() => '');
    throw errorAlGuardar(ruta, arranque.status, dicho);
  }

  const sesion = arranque.headers.get('location');
  if (!sesion) {
    throw new ErrorDeCara(
      `El bucket ha aceptado empezar a guardar «${ruta}» pero no ha dicho dónde, así que el montaje ` +
        'está hecho y no hay manera de subirlo. Vuelve a lanzarlo: el trabajo se repite, pero es lo ' +
        'único que se puede hacer.',
    );
  }

  const archivo = await open(origen, 'r');
  try {
    let escrito = 0;
    let fallosSeguidos = 0;

    while (escrito < total) {
      const largo = Math.min(TROZO_SUBIDA, total - escrito);
      const trozo = Buffer.allocUnsafe(largo);
      await archivo.read(trozo, 0, largo, escrito);

      let respuesta;
      try {
        respuesta = await fetch(sesion, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${await token()}`,
            'Content-Length': String(largo),
            'Content-Range': `bytes ${escrito}-${escrito + largo - 1}/${total}`,
          },
          body: trozo,
          signal: AbortSignal.timeout(LIMITE_TROZO_MS),
        });
      } catch (error) {
        fallosSeguidos += 1;
        if (fallosSeguidos >= INTENTOS_RED) {
          throw new ErrorDeCara(
            `El montaje está hecho pero se ha cortado la subida de «${ruta}» al bucket y no se ha ` +
              'podido retomar. Vuelve a lanzarlo.',
            { detalle: String(error.message || error) },
          );
        }
        await dormir(ESPERA_BASE_MS * fallosSeguidos);
        escrito = await cuantoLlevaSubido(sesion, total, escrito);
        continue;
      }

      if (respuesta.status === 200 || respuesta.status === 201) {
        return total;
      }
      if (respuesta.status === 308) {
        fallosSeguidos = 0;
        const rango = respuesta.headers.get('range');
        const hasta = rango ? Number(String(rango).split('-').pop()) : NaN;
        escrito = Number.isFinite(hasta) ? hasta + 1 : escrito + largo;
        console.log(`  subidos ${megas(escrito)} de ${megas(total)}`);
        continue;
      }
      if (respuesta.status >= 500 || respuesta.status === 429) {
        fallosSeguidos += 1;
        if (fallosSeguidos >= INTENTOS_RED) {
          const dicho = await respuesta.text().catch(() => '');
          throw errorAlGuardar(ruta, respuesta.status, dicho);
        }
        await dormir(ESPERA_BASE_MS * fallosSeguidos);
        escrito = await cuantoLlevaSubido(sesion, total, escrito);
        continue;
      }

      const dicho = await respuesta.text().catch(() => '');
      throw errorAlGuardar(ruta, respuesta.status, dicho);
    }

    return total;
  } finally {
    await archivo.close();
  }
}

/** Le pregunta al bucket cuánto ha recibido ya, para no repetir lo subido. */
async function cuantoLlevaSubido(sesion, total, porDefecto) {
  try {
    const respuesta = await fetch(sesion, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${await token()}`,
        'Content-Length': '0',
        'Content-Range': `bytes */${total}`,
      },
      signal: AbortSignal.timeout(LIMITE_CORTO_MS),
    });
    if (respuesta.status === 200 || respuesta.status === 201) return total;
    const rango = respuesta.headers.get('range');
    const hasta = rango ? Number(String(rango).split('-').pop()) : NaN;
    return Number.isFinite(hasta) ? hasta + 1 : porDefecto;
  } catch {
    return porDefecto;
  }
}

/** La queja de no poder guardar, que casi siempre es la misma y tiene arreglo. */
function errorAlGuardar(ruta, http, dicho) {
  if (http === 401 || http === 403) {
    return new ErrorDeCara(
      `El montaje se ha hecho entero y se ha perdido justo al guardarlo: la cuenta con la que corre ` +
        `el montador no tiene permiso para escribir «${ruta}» en el bucket. Es LA trampa cara de ` +
        'este montaje, y el arreglo es una línea: el montador NO se ejecuta con la service account ' +
        'de Vercel, sino con la cuenta de compute del proyecto (la que acaba en ' +
        '«-compute@developer.gserviceaccount.com»), y esa cuenta necesita permiso propio de ' +
        'administrador de objetos sobre el bucket. El instalador del montador se lo da; si el ' +
        'montador se instaló a mano, hay que dárselo a mano y volver a lanzar el montaje.',
      { detalle: recorte(dicho, 400) },
    );
  }
  return new ErrorDeCara(
    `El montaje se ha hecho pero el bucket no lo ha dejado guardar en «${ruta}». Debajo está lo que ` +
      'ha contestado Google, tal cual.',
    { detalle: `HTTP ${http}: ${recorte(dicho, 400)}` },
  );
}

// ---------------------------------------------------------------------------
// El manifiesto (docs/contrato.md §7)
// ---------------------------------------------------------------------------

/** Lee el manifiesto del bucket y lo deja en un objeto. */
async function leerManifiesto(ent) {
  const destino = path.join(ent.directorio, 'manifiesto.json');
  await descargar(ent.manifiesto, destino, ent);
  const crudo = await readFile(destino, 'utf8');
  try {
    return JSON.parse(crudo);
  } catch (error) {
    throw new ErrorDeCara(
      `La hoja de montaje «${ent.manifiesto}» no se entiende: no es un JSON válido, así que no se ` +
        'sabe qué había que montar. La escribe el propio estudio antes de encargar el trabajo, así ' +
        'que esto no es un fallo de tu cuenta.',
      { detalle: String(error.message || error) },
    );
  }
}

// ---------------------------------------------------------------------------
// Empaquetar: un zip con lo que ya existe
// ---------------------------------------------------------------------------

// Cuántos archivos caben en un paquete. No es una limitación técnica: es que un
// paquete de difusión son dos o tres cosas —el vídeo y su ficha—, y cien
// archivos ahí dentro significan que alguien está usando esto para otra cosa.
const MAXIMO_EN_UN_PAQUETE = 20;

// Lo que puede pesar un texto escrito dentro del manifiesto. Una ficha son unos
// cientos de bytes; medio mega ya es que alguien intenta meter un vídeo en
// base64, que es exactamente lo que este camino existe para no hacer.
const MAXIMO_DE_UN_TEXTO = 512 * 1024;

/**
 * Entiende un encargo de empaquetar.
 *
 * @param {object} manifiesto
 * @param {object} ent
 */
function entenderElPaquete(manifiesto, ent) {
  const quejas = [];

  const trabajo = texto(manifiesto.trabajo) || trabajoDeLaRuta(ent.manifiesto);
  if (!esNombreDeTrabajo(trabajo)) {
    quejas.push(
      `«${trabajo || 'vacío'}» no sirve como nombre de trabajo: acaba siendo una carpeta del ` +
        'bucket, así que va sin barras ni espacios.',
    );
  }

  const salida = texto(manifiesto.salida);
  if (!esRutaLogica(salida)) {
    quejas.push(
      `«${salida || 'vacía'}» no sirve como sitio donde dejar el zip. Las rutas del manifiesto son ` +
        'lógicas —«difusion/teaser/teaser.zip»—, sin «gs://», sin «https://» y sin barra al principio.',
    );
  }

  const pedido = manifiesto.empaquetar;
  const lista = pedido && typeof pedido === 'object' && Array.isArray(pedido.archivos)
    ? pedido.archivos
    : null;

  if (!lista) {
    quejas.push(
      'El encargo de empaquetar no trae su lista de archivos («empaquetar.archivos»). Cada uno es ' +
        'un nombre y, o bien la ruta de algo que ya está en el bucket («origen»), o bien el texto ' +
        'que hay que escribir dentro («texto»).',
    );
  }

  const archivos = [];
  const nombresVistos = new Set();

  for (const [i, entrada] of (lista || []).entries()) {
    const cual = nombreDe(entrada, i, (lista || []).length, 'el archivo');

    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
      quejas.push(`No se entiende ${cual}: se esperaba un nombre y de dónde sale su contenido.`);
      continue;
    }

    // El nombre de dentro del zip. Se limpia entero: una barra o un «..» ahí
    // convierten un paquete en algo que escribe fuera de su carpeta al abrirlo.
    const nombre = limpiarNombre(texto(entrada.nombre));
    if (!nombre) {
      quejas.push(
        `${mayuscula(cual)} no dice cómo se va a llamar dentro del zip, o su nombre se queda en ` +
          'nada al quitarle las barras. Un nombre con barras dentro de un zip escribe fuera de su ' +
          'carpeta al abrirlo, y eso no se hace.',
      );
      continue;
    }
    if (nombresVistos.has(nombre.toLowerCase())) {
      quejas.push(
        `Hay dos archivos que se llaman «${nombre}» dentro del zip. Al descomprimirlo uno pisaría ` +
          'al otro y nadie sabría cuál se ha quedado.',
      );
      continue;
    }
    nombresVistos.add(nombre.toLowerCase());

    const origen = texto(entrada.origen);
    const contenido = entrada.texto;

    if (origen && contenido !== undefined) {
      quejas.push(
        `${mayuscula(cual)} dice a la vez de dónde se copia («origen») y qué texto lleva dentro ` +
          '(«texto»). Es una cosa o la otra.',
      );
      continue;
    }

    if (origen) {
      if (!esRutaLogica(origen)) {
        quejas.push(
          `${mayuscula(cual)} sale de «${origen}», y eso no es una ruta lógica del bucket.`,
        );
        continue;
      }
      archivos.push({ nombre, origen });
      continue;
    }

    if (typeof contenido === 'string') {
      const bytes = Buffer.byteLength(contenido, 'utf8');
      if (bytes > MAXIMO_DE_UN_TEXTO) {
        quejas.push(
          `${mayuscula(cual)} trae ${megas(bytes)} de texto escrito dentro del propio manifiesto. ` +
            'Ahí van fichas de unos cientos de bytes; lo que pese se copia desde el bucket con ' +
            '«origen».',
        );
        continue;
      }
      archivos.push({ nombre, texto: contenido });
      continue;
    }

    quejas.push(
      `${mayuscula(cual)} no dice ni de dónde se copia («origen») ni qué texto lleva («texto»).`,
    );
  }

  if (lista && !archivos.length && !quejas.length) {
    quejas.push('El paquete no lleva ni un archivo dentro, así que no hay nada que empaquetar.');
  }

  if (archivos.length > MAXIMO_EN_UN_PAQUETE) {
    quejas.push(
      `El paquete lleva ${archivos.length} archivos y el tope son ${MAXIMO_EN_UN_PAQUETE}. Un ` +
        'paquete de difusión son el vídeo y su ficha; si hacen falta veinte, lo que hace falta es ' +
        'otra cosa.',
    );
  }

  if (quejas.length) {
    throw new ErrorDeCara(
      `La hoja de este paquete no se puede usar tal y como está. ${quejas.length === 1 ? 'Esto es lo ' +
        'que hay que arreglar' : `Hay ${quejas.length} cosas que arreglar`}:`,
      { detalle: quejas.map((q, i) => `${i + 1}. ${q}`).join('\n') },
    );
  }

  return { trabajo, salida, paquete: { archivos }, video: [], previas: [], audio: [] };
}

/**
 * Escribe el zip: baja lo que haya que copiar, mete los textos, y lo sube.
 *
 * SIN COMPRIMIR, y no es pereza. Dentro va un MP4, que ya está comprimido: pasar
 * un archivo de gigabyte y medio por un compresor tarda minutos de máquina y no
 * quita ni un megabyte. El zip aquí no sirve para que ocupe menos, sirve para
 * que el vídeo y su ficha viajen juntos y no haya que acordarse de descargar dos
 * cosas.
 */
async function empaquetar(plan, ent) {
  // El mismo directorio de trabajo que usa el montaje: Cloud Run lo da vacío en
  // cada ejecución y lo tira al terminar.
  const carpeta = path.join(ent.directorio, 'paquete');
  await mkdir(carpeta, { recursive: true });

  try {
    const entradas = [];

    for (const [i, archivo] of plan.paquete.archivos.entries()) {
      const destino = path.join(carpeta, `entrada-${dos(i)}`);

      if (archivo.origen) {
        paso(`traer ${archivo.nombre}`);
        console.log(`Archivo ${i + 1}/${plan.paquete.archivos.length}: ${archivo.nombre}`);
        await descargar(archivo.origen, destino, ent);
      } else {
        await writeFile(destino, archivo.texto, 'utf8');
      }

      const { size } = await stat(destino);
      entradas.push({ nombre: archivo.nombre, ruta: destino, bytes: size });
    }

    const total = entradas.reduce((suma, una) => suma + una.bytes, 0);
    console.log(`Empaquetando ${entradas.length} archivo(s), ${megas(total)} en total.`);

    paso('escribir el zip');
    const zip = path.join(carpeta, 'paquete.zip');
    await escribirZip(entradas, zip);

    const { size } = await stat(zip);
    console.log(`Zip escrito: ${megas(size)}.`);

    paso('subir el zip');
    await subirArchivo(plan.salida, zip, ent, 'application/zip');
  } finally {
    await rm(carpeta, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Un zip con los archivos guardados tal cual (método «store»).
 *
 * Se escribe a mano porque Node no trae ninguno y este proyecto no tiene ni una
 * dependencia de npm. El formato es viejo y sencillo: por cada archivo, una
 * cabecera y sus bytes; al final, un índice con una entrada por archivo y un
 * cierre que dice dónde empieza ese índice.
 *
 * SE LEE CADA ARCHIVO DOS VECES: una para calcular su CRC —que va en la cabecera,
 * ANTES de los datos— y otra para copiarlo. Se puede evitar con el «descriptor
 * de datos», que lo escribe detrás, pero hay descompresores que se atragantan
 * con eso, y aquí el zip lo va a abrir un teléfono. Leer dos veces de disco son
 * segundos; un zip que no abre es un zip inútil.
 *
 * ZIP64 cuando hace falta: por encima de 4 GB los campos de tamaño del formato
 * original no dan más de sí, y un episodio largo puede pasar de ahí.
 *
 * @param {{nombre:string, ruta:string, bytes:number}[]} entradas
 * @param {string} destino
 */
async function escribirZip(entradas, destino) {
  const salida = createWriteStream(destino);
  const escribir = (trozo) =>
    new Promise((cumplir, romper) => {
      salida.write(trozo, (error) => (error ? romper(error) : cumplir()));
    });

  let puesto = 0;
  const indice = [];

  for (const entrada of entradas) {
    const nombre = Buffer.from(entrada.nombre, 'utf8');
    const crc = await crcDelArchivo(entrada.ruta);
    const grande = entrada.bytes >= 0xffffffff;
    const desplazamiento = puesto;

    const extra = grande
      ? (() => {
          const b = Buffer.alloc(20);
          b.writeUInt16LE(0x0001, 0);          // etiqueta zip64
          b.writeUInt16LE(16, 2);              // lo que ocupa lo de detrás
          b.writeBigUInt64LE(BigInt(entrada.bytes), 4);   // sin comprimir
          b.writeBigUInt64LE(BigInt(entrada.bytes), 12);  // comprimido: igual
          return b;
        })()
      : Buffer.alloc(0);

    const cabecera = Buffer.alloc(30);
    cabecera.writeUInt32LE(0x04034b50, 0);
    cabecera.writeUInt16LE(grande ? 45 : 20, 4);  // versión que hace falta
    cabecera.writeUInt16LE(0x0800, 6);            // nombres en UTF-8
    cabecera.writeUInt16LE(0, 8);                 // método: guardar tal cual
    cabecera.writeUInt16LE(0, 10);                // hora
    cabecera.writeUInt16LE(0x0021, 12);           // fecha: 1 de enero de 1980
    cabecera.writeUInt32LE(crc, 14);
    cabecera.writeUInt32LE(grande ? 0xffffffff : entrada.bytes, 18);
    cabecera.writeUInt32LE(grande ? 0xffffffff : entrada.bytes, 22);
    cabecera.writeUInt16LE(nombre.length, 26);
    cabecera.writeUInt16LE(extra.length, 28);

    await escribir(cabecera);
    await escribir(nombre);
    if (extra.length) await escribir(extra);
    puesto += cabecera.length + nombre.length + extra.length;

    await new Promise((cumplir, romper) => {
      const lectura = createReadStream(entrada.ruta);
      lectura.on('error', romper);
      lectura.on('end', cumplir);
      lectura.pipe(salida, { end: false });
    });
    puesto += entrada.bytes;

    indice.push({ nombre, crc, bytes: entrada.bytes, desplazamiento, grande });
  }

  const empiezaElIndice = puesto;

  for (const una of indice) {
    const necesitaZip64 = una.grande || una.desplazamiento >= 0xffffffff;
    const extra = necesitaZip64
      ? (() => {
          const cuantos = (una.grande ? 2 : 0) + (una.desplazamiento >= 0xffffffff ? 1 : 0);
          const b = Buffer.alloc(4 + cuantos * 8);
          b.writeUInt16LE(0x0001, 0);
          b.writeUInt16LE(cuantos * 8, 2);
          let donde = 4;
          if (una.grande) {
            b.writeBigUInt64LE(BigInt(una.bytes), donde); donde += 8;
            b.writeBigUInt64LE(BigInt(una.bytes), donde); donde += 8;
          }
          if (una.desplazamiento >= 0xffffffff) {
            b.writeBigUInt64LE(BigInt(una.desplazamiento), donde);
          }
          return b;
        })()
      : Buffer.alloc(0);

    const fila = Buffer.alloc(46);
    fila.writeUInt32LE(0x02014b50, 0);
    fila.writeUInt16LE(necesitaZip64 ? 45 : 20, 4);   // con qué se hizo
    fila.writeUInt16LE(necesitaZip64 ? 45 : 20, 6);   // qué hace falta para abrirlo
    fila.writeUInt16LE(0x0800, 8);
    fila.writeUInt16LE(0, 10);
    fila.writeUInt16LE(0, 12);
    fila.writeUInt16LE(0x0021, 14);
    fila.writeUInt32LE(una.crc, 16);
    fila.writeUInt32LE(una.grande ? 0xffffffff : una.bytes, 20);
    fila.writeUInt32LE(una.grande ? 0xffffffff : una.bytes, 24);
    fila.writeUInt16LE(una.nombre.length, 28);
    fila.writeUInt16LE(extra.length, 30);
    fila.writeUInt16LE(0, 32);                        // sin comentario
    fila.writeUInt16LE(0, 34);                        // en el primer disco
    fila.writeUInt16LE(0, 36);                        // atributos internos
    fila.writeUInt32LE(0, 38);                        // atributos externos
    fila.writeUInt32LE(una.desplazamiento >= 0xffffffff ? 0xffffffff : una.desplazamiento, 42);

    await escribir(fila);
    await escribir(una.nombre);
    if (extra.length) await escribir(extra);
    puesto += fila.length + una.nombre.length + extra.length;
  }

  const tamanoDelIndice = puesto - empiezaElIndice;
  const hacenFaltaLosGrandes =
    empiezaElIndice >= 0xffffffff || tamanoDelIndice >= 0xffffffff || indice.length >= 0xffff;

  if (hacenFaltaLosGrandes) {
    const donde = puesto;

    const zip64 = Buffer.alloc(56);
    zip64.writeUInt32LE(0x06064b50, 0);
    zip64.writeBigUInt64LE(BigInt(44), 4);      // lo que queda detrás de este campo
    zip64.writeUInt16LE(45, 12);
    zip64.writeUInt16LE(45, 14);
    zip64.writeUInt32LE(0, 16);
    zip64.writeUInt32LE(0, 20);
    zip64.writeBigUInt64LE(BigInt(indice.length), 24);
    zip64.writeBigUInt64LE(BigInt(indice.length), 32);
    zip64.writeBigUInt64LE(BigInt(tamanoDelIndice), 40);
    zip64.writeBigUInt64LE(BigInt(empiezaElIndice), 48);
    await escribir(zip64);

    const localizador = Buffer.alloc(20);
    localizador.writeUInt32LE(0x07064b50, 0);
    localizador.writeUInt32LE(0, 4);
    localizador.writeBigUInt64LE(BigInt(donde), 8);
    localizador.writeUInt32LE(1, 16);
    await escribir(localizador);
  }

  const cierre = Buffer.alloc(22);
  cierre.writeUInt32LE(0x06054b50, 0);
  cierre.writeUInt16LE(0, 4);
  cierre.writeUInt16LE(0, 6);
  cierre.writeUInt16LE(hacenFaltaLosGrandes ? 0xffff : indice.length, 8);
  cierre.writeUInt16LE(hacenFaltaLosGrandes ? 0xffff : indice.length, 10);
  cierre.writeUInt32LE(hacenFaltaLosGrandes ? 0xffffffff : tamanoDelIndice, 12);
  cierre.writeUInt32LE(hacenFaltaLosGrandes ? 0xffffffff : empiezaElIndice, 16);
  cierre.writeUInt16LE(0, 20);
  await escribir(cierre);

  await new Promise((cumplir, romper) => {
    salida.on('error', romper);
    salida.on('finish', cumplir);
    salida.end();
  });
}

/** El CRC-32 de un archivo, leyéndolo a trozos: puede pesar un gigabyte y medio. */
async function crcDelArchivo(ruta) {
  return new Promise((cumplir, romper) => {
    let valor = 0;
    const lectura = createReadStream(ruta);
    lectura.on('error', romper);
    lectura.on('data', (trozo) => { valor = crc32(trozo, valor); });
    lectura.on('end', () => cumplir(valor >>> 0));
  });
}

// La tabla del CRC-32, hecha una vez. Node trae `zlib.crc32` desde la 20.15, y
// se usa cuando está; esto es el respaldo, porque el contenedor se despliega a
// mano y nadie sabe con qué Node exacto se construyó la imagen que hay corriendo.
const TABLA_CRC = (() => {
  const tabla = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tabla[i] = c;
  }
  return tabla;
})();

/** @param {Buffer} datos @param {number} anterior */
function crc32(datos, anterior = 0) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(datos, anterior);
  let c = ~anterior;
  for (let i = 0; i < datos.length; i += 1) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

/**
 * Comprueba el manifiesto y lo deja en tipos con los que se pueda trabajar.
 *
 * Se comprueba aquí otra vez aunque el endpoint ya lo haya comprobado, porque
 * este proceso puede lanzarse a mano desde Cloud Shell y porque un manifiesto
 * mal escrito descubierto a los veinte minutos de máquina es tiempo tirado que
 * se ve venir gratis. Se juntan todas las quejas antes de lanzarlas: quien monta
 * quiere saber de una vez todo lo que hay que arreglar.
 */
function entender(manifiesto, ent) {
  if (!manifiesto || typeof manifiesto !== 'object' || Array.isArray(manifiesto)) {
    throw new ErrorDeCara(
      'La hoja de montaje está vacía o no es lo que se esperaba, así que no hay nada que montar.',
    );
  }

  // UN ENCARGO QUE NO ES UN MONTAJE.
  //
  // Empaquetar no monta nada: coge archivos que ya existen y los mete en un zip
  // con un texto al lado. No tiene capa, ni formato, ni planos, y exigírselos
  // sería pedirle papeles de otra cosa. Se reconoce por traer «empaquetar» y se
  // entiende aparte.
  if (manifiesto.empaquetar !== undefined) return entenderElPaquete(manifiesto, ent);

  const quejas = [];

  const trabajo = texto(manifiesto.trabajo) || trabajoDeLaRuta(ent.manifiesto);
  if (!esNombreDeTrabajo(trabajo)) {
    quejas.push(
      `«${trabajo || 'vacío'}» no sirve como nombre de trabajo: acaba siendo una carpeta del ` +
        'bucket, así que va sin barras ni espacios.',
    );
  }

  const capa = texto(manifiesto.capa);
  if (!CAPAS.includes(capa)) {
    quejas.push(
      `«${capa || 'vacía'}» no es una capa de montaje. Las capas son ${enLista(CAPAS)}: un episodio ` +
        'no cabe en un solo trabajo y se monta por capas, guardando cada una.',
    );
  }

  const salida = texto(manifiesto.salida);
  if (!esRutaLogica(salida)) {
    quejas.push(
      `«${salida || 'vacía'}» no sirve como sitio donde dejar el resultado. Las rutas del manifiesto ` +
        'son lógicas —«montaje/teaser-3.mp4»—, sin «gs://», sin «https://» y sin barra al principio.',
    );
  }

  const formato = manifiesto.formato && typeof manifiesto.formato === 'object'
    ? manifiesto.formato
    : {};
  const ancho = entero(formato.ancho);
  const alto = entero(formato.alto);
  const fps = entero(formato.fps);
  if (!ancho || !alto || !fps) {
    quejas.push(
      'El manifiesto no dice bien a qué tamaño y a cuántos fotogramas por segundo se monta ' +
        '(«formato»). Sale de «formato» en datos/serie.json: 1920 × 1080 a 24 fps.',
    );
  }

  const acabado = manifiesto.acabado && typeof manifiesto.acabado === 'object'
    ? manifiesto.acabado
    : {};
  const cadena = texto(acabado.cadena);
  const conPasoDeDos = new Set(
    (Array.isArray(acabado.paso_de_dos) ? acabado.paso_de_dos : []).map((id) => String(id)),
  );

  const video = [];
  if (Array.isArray(manifiesto.video)) {
    manifiesto.video.forEach((entrada, i) => {
      const cual = nombreDe(entrada, i, manifiesto.video.length, 'el plano');
      if (!entrada || typeof entrada !== 'object') {
        quejas.push(`No se entiende ${cual}.`);
        return;
      }
      const origen = texto(entrada.origen);
      if (!esRutaLogica(origen)) {
        quejas.push(
          `${mayuscula(cual)} no dice de qué archivo sale, o su ruta no es del proyecto ` +
            `(«${origen || 'vacía'}»). El montador no conoce ningún archivo por su nombre: todo lo ` +
            'que usa llega escrito en el manifiesto.',
        );
        return;
      }
      const desde = numero(entrada.desde);
      const hasta = numero(entrada.hasta);
      const en = numero(entrada.en);
      if (desde === null || hasta === null || en === null || hasta <= desde || desde < 0 || en < 0) {
        quejas.push(
          `${mayuscula(cual)} no tiene bien sus tres segundos: «desde» y «hasta», que son el trozo ` +
            'que se coge del archivo, y «en», el segundo del montaje en el que entra.',
        );
        return;
      }
      const id = texto(entrada.id) || `plano-${i + 1}`;
      video.push({
        id,
        origen,
        desde,
        dur: hasta - desde,
        en,
        pasoDeDos: entrada.paso_de_dos === true || conPasoDeDos.has(id),
      });
    });
  }

  const audio = [];
  if (Array.isArray(manifiesto.audio)) {
    manifiesto.audio.forEach((entrada, i) => {
      const cual = nombreDe(entrada, i, manifiesto.audio.length, 'la pista de audio');
      if (!entrada || typeof entrada !== 'object') {
        quejas.push(`No se entiende ${cual}.`);
        return;
      }
      const pista = texto(entrada.pista);
      if (!PISTAS.includes(pista)) {
        quejas.push(
          `${mayuscula(cual)} dice ser de la pista «${pista || 'ninguna'}», y el montador no sabe ` +
            `qué es. Las pistas son ${enLista(PISTAS)}: la música y el ambiente se agachan bajo cada ` +
            'línea de voz, así que hay que saber cuál es cuál.',
        );
        return;
      }
      const origen = texto(entrada.origen);
      if (!esRutaLogica(origen)) {
        quejas.push(`${mayuscula(cual)} no dice de qué archivo sale, o su ruta no es del proyecto.`);
        return;
      }
      const desde = numero(entrada.desde);
      const hasta = numero(entrada.hasta);
      const en = numero(entrada.en);
      if (desde === null || hasta === null || en === null || hasta <= desde || desde < 0 || en < 0) {
        quejas.push(`${mayuscula(cual)} no tiene bien escritos sus tres segundos.`);
        return;
      }
      audio.push({
        pista,
        origen,
        desde,
        hasta,
        dur: hasta - desde,
        en,
        gananciaDb: numero(entrada.ganancia_db) ?? 0,
        agacha: entrada.agacha === true,
        // FALTA EN EL CONTRATO: el manifiesto de §7 no lleva campo para el
        // fundido con el que se unen dos piezas de música seguidas, y
        // datos/serie.json lo pide (2,5 s: más corto suena a tajo). Quien lo
        // escriba en «fundido_s» lo tendrá; quien no, las pistas van pegadas.
        fundido: Math.max(0, numero(entrada.fundido_s) ?? 0),
      });
    });
  }

  const silencios = [];
  if (Array.isArray(manifiesto.silencios)) {
    manifiesto.silencios.forEach((par, i) => {
      const desde = Array.isArray(par) ? numero(par[0]) : null;
      const hasta = Array.isArray(par) ? numero(par[1]) : null;
      if (desde === null || hasta === null || hasta <= desde || desde < 0) {
        quejas.push(`El silencio ${i + 1} de ${manifiesto.silencios.length} no es un par de segundos que valga.`);
        return;
      }
      silencios.push({ desde, hasta });
    });
  }

  const subtitulos = [];
  if (Array.isArray(manifiesto.subtitulos)) {
    manifiesto.subtitulos.forEach((linea, i) => {
      const cual = `el subtítulo ${i + 1} de ${manifiesto.subtitulos.length}`;
      if (!linea || typeof linea !== 'object') {
        quejas.push(`No se entiende ${cual}.`);
        return;
      }
      const desde = numero(linea.desde);
      const hasta = numero(linea.hasta);
      const cuerpo = texto(linea.texto);
      if (!cuerpo) {
        quejas.push(`${mayuscula(cual)} no trae texto.`);
        return;
      }
      if (JAPONES.test(cuerpo)) {
        quejas.push(
          `${mayuscula(cual)} está en japonés («${recorte(cuerpo, 40)}»), y los subtítulos se QUEMAN ` +
            'en la imagen: lo que se queme ya no se quita. En pantalla solo hay español; el japonés ' +
            'únicamente se oye.',
        );
        return;
      }
      if (desde === null || hasta === null || hasta <= desde || desde < 0) {
        quejas.push(`${mayuscula(cual)} no tiene bien sus segundos de entrada y salida.`);
        return;
      }
      subtitulos.push({ desde, hasta, texto: cuerpo });
    });
  }

  let cartela = null;
  if (manifiesto.cartela && typeof manifiesto.cartela === 'object') {
    const en = numero(manifiesto.cartela.en);
    const dur = numero(manifiesto.cartela.dur);
    const cuerpo = texto(manifiesto.cartela.texto);
    if (!cuerpo) {
      quejas.push('La cartela no dice qué texto lleva.');
    } else if (JAPONES.test(cuerpo)) {
      quejas.push(
        `La cartela está en japonés («${recorte(cuerpo, 40)}»), y se quema en la imagen: en pantalla ` +
          'solo hay español.',
      );
    } else if (en === null || en < 0 || dur === null || dur <= 0) {
      quejas.push('La cartela no dice bien en qué segundo entra o cuánto dura.');
    } else {
      cartela = { en, dur, texto: cuerpo, fundido: Math.max(0, numero(manifiesto.cartela.fundido) ?? 0) };
    }
  }

  const previas = [];
  if (Array.isArray(manifiesto.capas_previas)) {
    manifiesto.capas_previas.forEach((ruta, i) => {
      const limpia = texto(ruta);
      if (!esRutaLogica(limpia)) {
        quejas.push(
          `La capa ya montada ${i + 1} de ${manifiesto.capas_previas.length} no es una ruta del ` +
            `proyecto («${limpia || 'vacía'}»).`,
        );
        return;
      }
      previas.push(limpia);
    });
  }

  if (!video.length && !previas.length) {
    quejas.push(
      'No hay nada que montar: el manifiesto no trae ni un solo plano en «video» ni ninguna capa ya ' +
        'montada en «capas_previas».',
    );
  }
  if (video.length && previas.length) {
    quejas.push(
      'El manifiesto trae a la vez planos en «video» y capas ya montadas en «capas_previas», y así ' +
        'no se sabe qué va antes. Una capa «escena» o «pieza» lleva sus planos; una «acto» o ' +
        '«episodio» solo concatena lo ya montado y le pone encima lo que toque.',
    );
  }
  if (video.length && !cadena) {
    quejas.push(
      'Falta la cadena de acabado («acabado.cadena»), que es el paso de dos, la aberración ' +
        'cromática, la halación, el grano y la viñeta. Sin ella el montaje sale con cara de vídeo de ' +
        'inteligencia artificial. Se copia literal de «piezas[…].acabado.cadena_ffmpeg» en ' +
        'datos/serie.json.',
    );
  }
  if (previas.length && (capa === 'escena' || capa === 'pieza')) {
    quejas.push(
      `Esta capa dice ser «${capa}» y sin embargo solo trae capas ya montadas. Las que concatenan ` +
        'son «acto» y «episodio».',
    );
  }

  video.sort((a, b) => a.en - b.en);
  comprobarLaLineaDeTiempo(video, quejas);

  if (salida && [...video, ...audio].some((e) => e.origen === salida)) {
    quejas.push(
      `El resultado se guardaría en «${salida}», que es uno de los archivos que el montaje usa como ` +
        'material. Escribir encima de lo que se está leyendo destroza las dos cosas.',
    );
  }

  if (quejas.length) {
    throw new ErrorDeCara(
      `La hoja de montaje de «${trabajo || 'este trabajo'}» no está bien, así que no se ha montado ` +
        `nada y no se ha gastado tiempo de máquina. ${quejas.length === 1 ? 'Esto es lo que falla' : 'Esto es todo lo que falla'}:\n` +
        quejas.map((q) => `· ${q}`).join('\n'),
    );
  }

  return {
    trabajo,
    capa,
    salida,
    formato: { ancho, alto, fps },
    cadena,
    video,
    audio,
    silencios,
    subtitulos,
    cartela,
    previas,
  };
}

/**
 * La línea de tiempo del vídeo no tiene huecos ni solapes.
 *
 * Es un invariante de la serie y aquí está su último cerrojo, el que mira lo que
 * de verdad se va a montar. Importa porque el vídeo se pega con el demuxer
 * «concat», que no sabe dejar un negro en medio ni superponer dos planos: un
 * hueco desplazaría todo el audio que viene detrás y la voz dejaría de caer
 * donde cae la boca.
 */
function comprobarLaLineaDeTiempo(video, quejas) {
  if (!video.length) return;

  if (video[0].en > MARGEN_S) {
    quejas.push(
      `El montaje empezaría con un hueco de ${segundos(video[0].en)}: el primer plano ` +
        `(${video[0].id}) entra en ${segundos(video[0].en)} y antes no hay nada. El montador corta y ` +
        'pega, no sabe poner un negro que nadie ha pedido.',
    );
  }

  for (let i = 1; i < video.length; i += 1) {
    const anterior = video[i - 1];
    const actual = video[i];
    const fin = anterior.en + anterior.dur;

    if (actual.en < fin - MARGEN_S) {
      quejas.push(
        `Se solapan los planos ${anterior.id} y ${actual.id}: el primero acaba en ${segundos(fin)} y ` +
          `el segundo entra en ${segundos(actual.en)}. Dos planos no pueden estar en pantalla a la vez.`,
      );
    } else if (actual.en > fin + MARGEN_S) {
      quejas.push(
        `Queda un hueco de ${segundos(actual.en - fin)} entre los planos ${anterior.id}, que acaba ` +
          `en ${segundos(fin)}, y ${actual.id}, que entra en ${segundos(actual.en)}.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------

/**
 * Llama a ffmpeg y espera. Guarda las últimas líneas de su salida de error, que
 * es lo que se pega en la queja: sin ellas, «el montaje ha fallado» no le sirve
 * a nadie para arreglar nada.
 *
 * @returns {Promise<string>} todo lo que ffmpeg dijo por la salida de error.
 */
function ffmpeg(argumentos, { que }) {
  return new Promise((resolver, rechazar) => {
    const lineas = [];
    let todo = '';
    let resto = '';

    const hijo = spawn('ffmpeg', argumentos, { stdio: ['ignore', 'ignore', 'pipe'] });
    enCurso.hijo = hijo;
    enCurso.ffmpeg = lineas;

    hijo.stderr.setEncoding('utf8');
    hijo.stderr.on('data', (trozo) => {
      todo += trozo;
      // ffmpeg escribe el progreso con retorno de carro y sin salto de línea:
      // si no se parte también por «\r», el hueco de las últimas líneas se lo
      // come una sola línea kilométrica de estadísticas.
      const partes = (resto + trozo).split(/\r?\n|\r/);
      resto = partes.pop() ?? '';
      for (const linea of partes) {
        const limpia = linea.trim();
        if (!limpia) continue;
        lineas.push(limpia);
        if (lineas.length > LINEAS_GUARDADAS) lineas.shift();
      }
    });

    hijo.on('error', (error) => {
      enCurso.hijo = null;
      rechazar(new ErrorDeCara(
        `No se ha podido ni arrancar ffmpeg para ${que}. En el contenedor del montador ffmpeg tiene ` +
          'que estar instalado; si esta imagen se construyó a mano, se construyó mal.',
        { detalle: String(error.message || error) },
      ));
    });

    hijo.on('close', (codigo, senal) => {
      enCurso.hijo = null;
      if (resto.trim()) lineas.push(resto.trim());
      if (codigo === 0) {
        resolver(todo);
        return;
      }
      rechazar(new ErrorDeCara(
        senal
          ? `ffmpeg se ha parado en seco (${senal}) mientras estaba ${que}. Cuando pasa esto casi ` +
            'siempre es que la máquina se ha quedado sin memoria: un montaje largo pide más memoria ' +
            'que uno corto.'
          : `ffmpeg no ha podido con ${que}. Debajo están sus últimas líneas, tal cual las escribió.`,
        { detalle: colaDeFfmpeg(lineas) },
      ));
    });
  });
}

/**
 * Cuánto dura un archivo, preguntándoselo a ffprobe.
 *
 * Hace falta para las capas ya montadas: lo que duran está DENTRO de esos
 * archivos y no en el manifiesto, y sin saberlo no se puede decir hasta dónde
 * llega el audio de la capa nueva.
 */
function duracionDeArchivo(archivo) {
  return new Promise((resolver, rechazar) => {
    let salida = '';
    let error = '';

    const hijo = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      archivo,
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    hijo.stdout.on('data', (trozo) => { salida += trozo; });
    hijo.stderr.on('data', (trozo) => { error += trozo; });

    hijo.on('error', (fallo) => rechazar(new ErrorDeCara(
      'No se ha podido ni arrancar ffprobe, que es lo que dice cuánto dura cada capa ya montada. ' +
        'Viene con ffmpeg, así que si no está, la imagen del montador se construyó mal.',
      { detalle: String(fallo.message || fallo) },
    )));

    hijo.on('close', () => {
      const dura = Number(String(salida).trim());
      if (Number.isFinite(dura) && dura > 0) {
        resolver(dura);
        return;
      }
      rechazar(new ErrorDeCara(
        `No se ha podido saber cuánto dura «${path.basename(archivo)}». O el archivo está a medias, ` +
          'o no es un vídeo: en cualquier caso, con él no se puede montar la capa de encima. Vuelve ' +
          'a montar la capa de abajo y repite esta.',
        { detalle: recorte(error, 400) || null },
      ));
    });
  });
}

/** Las últimas líneas de ffmpeg, que son las que dicen algo. */
function colaDeFfmpeg(lineas = enCurso.ffmpeg) {
  const utiles = (lineas || []).slice(-LINEAS_EN_LA_QUEJA);
  return utiles.length ? utiles.join('\n') : null;
}

// ---------------------------------------------------------------------------
// El acabado
// ---------------------------------------------------------------------------

/**
 * La cadena de acabado de este plano.
 *
 * El paso de dos (`fps=12,fps=24`) va SOLO en los planos listados, porque los de
 * cámara sobre fondo van a veinticuatro limpios igual que en un anime de verdad.
 * La cadena viene entera del manifiesto —y de datos/serie.json antes que eso— y
 * lo que se hace aquí es QUITARLE el prefijo cuando no toca, en vez de tener la
 * cadena escrita dos veces: escrita dos veces, algún día una de las dos se
 * quedaría vieja y la mitad de los planos tendrían otro grano que la otra mitad.
 */
function cadenaDelPlano(cadena, pasoDeDos) {
  if (pasoDeDos) return cadena;

  let resto = cadena.trim();
  let quitados = 0;
  // El paso de dos son los filtros `fps=` del principio, sean los que sean: así
  // sigue funcionando si algún día se rueda a ocho o a dieciséis.
  while (true) {
    const encontrado = /^fps\s*=\s*[^,;'()]*,\s*/.exec(resto);
    if (!encontrado) break;
    resto = resto.slice(encontrado[0].length);
    quitados += 1;
  }

  if (!quitados) {
    console.log(
      '  aviso: la cadena de acabado no empieza por el paso de dos, así que este plano lleva ' +
        'exactamente la misma cadena que los demás.',
    );
    return cadena;
  }

  return resto;
}

// ---------------------------------------------------------------------------
// Los rótulos: subtítulos quemados y cartela
// ---------------------------------------------------------------------------

/**
 * Escribe el archivo .ass con los subtítulos y la cartela.
 *
 * Por qué ASS y no SRT: el estilo que pide la serie —palo seco, blanco puro, sin
 * caja, sombra suave, centrado abajo, dos líneas como mucho— se dice en un ASS
 * de una vez y para siempre, mientras que con un SRT hay que ir peleándolo con
 * las opciones del filtro. Y sobre todo, la cartela final entra en el MISMO
 * archivo: un rectángulo negro dibujado a pantalla completa y el título encima,
 * los dos con el mismo fundido de entrada. Así se quema todo de una pasada y la
 * cartela sale compuesta aquí, no generada, sin efectos, sin brillo y sin
 * movimiento.
 *
 * Los rótulos se queman DESPUÉS del acabado, sobre la imagen ya terminada: si se
 * quemaran antes, el grano y la viñeta se les comerían los bordes y las letras
 * parecerían parte del vídeo generado en vez de puestas encima.
 */
async function escribirRotulos(plan, destino) {
  const { ancho, alto } = plan.formato;

  // Todo en proporción al alto, para que valga igual a 1080 que a 720.
  const cuerpoSubtitulo = Math.round(alto / 22.5);
  const cuerpoCartela = Math.round(alto / 17);
  const margenVertical = Math.round(alto * 0.055);
  const margenLateral = Math.round(ancho * 0.0625);
  const espaciado = Math.round(alto * 0.013);
  // La sombra: cuánto se difumina y cuánto baja respecto de la letra.
  const difuminado = Math.max(2, Math.round(alto / 240));
  const desplazamiento = Math.max(1, Math.round(alto / 360));

  const cabecera = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${ancho}`,
    `PlayResY: ${alto}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    'YCbCr Matrix: TV.709',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, ' +
      'Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, ' +
      'Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Subtítulo: blanco puro, sin borde, sin caja y sin sombra propia
    // (BorderStyle 1 con Outline 0 y Shadow 0). Centrado abajo (Alignment 2).
    `Style: Subtitulo,DejaVu Sans,${cuerpoSubtitulo},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,` +
      `0,0,0,0,100,100,0,0,1,0,0,2,${margenLateral},${margenLateral},${margenVertical},1`,
    // La sombra del subtítulo va en su propio estilo, negra y a media
    // transparencia, para poder difuminarla sin tocar la letra. Ver abajo.
    `Style: Sombra,DejaVu Sans,${cuerpoSubtitulo},&H60000000,&H60000000,&H60000000,&H60000000,` +
      `0,0,0,0,100,100,0,0,1,0,0,2,${margenLateral},${margenLateral},${margenVertical},1`,
    // Cartela: blanco roto, mayúsculas, muy espaciada y estrecha. Lo de estrecha
    // se hace con ScaleX 88 en vez de con otra fuente: así el contenedor lleva
    // una sola familia y pesa menos, que es lo que interesa en un job que se
    // despliega desde el móvil.
    `Style: Cartela,DejaVu Sans,${cuerpoCartela},&H00F0F5F5,&H00F0F5F5,&H00000000,&H00000000,` +
      `0,0,0,0,88,100,${espaciado},0,1,0,0,5,0,0,0,1`,
    // El fondo negro de la cartela: un rectángulo dibujado, sin borde y sin
    // sombra, anclado arriba a la izquierda para que las coordenadas del dibujo
    // sean las de la pantalla.
    'Style: Fondo,DejaVu Sans,10,&H00000000,&H00000000,&H00000000,&H00000000,' +
      '0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const eventos = [];

  for (const linea of plan.subtitulos) {
    const escrito = enDosLineas(escaparAss(linea.texto));
    const desde = tiempoAss(linea.desde);
    const hasta = tiempoAss(linea.hasta);

    // La sombra es una COPIA de la misma línea, negra, difuminada y un poco más
    // abajo, debajo de la buena. Se hace así y no con la sombra que trae el
    // formato porque la de serie es una copia dura y desplazada, que se ve
    // sucia; y no se difumina la letra misma porque difuminar en ASS difumina
    // también el relleno y el blanco deja de ser puro, que es justo lo que pide
    // la serie. Así: relleno blanco limpio, sombra suave detrás, y sin caja.
    // El margen vertical del evento manda sobre el del estilo: uno menor baja
    // la copia esos píxeles, que es de donde sale el desplazamiento.
    eventos.push(
      `Dialogue: 2,${desde},${hasta},Sombra,,0,0,${Math.max(1, margenVertical - desplazamiento)},,` +
        `{\\blur${difuminado}}${escrito}`,
    );
    eventos.push(`Dialogue: 3,${desde},${hasta},Subtitulo,,0,0,0,,${escrito}`);
  }

  if (plan.cartela) {
    const { en, dur, fundido } = plan.cartela;
    // Fundido de entrada y luego quieta: lo dice datos/serie.json con esas
    // palabras («fundido de 0,5 s y se queda quieto»). Sin fundido de salida a
    // propósito: la pieza acaba en seco, en mitad de la nota.
    const entra = Math.round(Math.max(0, fundido) * 1000);
    const desde = tiempoAss(en);
    const hasta = tiempoAss(en + dur);
    eventos.push(
      `Dialogue: 0,${desde},${hasta},Fondo,,0,0,0,,` +
        `{\\an7\\pos(0,0)\\fad(${entra},0)\\bord0\\shad0\\1c&H000000&\\p1}` +
        `m 0 0 l ${ancho} 0 l ${ancho} ${alto} l 0 ${alto}{\\p0}`,
    );
    eventos.push(
      `Dialogue: 1,${desde},${hasta},Cartela,,0,0,0,,{\\fad(${entra},0)}${escaparAss(plan.cartela.texto)}`,
    );
  }

  const contenido = `${cabecera.concat(eventos).join('\n')}\n`;
  await writeFile(destino, contenido, 'utf8');
  return contenido;
}

/** El texto de un evento ASS, sin nada que el formato pueda leerse como orden. */
function escaparAss(valor) {
  return String(valor)
    .replace(/\r?\n/g, ' ')
    // Las llaves abren órdenes de estilo dentro del ASS y no hay forma limpia de
    // escaparlas: en un diálogo en español no aparecen nunca, así que se
    // cambian por paréntesis y se sigue.
    .replace(/[{}]/g, (c) => (c === '{' ? '(' : ')'))
    // Y la barra invertida, que dentro de un evento significa «salto de línea»
    // o «espacio duro»: en un subtítulo en español tampoco pinta nada, y si
    // apareciera partiría la línea por donde no toca.
    .replace(/\\/g, '')
    .trim();
}

/**
 * Dos líneas como mucho, partidas por donde menos desequilibre.
 *
 * Se parte aquí y no se deja a libass porque el corte automático puede dejar una
 * línea de nueve caracteres debajo de otra de cuarenta, que se lee peor y se ve
 * peor.
 */
function enDosLineas(valor, maximo = 42) {
  const limpio = valor.replace(/\s+/g, ' ').trim();
  if (limpio.length <= maximo) return limpio;

  const palabras = limpio.split(' ');
  if (palabras.length < 2) return limpio;

  const mitad = limpio.length / 2;
  let mejorCorte = 1;
  let mejorDistancia = Infinity;
  let largo = 0;

  for (let i = 0; i < palabras.length - 1; i += 1) {
    largo += palabras[i].length + (i ? 1 : 0);
    const distancia = Math.abs(largo - mitad);
    if (distancia < mejorDistancia) {
      mejorDistancia = distancia;
      mejorCorte = i + 1;
    }
  }

  return `${palabras.slice(0, mejorCorte).join(' ')}\\N${palabras.slice(mejorCorte).join(' ')}`;
}

/** «0:01:24.50» a partir de segundos. */
function tiempoAss(s) {
  const centesimas = Math.max(0, Math.round(Number(s) * 100));
  const cs = centesimas % 100;
  const totalSegundos = (centesimas - cs) / 100;
  const seg = totalSegundos % 60;
  const totalMinutos = (totalSegundos - seg) / 60;
  const min = totalMinutos % 60;
  const horas = (totalMinutos - min) / 60;
  return `${horas}:${dos(min)}:${dos(seg)}.${dos(cs)}`;
}

function dos(n) {
  return String(n).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// El audio
// ---------------------------------------------------------------------------

/**
 * El grafo de audio entero, en texto, listo para `-filter_complex_script`.
 *
 * Qué hace, en este orden y por estas razones:
 *
 *   1. Cada pista se recorta por «desde»/«hasta», se REMUESTREA A 48 kHz y se
 *      pasa a estéreo. Esto primero y sin excepción: el TTS viene a 24 kHz y
 *      Lyria a otro muestreo, y mezclar dos cosas a distinta velocidad de
 *      muestreo sin igualarlas antes es una de las trampas ya pagadas.
 *   2. Se le aplica su ganancia y, si la trae, su fundido.
 *   3. Se retrasa hasta su segundo con `adelay`, en milisegundos. A partir de
 *      aquí el tiempo del filtro ya es el tiempo del montaje, que es lo que
 *      permite que las envolventes se escriban con los segundos del manifiesto.
 *   4. Las pistas que se agachan pasan por su envolvente.
 *   5. Todo se suma con `amix` sin normalizar (normalizar aquí bajaría el
 *      volumen según cuántas pistas haya, que no es lo que nadie ha pedido).
 *   6. Los tramos de «silencios» bajan la suma a cero.
 *   7. `loudnorm` al final.
 *
 * @returns {{grafo:string[], etiqueta:string}}
 */
function grafoDeAudio(plan, { conBase, medida, baseCapas }) {
  const grafo = [];
  const pistas = [];

  // LA BASE NO SALE DEL CONCAT, y esto costó medirlo.
  //
  // El demuxer «concat» ignora la lista de edición de cada MP4, así que el
  // relleno que el codificador AAC mete al final de cada capa —invisible dentro
  // del archivo suelto— reaparece y SE ACUMULA: 32 ms por capa. La imagen sale
  // exacta y la voz se va retrasando. Con las 24 escenas de un episodio son
  // 0,74 s, y como los subtítulos van quemados en la imagen, se quedan con ella
  // mientras la voz se aleja de la boca.
  //
  // Medido: seis capas de 4,000 s exactos daban pitidos en 0,021 · 4,053 ·
  // 8,085 · 12,117 · 16,149 · 20,181 en vez de 0 · 4 · 8 · 12 · 16 · 20.
  //
  // Así que el vídeo sí sale del concat —ahí no hay deriva, y copiarlo es lo que
  // hace que montar un episodio sean segundos— pero el audio se reconstruye
  // capa a capa, cada una con su `adelay` en su segundo real medido.
  const capas = conBase ? (baseCapas || []) : [];
  capas.forEach((capa, i) => {
    const filtros = [
      `aresample=${MUESTREO}`,
      `aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=${MUESTREO}`,
    ];
    if (capa.en > 0) filtros.push(`adelay=${Math.round(capa.en * 1000)}:all=1`);
    grafo.push(`[${capa.entrada}:a]${filtros.join(',')}[base${i}]`);
    pistas.push(`[base${i}]`);
  });

  const tramosDeVoz = plan.audio
    .filter((una) => una.pista === 'voz')
    .map((una) => ({ desde: una.en, hasta: una.en + una.dur }));

  const agache = envolventeDeAgache(tramosDeVoz);

  if (!agache && plan.audio.some((una) => una.agacha)) {
    // Pasa —y solo pasa— en las capas «acto» y «episodio»: ahí las voces ya
    // están dentro de lo que se concatena y el manifiesto no dice dónde caen,
    // así que no hay de dónde sacar la envolvente. La música suena al nivel que
    // pide su «ganancia_db», que para esa capa se elige sabiéndolo.
    console.log(
      '  la música no se agacha en esta capa: el manifiesto no trae ninguna línea de voz de la que ' +
        'sacar dónde bajarla. Suena a la ganancia que pide el manifiesto.',
    );
  }

  plan.audio.forEach((una, i) => {
    // La entrada 0 es siempre el vídeo (los planos pegados o las capas ya
    // montadas). Detrás van las capas previas, que entran otra vez solo por su
    // audio, y solo después las pistas de este manifiesto.
    const entrada = `${1 + capas.length + i}:a`;
    const filtros = [
      `atrim=start=${num(una.desde)}:end=${num(una.hasta)}`,
      `asetpts=N/SR/TB`,
      `aresample=${MUESTREO}`,
      `aformat=sample_fmts=fltp:channel_layouts=stereo:sample_rates=${MUESTREO}`,
    ];

    if (una.fundido > 0) {
      // Dos piezas de música seguidas se pegan a tope y el corte se oye como un
      // tajo. Con el fundido de entrada de una y el de salida de la anterior,
      // la juntura pasa desapercibida.
      const dentro = Math.min(una.fundido, una.dur / 2);
      filtros.push(`afade=t=in:st=0:d=${num(dentro)}`);
      filtros.push(`afade=t=out:st=${num(Math.max(0, una.dur - dentro))}:d=${num(dentro)}`);
    }

    if (una.gananciaDb !== 0) filtros.push(`volume=${num(una.gananciaDb)}dB`);

    if (una.en > 0) {
      const ms = Math.round(una.en * 1000);
      filtros.push(`adelay=${ms}:all=1`);
    }

    if (una.agacha && agache) filtros.push(`volume=volume='${agache}':eval=frame`);

    const etiqueta = `[p${i}]`;
    grafo.push(`[${entrada}]${filtros.join(',')}${etiqueta}`);
    pistas.push(etiqueta);
  });

  let actual;
  if (pistas.length === 1) {
    actual = pistas[0];
  } else {
    actual = '[suma]';
    grafo.push(
      `${pistas.join('')}amix=inputs=${pistas.length}:duration=longest:dropout_transition=0:` +
        `normalize=0${actual}`,
    );
  }

  const silencio = envolventeDeSilencio(plan.silencios);
  if (silencio) {
    grafo.push(`${actual}volume=volume='${silencio}':eval=frame[callado]`);
    actual = '[callado]';
  }

  if (medida) {
    grafo.push(`${actual}${filtroLoudnorm(medida)},aresample=${MUESTREO}[mezcla]`);
    actual = '[mezcla]';
  }

  return { grafo, etiqueta: actual };
}

/**
 * La envolvente con la que la música y el ambiente se agachan bajo la voz.
 *
 * POR QUÉ UNA ENVOLVENTE Y NO `sidechaincompress`, que era la otra opción:
 *
 *   · Aquí se sabe EXACTAMENTE dónde está cada línea de voz —el manifiesto trae
 *     su segundo de entrada y su duración medidos del audio de verdad—, así que
 *     no hace falta deducirlo del nivel de la señal. Un compresor de cadena
 *     lateral tiene que adivinar, y adivina peor: dentro de una frase hay
 *     respiraciones y consonantes sordas en las que el nivel cae, y la música
 *     sube y baja en medio de la línea. Eso es el bombeo, y se oye.
 *   · Un compresor solo puede reaccionar DESPUÉS de que suene la voz, así que la
 *     primera sílaba siempre queda algo tapada. La envolvente empieza a bajar
 *     ANTES —ANTICIPO_S—, que es lo que hace un mezclador a mano.
 *   · El agache no depende del volumen absoluto de la voz. Como cada bloque de
 *     TTS sale con la energía que le da la gana, con cadena lateral la música se
 *     agacharía distinto en cada línea; con envolvente, siempre lo mismo.
 *   · Y hay varias pistas que se agachan (lecho, canto, ambiente). Con
 *     compresores serían varios, cada uno respondiendo a su manera y moviéndose
 *     un poco distinto: la mezcla ondularía. Con la envolvente todas bajan a la
 *     vez y exactamente igual.
 *
 * La forma: 1 fuera, `AGACHE_DB` dentro, con rampas de bajada y de subida. La
 * expresión se evalúa por fotograma de audio con `eval=frame`.
 */
function envolventeDeAgache(tramos) {
  if (!tramos.length) return null;

  // Se juntan primero los tramos que quedan pegados al ensancharlos: si no, la
  // música subiría medio decibelio entre dos frases de la misma réplica y ese
  // sube-y-baja se oye más que el propio agache.
  const anchos = tramos
    .map((t) => ({ desde: t.desde - ANTICIPO_S, hasta: t.hasta + COLA_S }))
    .sort((a, b) => a.desde - b.desde);

  const juntos = [];
  for (const tramo of anchos) {
    const ultimo = juntos[juntos.length - 1];
    if (ultimo && tramo.desde <= ultimo.hasta + RAMPA_BAJADA_S + RAMPA_SUBIDA_S) {
      ultimo.hasta = Math.max(ultimo.hasta, tramo.hasta);
    } else {
      juntos.push({ ...tramo });
    }
  }

  // Cuánto se agacha, en amplitud.
  const factor = 10 ** (AGACHE_DB / 20);

  // Para cada tramo, un trapecio que vale 1 dentro y 0 lejos.
  const trapecios = juntos.map(({ desde, hasta }) =>
    `clip(min((${AHORA}-${num(desde)})/${num(RAMPA_BAJADA_S)}+1,` +
    `(${num(hasta)}-${AHORA})/${num(RAMPA_SUBIDA_S)}+1),0,1)`,
  );

  const cuanto = trapecios.reduce((acumulado, uno) => (acumulado ? `max(${acumulado},${uno})` : uno), '');

  return `1-${num(1 - factor)}*${cuanto}`;
}

/**
 * La envolvente de los silencios: todo a cero en esos tramos.
 *
 * Con una rampa de tres centésimas a cada lado. Un corte a cero seco en mitad de
 * una nota chasca, y ese chasquido se oye más que el silencio que se buscaba.
 */
function envolventeDeSilencio(silencios) {
  if (!silencios.length) return null;

  const trozos = silencios.map(({ desde, hasta }) =>
    `clip(max((${num(desde)}-${AHORA})/${num(RAMPA_SILENCIO_S)},` +
    `(${AHORA}-${num(hasta)})/${num(RAMPA_SILENCIO_S)}),0,1)`,
  );

  return trozos.join('*');
}

/**
 * El filtro `loudnorm`.
 *
 * Con `'analizar'` mide y no toca nada; con lo medido, iguala en lineal; con
 * `'dinamico'` —el respaldo de cuando no se ha podido medir— normaliza sobre la
 * marcha, que respira un poco pero deja la pieza a su volumen.
 */
function filtroLoudnorm(medida) {
  const base = `loudnorm=I=${LOUDNORM_I}:TP=${LOUDNORM_TP}:LRA=${LOUDNORM_LRA}`;
  if (medida === 'analizar') return `${base}:print_format=json`;
  if (!medida || typeof medida !== 'object') return base;
  // Con lo medido y `linear=true`, loudnorm aplica UNA ganancia constante: iguala
  // volumen entre bloques sin tocar el timbre ni la dinámica de dentro de la
  // frase. Sin medir, funciona en modo dinámico y sí respira, que aquí no se
  // quiere.
  return (
    `${base}:measured_I=${num(medida.i)}:measured_TP=${num(medida.tp)}:` +
    `measured_LRA=${num(medida.lra)}:measured_thresh=${num(medida.umbral)}:` +
    `offset=${num(medida.desvio)}:linear=true:print_format=summary`
  );
}

/**
 * La pasada de medida del audio.
 *
 * Cuesta una pasada de más, pero solo del audio (el vídeo ni se decodifica), y a
 * cambio la normalización final es una ganancia constante en vez de un
 * compresor que respira. Si por lo que sea no se puede medir, se sigue con la
 * normalización dinámica y se dice por el registro: quedarse sin montar por no
 * poder afinar el volumen sería mucho peor.
 */
async function medirElVolumen(entradas, plan, carpeta) {
  const { grafo, etiqueta } = grafoDeAudio(plan, {
    conBase: entradas.conBase,
    medida: 'analizar',
    baseCapas: entradas.capasDeAudio || [],
  });
  const guion = path.join(carpeta, 'medida.txt');
  await writeFile(guion, grafo.join(';\n'), 'utf8');

  const argumentos = [
    '-nostdin', '-hide_banner', '-loglevel', 'info', '-nostats', '-y',
    ...entradas.argumentos,
    '-filter_complex_script', guion,
    '-map', etiqueta,
    '-f', 'null', '-',
  ];

  let dicho;
  try {
    dicho = await ffmpeg(argumentos, { que: 'medir el volumen de la mezcla' });
  } catch (error) {
    console.log(`  no se ha podido medir el volumen: ${error.mensaje || error.message}`);
    return null;
  }

  // El resumen de loudnorm es un JSON plano, sin objetos dentro, así que se
  // reconoce por su campo y se lee entero de una vez.
  const encontrados = dicho.match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!encontrados || !encontrados.length) {
    console.log('  loudnorm no ha devuelto la medida; se normaliza en modo dinámico.');
    return null;
  }

  let leido;
  try {
    leido = JSON.parse(encontrados[encontrados.length - 1]);
  } catch {
    return null;
  }

  const medida = {
    i: Number(leido.input_i),
    tp: Number(leido.input_tp),
    lra: Number(leido.input_lra),
    umbral: Number(leido.input_thresh),
    desvio: Number(leido.target_offset),
  };

  if (!Object.values(medida).every((v) => Number.isFinite(v))) {
    console.log('  la medida de loudnorm no es un número; se normaliza en modo dinámico.');
    return null;
  }
  if (medida.i <= SILENCIO_LUFS) {
    console.log('  la mezcla está prácticamente en silencio: no se normaliza, se deja como está.');
    return null;
  }

  console.log(`  medido: ${medida.i} LUFS, pico ${medida.tp} dBTP`);
  return medida;
}

// ---------------------------------------------------------------------------
// El montaje
// ---------------------------------------------------------------------------

async function montar(plan, ent) {
  const carpeta = ent.directorio;
  const material = path.join(carpeta, 'material');
  const intermedios = path.join(carpeta, 'planos');

  await mkdir(material, { recursive: true });
  await mkdir(intermedios, { recursive: true });

  // 1. El vídeo: o se montan los planos uno a uno, o se concatena lo ya montado.
  const pegado = plan.video.length
    ? await montarLosPlanos(plan, ent, { material, intermedios })
    : await traerLasCapasPrevias(plan, ent, material);

  console.log(`La pieza dura ${segundos(pegado.duracion)}.`);

  // 2. El audio: cada pista a su archivo.
  const audios = [];
  if (plan.audio.length) paso('descargar el audio');
  for (const [i, una] of plan.audio.entries()) {
    const destino = path.join(material, `audio-${i}${extension(una.origen)}`);
    console.log(`Audio ${i + 1}/${plan.audio.length}: ${una.pista} · ${una.origen}`);
    await descargar(una.origen, destino, ent);
    audios.push(destino);
  }

  // 3. Los rótulos, si los hay.
  const hayRotulos = plan.subtitulos.length > 0 || Boolean(plan.cartela);
  const rotulos = path.join(carpeta, 'rotulos.ass');
  if (hayRotulos) {
    paso('escribir los subtítulos y la cartela');
    await escribirRotulos(plan, rotulos);
    console.log(
      `Rótulos: ${plan.subtitulos.length} subtítulo(s)${plan.cartela ? ' y la cartela final' : ''}, ` +
        'quemados en español sobre la imagen ya acabada.',
    );
  }

  // 4. La pasada final.
  const salida = path.join(carpeta, `salida${extension(plan.salida) || '.mp4'}`);
  await pasadaFinal(plan, {
    trozos: pegado.trozos,
    offsets: pegado.offsets,
    lista: pegado.lista,
    duracion: pegado.duracion,
    audios,
    rotulos: hayRotulos ? rotulos : null,
    salida,
    carpeta,
  });

  // 5. Se tira el material antes de subir. En Cloud Run el disco es memoria, y
  // en un episodio los planos ya usados y las capas ya pegadas ocupan tanto como
  // el resultado: soltarlos aquí es la diferencia entre subir un episodio y
  // quedarse sin sitio con el trabajo hecho.
  await rm(material, { recursive: true, force: true });
  await rm(intermedios, { recursive: true, force: true });

  // 6. Al bucket.
  paso('guardar el resultado en el bucket');
  const info = await stat(salida);
  console.log(`Subiendo «${plan.salida}» (${megas(info.size)})…`);
  await subirArchivo(plan.salida, salida, ent, tipoDe(plan.salida));

  console.log(`Montado: ${plan.salida} (${megas(info.size)}).`);
}

/**
 * Cada plano por separado: se recorta, se acaba y se deja en un archivo suyo.
 *
 * Por qué uno a uno y no todo en un solo ffmpeg gigante: un episodio son
 * cuatrocientos planos, y cuatrocientas entradas en un mismo grafo es más
 * memoria y más archivos abiertos de los que tiene una máquina de Cloud Run.
 * Además, así se sabe SIEMPRE en qué plano falló, y la queja lo dice por su
 * nombre en vez de dejar al usuario mirando cuatrocientos.
 */
async function montarLosPlanos(plan, ent, { material, intermedios }) {
  const { ancho, alto, fps } = plan.formato;
  const trozos = [];

  for (const [i, plano] of plan.video.entries()) {
    paso(`montar el plano ${plano.id}`);
    console.log(
      `Plano ${i + 1}/${plan.video.length} · ${plano.id} · ${segundos(plano.dur)}` +
        `${plano.pasoDeDos ? ' · paso de dos' : ''}`,
    );

    const bajado = path.join(material, `plano-${i}${extension(plano.origen)}`);
    await descargar(plano.origen, bajado, ent);

    const acabado = cadenaDelPlano(plan.cadena, plano.pasoDeDos);
    const cadena = [
      `scale=${ancho}:${alto}:force_original_aspect_ratio=decrease`,
      `pad=${ancho}:${alto}:(ow-iw)/2:(oh-ih)/2:color=black`,
      'setsar=1',
      `fps=${fps}`,
      // Si Veo devolvió el clip unas centésimas más corto de lo que dice el
      // manifiesto, se congela el último fotograma hasta completar. Sin esto la
      // diferencia se acumula plano a plano y al final de un episodio el audio
      // va medio segundo por delante de la imagen.
      `tpad=stop_mode=clone:stop_duration=${num(plano.dur)}`,
      acabado,
      'format=yuv420p',
    ].join(',');

    const destino = path.join(intermedios, `${dos(i)}-${limpiarNombre(plano.id)}.mp4`);

    await ffmpeg([
      '-nostdin', '-hide_banner', '-loglevel', 'warning', '-nostats', '-y',
      '-ss', num(plano.desde),
      '-t', num(plano.dur),
      '-i', bajado,
      '-an',
      '-vf', cadena,
      '-t', num(plano.dur),
      '-c:v', 'libx264', '-preset', PRESET_INTERMEDIO, '-crf', String(CRF_INTERMEDIO),
      '-pix_fmt', 'yuv420p', '-video_track_timescale', ESCALA_DE_TIEMPO,
      destino,
    ], { que: `montar el plano ${plano.id}` });

    // El material original ya no hace falta y en Cloud Run el disco es memoria:
    // borrarlo ahora es la diferencia entre montar un episodio y quedarse sin
    // sitio a la mitad.
    await rm(bajado, { force: true });

    trozos.push(destino);
  }

  // La pieza dura lo que suman sus planos, y se sabe sin preguntarle a nadie:
  // cada intermedio se ha forzado a durar exactamente lo que pedía el
  // manifiesto.
  const duracion = plan.video.reduce((mayor, uno) => Math.max(mayor, uno.en + uno.dur), 0);

  return { lista: await escribirLaLista(trozos, path.join(intermedios, 'lista.txt')), duracion };
}

/** Las capas ya montadas, que se concatenan tal cual y no se rehacen. */
async function traerLasCapasPrevias(plan, ent, material) {
  const trozos = [];
  const duraciones = [];
  let duracion = 0;

  for (const [i, ruta] of plan.previas.entries()) {
    paso(`traer la capa ya montada ${ruta}`);
    console.log(`Capa ${i + 1}/${plan.previas.length}: ${ruta}`);
    const destino = path.join(material, `capa-${dos(i)}${extension(ruta) || '.mp4'}`);
    const bytes = await descargar(ruta, destino, ent);
    // Lo que dura cada capa está dentro del archivo, no en el manifiesto: hay
    // que preguntárselo para saber hasta dónde llega la pieza.
    const dura = await duracionDeArchivo(destino);
    duraciones.push(dura);
    duracion += dura;
    console.log(`  ${megas(bytes)} · ${segundos(dura)}`);
    trozos.push(destino);
  }

  // Los offsets se calculan sobre las duraciones REALES medidas, no sobre lo que
  // diga el manifiesto: el audio de cada capa se va a volver a colocar aquí, y
  // si el offset no es exacto la voz se separa de la boca.
  let acumulado = 0;
  const offsets = [];
  for (const dura of duraciones) {
    offsets.push(acumulado);
    acumulado += dura;
  }

  return {
    lista: await escribirLaLista(trozos, path.join(material, 'lista.txt')),
    duracion,
    trozos,
    offsets,
  };
}

/** La lista del demuxer «concat». */
async function escribirLaLista(trozos, destino) {
  const lineas = trozos.map((uno) => `file '${uno.replace(/'/g, "'\\''")}'`);
  await writeFile(destino, `${lineas.join('\n')}\n`, 'utf8');
  return destino;
}

/**
 * La pasada final: se pegan los trozos, se queman los rótulos y se mezcla el
 * audio.
 *
 * Con dos atajos que valen mucho tiempo y ninguna calidad:
 *
 *   · Si no hay rótulos que quemar, el vídeo se COPIA. Los planos ya vienen
 *     acabados y del tamaño y los fotogramas de la pieza, así que volver a
 *     codificarlos solo serviría para perder calidad y tiempo. Con esto, montar
 *     un episodio a partir de sus actos son segundos en vez de una hora.
 *   · Si además no hay audio nuevo que mezclar, se copia también el audio y la
 *     pasada entera es una concatenación sin recodificar nada.
 */
async function pasadaFinal(plan, { lista, duracion, audios, rotulos, salida, carpeta, trozos, offsets }) {
  const copiarVideo = !rotulos;
  const conBase = plan.previas.length > 0;   // lo concatenado ya trae su audio
  const hayAudioNuevo = plan.audio.length > 0;

  // Cada capa previa entra DOS veces: una en la lista del concat, que da la
  // imagen, y otra suelta, que da su audio para volver a colocarlo en su
  // segundo exacto. Sin lo segundo, el relleno del codificador AAC se acumula
  // 32 ms por capa y la voz se separa de la boca (ver grafoDeAudio).
  const capasDeAudio = conBase && Array.isArray(trozos)
    ? trozos.map((archivo, i) => ({ archivo, en: (offsets && offsets[i]) || 0, entrada: 1 + i }))
    : [];

  // Copiar entero solo vale cuando NO hay nada que acumular: una sola capa no
  // tiene de qué derivar. Con dos o más hay que rehacer el audio.
  const copiarTodo = copiarVideo && conBase && !hayAudioNuevo && capasDeAudio.length <= 1;

  const entradas = ['-f', 'concat', '-safe', '0', '-i', lista];

  if (copiarTodo) {
    paso('pegar las capas ya montadas');
    console.log('Se concatena sin recodificar: nada que quemar y nada que mezclar.');
    await ffmpeg([
      '-nostdin', '-hide_banner', '-loglevel', 'warning', '-stats', '-stats_period', '30', '-y',
      ...entradas,
      '-c', 'copy',
      '-movflags', '+faststart',
      salida,
    ], { que: 'pegar las capas ya montadas' });
    return;
  }

  for (const capa of capasDeAudio) entradas.push('-i', capa.archivo);
  for (const uno of audios) entradas.push('-i', uno);

  // Sin ninguna pista y sin base, hace falta una de silencio: todo lo que sale
  // de aquí lleva audio, porque si un día una escena no lo llevara, el acto que
  // la concatene no podría pegarse sin recodificar.
  const conSilencio = !hayAudioNuevo && !conBase;
  if (conSilencio) {
    entradas.push('-f', 'lavfi', '-t', num(duracion), '-i', `anullsrc=r=${MUESTREO}:cl=stereo`);
  }

  let medida = null;
  if (hayAudioNuevo || conBase) {
    paso('medir el volumen de la mezcla');
    medida = await medirElVolumen({ argumentos: entradas, conBase, capasDeAudio }, plan, carpeta);
  }

  const grafo = [];
  let etiquetaVideo = null;
  let etiquetaAudio = null;

  if (!copiarVideo) {
    // Los rótulos se queman sobre la imagen ya acabada, la última de todas: el
    // grano y la viñeta no tienen que pasar por encima de las letras.
    grafo.push(`[0:v]subtitles=filename=${escaparFiltro(rotulos)}:fontsdir=/usr/share/fonts[v]`);
    etiquetaVideo = '[v]';
  }

  if (hayAudioNuevo || conBase) {
    const audio = grafoDeAudio(plan, { conBase, medida: medida || 'dinamico', baseCapas: capasDeAudio });
    // El audio se rellena con silencio hasta donde llega la imagen y se corta
    // ahí: una pista que se queda corta no recorta la pieza, y una que se pasa
    // no la alarga. Se hace con `apad` y `atrim` y no con `-shortest` a
    // propósito: `-shortest` sobre una mezcla de filtros hace que ffmpeg termine
    // con un error de «no queda sitio en el disco» que no tiene nada que ver con
    // el disco, y ese error acabaría escrito en la queja despistando a quien la
    // lea.
    grafo.push(...audio.grafo);
    grafo.push(`${audio.etiqueta}apad=whole_dur=${num(duracion)},atrim=end=${num(duracion)}[salida_audio]`);
    etiquetaAudio = '[salida_audio]';
  }

  const argumentos = [
    '-nostdin', '-hide_banner', '-loglevel', 'warning', '-stats', '-stats_period', '30', '-y',
    ...entradas,
  ];

  if (grafo.length) {
    const guion = path.join(carpeta, 'grafo.txt');
    await writeFile(guion, grafo.join(';\n'), 'utf8');
    argumentos.push('-filter_complex_script', guion);
  }

  argumentos.push('-map', etiquetaVideo || '0:v');
  if (etiquetaAudio) {
    argumentos.push('-map', etiquetaAudio);
  } else {
    // La entrada del silencio es la última que se ha añadido.
    argumentos.push('-map', `${capasDeAudio.length + audios.length + 1}:a`);
  }

  if (copiarVideo) {
    argumentos.push('-c:v', 'copy');
  } else {
    argumentos.push(
      '-c:v', 'libx264', '-preset', PRESET_SALIDA, '-crf', String(CRF_SALIDA),
      '-pix_fmt', 'yuv420p', '-r', String(plan.formato.fps),
      '-video_track_timescale', ESCALA_DE_TIEMPO,
    );
  }

  argumentos.push('-c:a', 'aac', '-b:a', BITS_AUDIO, '-ar', String(MUESTREO), '-ac', '2');
  argumentos.push('-t', num(duracion), '-movflags', '+faststart', salida);

  paso('montar la pieza entera');
  console.log(
    `Pasada final: ${copiarVideo ? 'vídeo copiado' : 'vídeo recodificado con los rótulos quemados'}` +
      `, ${hayAudioNuevo || conBase ? 'audio mezclado y normalizado' : 'sin audio que mezclar'}.`,
  );

  await ffmpeg(argumentos, { que: 'montar la pieza entera' });
}

// ---------------------------------------------------------------------------
// La queja
// ---------------------------------------------------------------------------

/**
 * Escribe la queja en el bucket y sale con error.
 *
 * Esto es lo más importante del archivo. El usuario trabaja desde un teléfono y
 * no va a mirar los registros de Cloud Run: si el montaje falla y aquí no se
 * escribe nada, lo único que verá la aplicación es que el trabajo terminó mal,
 * sin una palabra de por qué. Por eso la queja se escribe SIEMPRE y ANTES de
 * salir, y por eso lleva pegadas las últimas líneas de ffmpeg.
 */
async function fallar(error) {
  if (enCurso.yaSeSalio) return;
  enCurso.yaSeSalio = true;

  if (enCurso.hijo) {
    try {
      enCurso.hijo.kill('SIGKILL');
    } catch {
      // Si ya no está, mejor.
    }
  }

  const esDeCara = error instanceof ErrorDeCara;
  const trozos = [];

  trozos.push(
    esDeCara
      ? error.mensaje
      : 'El montaje se ha roto por dentro y no era un fallo previsto. Debajo está todo lo que se ' +
        'sabe; con eso se puede arreglar.',
  );

  trozos.push(`Estaba en: ${enCurso.paso}.`);

  const detalle = esDeCara ? error.detalle : `${error && error.stack ? error.stack : String(error)}`;
  if (detalle) trozos.push(`Lo que se sabe:\n${detalle}`);

  const cola = colaDeFfmpeg();
  if (cola && (!detalle || !String(detalle).includes(cola))) {
    trozos.push(`Últimas líneas de ffmpeg:\n${cola}`);
  }

  trozos.push(`Cuándo: ${new Date().toISOString()}.`);

  const queja = `${trozos.join('\n\n')}\n`;

  // Al registro siempre, aunque el bucket no conteste: es lo único que queda si
  // ni siquiera se puede escribir.
  console.error(`\n----- El montaje ha fallado -----\n${queja}`);

  if (enCurso.bucket && enCurso.trabajo) {
    try {
      const ruta = `${CARPETA}/${enCurso.trabajo}/queja.txt`;
      await subirTexto(ruta, queja, { bucket: enCurso.bucket, prefijo: enCurso.prefijo });
      console.error(`La explicación ha quedado escrita en «${ruta}» del bucket.`);
    } catch (otro) {
      console.error(
        'Y encima no se ha podido escribir la explicación en el bucket, así que la aplicación no la ' +
          `va a poder enseñar: ${otro && otro.message ? otro.message : otro}`,
      );
    }
  } else {
    console.error(
      'No se sabe ni en qué bucket ni de qué trabajo escribir la explicación, así que se queda solo ' +
        'aquí, en el registro.',
    );
  }

  // Se marca el código de salida en vez de cortar el proceso en seco: en Cloud
  // Run la salida de error es una tubería y `process.exit()` puede llevarse por
  // delante lo último que se ha escrito, que es justamente la explicación. El
  // temporizador de respaldo va sin retener el bucle: si no queda nada
  // pendiente, el proceso se acaba solo y antes.
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 2000).unref();
}

/** Deja apuntado en qué se estaba, para que la queja lo pueda decir. */
function paso(que) {
  enCurso.paso = que;
  console.log(`· ${mayuscula(que)}…`);
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

function texto(valor) {
  return String(valor ?? '').trim();
}

function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function entero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** Un número tal como lo entiende ffmpeg: con punto y sin ceros de sobra. */
function num(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n)) return '0';
  return String(Number(n.toFixed(6)));
}

/** «3,5 s». Los segundos se escriben con coma, como en español. */
function segundos(s) {
  const redondeado = Math.round(Number(s) * 1000) / 1000;
  const escrito = Number.isInteger(redondeado)
    ? String(redondeado)
    : String(redondeado).replace('.', ',');
  return `${escrito} s`;
}

/** «1,4 GB», «312 MB». */
function megas(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} kB`;
}

function recorte(valor, maximo) {
  const t = String(valor ?? '');
  return t.length <= maximo ? t : `${t.slice(0, maximo)}…`;
}

function mayuscula(t) {
  return t.length ? t[0].toUpperCase() + t.slice(1) : t;
}

function enLista(valores) {
  if (valores.length === 1) return valores[0];
  return `${valores.slice(0, -1).join(', ')} o ${valores[valores.length - 1]}`;
}

function nombreDe(entrada, i, total, etiqueta) {
  const id = entrada && typeof entrada === 'object' ? texto(entrada.id) : '';
  return id ? `${etiqueta} «${id}»` : `${etiqueta} ${i + 1} de ${total}`;
}

/**
 * Una ruta lógica del proyecto. Ni «gs://», ni «https://», ni barra al
 * principio, ni «..»: el bucket y el prefijo se los pone el montador.
 */
function esRutaLogica(valor) {
  const ruta = texto(valor);
  if (!ruta || ruta.startsWith('/') || ruta.endsWith('/')) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ruta)) return false;
  if (ruta.split('/').includes('..')) return false;
  return true;
}

/** Un nombre de trabajo acaba siendo una carpeta del bucket. */
function esNombreDeTrabajo(valor) {
  const nombre = texto(valor);
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(nombre) && !nombre.includes('..');
}

/**
 * El trabajo, sacado de la ruta del manifiesto.
 *
 * Se saca ANTES de leer el manifiesto, a propósito: si el manifiesto no se puede
 * ni descargar ni entender, hace falta saber igualmente en qué carpeta escribir
 * la queja. Un fallo mudo es peor que cualquier fallo.
 */
function trabajoDeLaRuta(ruta) {
  const partes = texto(ruta).split('/');
  if (partes.length >= 3 && partes[0] === CARPETA && esNombreDeTrabajo(partes[1])) return partes[1];
  return '';
}

function extension(ruta) {
  const nombre = texto(ruta).split('/').pop() || '';
  const punto = nombre.lastIndexOf('.');
  return punto > 0 ? nombre.slice(punto).toLowerCase() : '';
}

function tipoDe(ruta) {
  const ext = extension(ruta);
  if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
  if (ext === '.mov') return 'video/quicktime';
  if (ext === '.mkv') return 'video/x-matroska';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.mp3') return 'audio/mpeg';
  return 'application/octet-stream';
}

/** Un nombre de archivo con el que no se pueda escribir fuera de su carpeta. */
function limpiarNombre(valor) {
  return texto(valor).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'plano';
}

/** Dentro de un grafo de ffmpeg, los dos puntos y las comas separan opciones. */
function escaparFiltro(ruta) {
  return String(ruta).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function dormir(ms) {
  return new Promise((resolver) => { setTimeout(resolver, ms); });
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function principal() {
  paso('leer lo que se le ha encargado');

  const ent = entorno();
  enCurso.bucket = ent.bucket;
  enCurso.prefijo = ent.prefijo;
  // Antes de nada, para poder quejarse en el sitio correcto pase lo que pase.
  enCurso.trabajo = trabajoDeLaRuta(ent.manifiesto);

  comprobarLaClave(ent);

  paso('leer la hoja de montaje');
  const crudo = await leerManifiesto(ent);

  const plan = entender(crudo, ent);
  enCurso.trabajo = plan.trabajo;

  if (plan.paquete) {
    console.log(
      `Paquete «${plan.trabajo}»: ${plan.paquete.archivos.length} archivo(s) → ${plan.salida}.`,
    );
    await empaquetar(plan, ent);
    paso('terminar');
    console.log('Hecho.');
    return;
  }

  const cuenta = [];
  if (plan.video.length) cuenta.push(`${plan.video.length} plano(s)`);
  if (plan.previas.length) cuenta.push(`${plan.previas.length} capa(s) ya montada(s)`);
  if (plan.audio.length) cuenta.push(`${plan.audio.length} pista(s) de audio`);
  if (plan.subtitulos.length) cuenta.push(`${plan.subtitulos.length} subtítulo(s)`);
  if (plan.cartela) cuenta.push('la cartela final');

  console.log(
    `Montaje «${plan.trabajo}», capa ${plan.capa}: ${cuenta.join(', ')} → ${plan.salida} ` +
      `(${plan.formato.ancho}×${plan.formato.alto} a ${plan.formato.fps} fps).`,
  );

  await montar(plan, ent);

  paso('terminar');
  console.log('Hecho.');
}

// Nada de esto puede quedarse sin escribir su queja: ni una excepción que nadie
// esperaba, ni una promesa que se rompió sola, ni que Cloud Run mate el proceso
// porque se acabó el tiempo del trabajo.
process.on('uncaughtException', (error) => { void fallar(error); });
process.on('unhandledRejection', (error) => { void fallar(error); });

for (const senal of ['SIGTERM', 'SIGINT']) {
  process.on(senal, () => {
    void fallar(new ErrorDeCara(
      `A este montaje lo han parado desde fuera (${senal}) antes de que terminara. Cuando pasa solo, ` +
        'casi siempre es que se ha agotado el tiempo que tiene concedido el trabajo de Cloud Run: ' +
        'una pieza larga necesita más tiempo (--task-timeout) y más memoria que una corta. Lo que ya ' +
        'estuviera montado en capas de abajo sigue guardado y no hay que rehacerlo.',
    ));
  });
}

try {
  await principal();
} catch (error) {
  await fallar(error);
}
