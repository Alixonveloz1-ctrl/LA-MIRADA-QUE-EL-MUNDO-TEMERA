// Salud: la pantalla que responde de una vez lo que ningún documento puede
// responder — qué modelos tiene permitidos ESTA cuenta y si el bucket contesta.
//
// Es la primera pantalla que se construyó y la primera que hay que mirar: hasta
// que no está entera en verde no se sigue (docs/parche-despliegue.md §10).
//
// CUATRO REGLAS QUE MANDAN SOBRE TODO ESTE ARCHIVO
//
//   1. NUNCA SALE DE AQUÍ UNA CREDENCIAL. Ni la clave privada, ni el JSON de la
//      service account, ni un token. El correo, el proyecto y el bucket salen
//      enmascarados por `enmascarar()` —tres letras, «…», tres letras—, que es
//      bastante para reconocerlos y nada para copiarlos. El censor de la puerta
//      es el segundo cerrojo, no el primero.
//
//   2. UN FALLO NO TUMBA A LOS DEMÁS. Todo se comprueba a la vez con
//      `Promise.allSettled`, y cada comprobación se guarda su propio fallo con
//      palabras. Una cuenta sin acceso a Veo tiene que poder ver que sí lo tiene
//      a la imagen; si el primer error cortara la lista, habría que arreglarlos
//      de uno en uno y volver a mirar cada vez.
//
//   3. SALUD NO GASTA UNA GENERACIÓN. Ni una imagen, ni un clip, ni un segundo
//      de música. A cada modelo se le manda la petición más barata que demuestra
//      acceso: un cuerpo DELIBERADAMENTE INVÁLIDO. Google resuelve primero quién
//      llama, dónde y a qué modelo, y solo después mira el cuerpo; así:
//        · 400 → el modelo existe, se sirve en esa región y esta cuenta puede
//          llamarlo. Lo único que está mal es el cuerpo, que está mal a
//          propósito. Es un SÍ.
//        · 403 → la cuenta no tiene permiso, o la API no está habilitada.
//        · 404 → el modelo no existe con ese id en esa región. Con los Gemini
//          3.x este 404 parece falta de acceso y no lo es: solo se sirven desde
//          «global», y `errores.js` lo explica en pantalla.
//        · 429 → hay acceso, pero ahora mismo no hay cuota. Cuenta como sí, con
//          su nota al lado: es de las cosas que más se confunden con un permiso.
//      Un 200 sería una sorpresa con un cuerpo así, pero también sería un sí.
//
//   4. EL CORS DEL BUCKET NO SE PUEDE COMPROBAR DESDE EL SERVIDOR. Desde aquí el
//      bucket se lee y se escribe igual con CORS que sin él; quien se estrella
//      sin CORS es el navegador, al leer un master para reducirlo a 1280 px
//      antes de mandarlo a Veo, y el error de consola no menciona CORS por
//      ninguna parte. Así que Salud deja un PNG de un píxel en el bucket y
//      devuelve su URL firmada: el `fetch` lo hace el navegador y decide él.
//
// Aquí no hay ni un id de modelo escrito: todos salen de datos/serie.json a
// través de `entorno()`, y cada uno se enseña con la variable que lo sustituye.

import { Buffer } from 'node:buffer';
import { entorno, enmascarar, estadoDeVariables } from './entorno.js';
import { serie } from './datos.js';
import { ErrorDeCara } from './errores.js';
import { token, AMBITOS } from './auth.js';
import { escribir, leer, firmar } from './gcs.js';
import { llamar, urlModelo } from './vertex.js';
import { listarVoces } from './audio.js';

// Los dos objetos que Salud deja en el bucket. Son ruidosos a propósito: quien
// abra el bucket tiene que entender en un vistazo qué hacen ahí y poder
// borrarlos sin miedo.
const RUTA_PRUEBA = 'salud/prueba.txt';
const RUTA_CORS = 'salud/cors.png';

// Un PNG de 1×1 transparente, entero: setenta bytes con su firma, su IHDR, su
// IDAT y su IEND. Va escrito en base64 porque no hay dependencias y porque no
// merece la pena comprimir un píxel a mano en cada arranque. No es un dato de la
// serie ni de la cuenta: es el objeto más pequeño posible que el navegador puede
// intentar leer para saber si al bucket le falta CORS.
const PNG_DE_UN_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Las URLs firmadas del estudio duran seis horas, aquí y en todas partes.
const MINUTOS_DE_LA_URL = 360;

// Nueve comprobaciones a la vez contra Google, más el bucket. Cada una lleva un
// límite corto: si una se cuelga, las demás tienen que llegar a tiempo de
// pintarse dentro de los 60 s de la plataforma.
const LIMITE_MS = 20_000;

// Cuerpos deliberadamente inválidos. Sin contenido no hay nada que generar: son
// la petición más barata que demuestra acceso. Ver la regla 3 de arriba.
const SIN_CONTENIDO = { contents: [] };
const SIN_INSTANCIAS = { instances: [] };

// El idioma en que se habla la serie, por si `voces.idioma` faltara en los datos.
const IDIOMA_POR_DEFECTO = 'ja-JP';

// Lo que dijo Google se enseña, pero recortado: en Salud son nueve modelos a la
// vez y una página de error de Google puede venir enorme.
const MAXIMO_DICHO = 600;

// ---------------------------------------------------------------------------
// La comprobación entera
// ---------------------------------------------------------------------------

/**
 * Comprueba la cuenta de arriba abajo y devuelve el objeto de
 * docs/contrato.md §2.
 *
 * @returns {Promise<object>} `{ ok, cuenta, credenciales, bucket, prueba_cors,
 *   montaje, modelos, voces, voces_error }`
 */
export async function salud() {
  // Si falta lo imprescindible —GCP_SERVICE_ACCOUNT o GCS_BUCKET—, `entorno()`
  // lanza con su propio mensaje, que dice exactamente qué variable falta y qué
  // tiene que llevar dentro. No se disimula: sin eso no hay nada que comprobar.
  const ent = entorno();
  const proyecto = String(ent.sa.project_id).trim();
  const modelos = listaDeModelos(ent);

  const resultados = await Promise.allSettled([
    comprobarCredenciales(),
    comprobarAlmacen(),
    ...modelos.map((modelo) => comprobarModelo(modelo, proyecto)),
    comprobarVoces(),
  ]);

  const credenciales = recoger(resultados[0], () => ({
    ok: false,
    error: 'No se ha podido comprobar la identificación con Google y no se sabe por qué.',
  }));

  const almacen = recoger(resultados[1], () => ({
    bucket: { lectura: false, escritura: false, error: 'No se ha podido comprobar el bucket.' },
    prueba_cors: { ruta: RUTA_CORS, url: null },
  }));

  const deLosModelos = modelos.map((modelo, i) =>
    recoger(resultados[2 + i], (fallo) => fichaDeModelo(modelo, false, textoDeFallo(fallo))),
  );

  const deLasVoces = recoger(resultados[2 + modelos.length], (fallo) => ({
    voces: [],
    error: textoDeFallo(fallo),
  }));

  return {
    // docs/contrato.md §2 escribe el objeto de Salud con su `ok:true` dentro. La
    // puerta lo vuelve a poner al responder, así que decirlo aquí no cambia nada
    // y deja el objeto tal y como está escrito en el contrato.
    ok: true,

    cuenta: {
      correo: enmascarar(ent.sa.client_email),
      proyecto: enmascarar(proyecto),
      bucket: enmascarar(ent.bucket),
      // El prefijo vacío se enseña vacío: significa «sin carpeta dentro del
      // bucket», que es distinto de no saberlo.
      prefijo: enmascarar(ent.prefijo),
    },

    // Todas las variables de docs/contrato.md §10 y §13.4, con si están puestas
    // y qué se pierde sin cada una. Nunca su valor: solo si hay algo o no.
    //
    // Existe por la trampa de despliegue que más tiempo hace perder: Vercel NO
    // aplica una variable nueva a un despliegue ya construido. Se pone la
    // variable, Salud sigue diciendo que falta, y se busca el fallo donde no
    // está. Para poder decir «¿la acabas de añadir? hace falta un Redeploy» hay
    // que saber primero cuál falta, y eso es esta lista.
    variables: estadoDeVariables(),

    // El sello del despliegue, recortado. Sirve para una sola cosa, pero
    // importante: saber si el Redeploy se llegó a hacer de verdad. Si después de
    // redesplegar este sello es el mismo de antes, no se redesplegó.
    despliegue: selloDelDespliegue(),

    // FALTA EN EL CONTRATO: docs/contrato.md §2 dice que Salud «comprueba
    // credenciales» pero no le da sitio en el objeto que devuelve. Se añade con
    // el nombre más obvio, `credenciales: { ok, error }`, porque es la primera
    // pregunta que hay que responder: si Google no acepta la service account,
    // todo lo demás falla por lo mismo y conviene verlo dicho una vez y no nueve.
    credenciales,

    bucket: almacen.bucket,
    prueba_cors: almacen.prueba_cors,

    // FALTA EN EL CONTRATO: §2 tampoco recoge el montador, y sin él no se puede
    // montar nada aunque todos los modelos estén en verde. Se dice aquí porque
    // Salud es la pantalla donde se mira si falta algo por instalar.
    montaje: comprobarMontaje(ent),

    modelos: deLosModelos,
    voces: deLasVoces.voces,

    // FALTA EN EL CONTRATO: §2 escribe `voces: [...]` y no deja dónde contar por
    // qué la lista viene vacía. Una lista vacía sin explicación parece que la
    // cuenta no tiene voces, cuando casi siempre es que falta habilitar la API
    // de síntesis de voz. Conviene apuntarlo en el contrato.
    voces_error: deLasVoces.error,
  };
}

/** Lo que devolvió una comprobación, o lo que se enseña si se rompió del todo. */
function recoger(resultado, siFalla) {
  return resultado.status === 'fulfilled' ? resultado.value : siFalla(resultado.reason);
}

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

/**
 * Pedir un token es la comprobación más barata que existe y la que separa «la
 * cuenta no vale» de «el modelo no está»: se firma un JWT con la clave privada y
 * Google lo canjea. Ni se enseña el token ni se guarda: lo único que sale de
 * aquí es un sí o un no.
 */
async function comprobarCredenciales() {
  try {
    await token(AMBITOS.plataforma);
    return { ok: true, error: null };
  } catch (fallo) {
    return { ok: false, error: textoDeFallo(fallo) };
  }
}

// ---------------------------------------------------------------------------
// El bucket
// ---------------------------------------------------------------------------

/**
 * Escribe de verdad y vuelve a leer de verdad.
 *
 * No basta con listar: listar solo prueba que se puede mirar. El estado, el
 * banco y todos los montajes se ESCRIBEN, así que se escribe un objeto minúsculo
 * con la hora dentro y se comprueba que lo que vuelve es exactamente eso. Un
 * bucket que acepta la escritura y devuelve otra cosa es peor que uno que la
 * rechaza, porque no se nota hasta mucho después.
 *
 * Y de paso deja el PNG de un píxel con el que el navegador comprobará el CORS,
 * que desde aquí no se puede comprobar.
 */
async function comprobarAlmacen() {
  const bucket = { lectura: false, escritura: false, error: null };
  const prueba_cors = { ruta: RUTA_CORS, url: null };
  const quejas = [];

  const marca = new Date().toISOString();
  const contenido =
    'Este archivo lo escribe la pantalla de Salud para comprobar que el bucket acepta ' +
    'escritura y lectura. Se puede borrar sin miedo: se vuelve a escribir solo.\n' +
    `Última comprobación: ${marca}\n`;

  try {
    await escribir(RUTA_PRUEBA, contenido);
    bucket.escritura = true;
  } catch (fallo) {
    quejas.push(`No se ha podido escribir en el bucket. ${textoDeFallo(fallo)}`);
  }

  if (bucket.escritura) {
    try {
      const vuelto = await leer(RUTA_PRUEBA);
      if (!vuelto) {
        quejas.push(
          `Se ha escrito «${RUTA_PRUEBA}» y al ir a leerlo el bucket dice que no está. Suele ser ` +
            'que la cuenta pueda escribir pero no leer: repasa los permisos de la service account ' +
            'sobre el bucket, que necesita los dos.',
        );
      } else if (!vuelto.texto.includes(marca)) {
        quejas.push(
          `Se ha escrito «${RUTA_PRUEBA}» y lo que ha vuelto al leerlo no es lo que se escribió. ` +
            'Eso no es un problema de permisos: puede haber otra cosa escribiendo en esa misma ruta ' +
            'a la vez, o el bucket está sirviendo una copia vieja. El estado de la serie vive en ' +
            'este mismo bucket, así que conviene aclararlo antes de generar nada.',
        );
      } else {
        bucket.lectura = true;
      }
    } catch (fallo) {
      quejas.push(`No se ha podido leer del bucket. ${textoDeFallo(fallo)}`);
    }
  }

  // El píxel del CORS va aparte: aunque la prueba de arriba haya ido mal, si se
  // puede dejar el PNG y firmarlo, el navegador podrá decir lo suyo.
  try {
    await escribir(RUTA_CORS, Buffer.from(PNG_DE_UN_PIXEL, 'base64'));
    const urls = await firmar([RUTA_CORS], { minutos: MINUTOS_DE_LA_URL });
    prueba_cors.url = urls[RUTA_CORS] ?? null;
    if (!prueba_cors.url) {
      quejas.push(
        `Se ha dejado «${RUTA_CORS}» en el bucket pero no se ha podido preparar su enlace, así que ` +
          'el navegador no puede comprobar si al bucket le falta CORS.',
      );
    }
  } catch (fallo) {
    quejas.push(
      'No se ha podido preparar la prueba de CORS, que es la que hace el navegador por su cuenta. ' +
        `${textoDeFallo(fallo)}`,
    );
  }

  bucket.error = quejas.length ? quejas.join('\n\n') : null;
  return { bucket, prueba_cors };
}

// ---------------------------------------------------------------------------
// Los modelos
// ---------------------------------------------------------------------------

/**
 * Todos los modelos que hay que comprobar, con su clave, su id, su región y la
 * variable de entorno que lo sustituye sin tocar código.
 *
 * No está Speech-to-Text, y no es un olvido: `entorno()` lo deja con el id en
 * null a propósito, porque la v1 de `speech:recognize` elige el suyo cuando no
 * se le dice ninguno. Sin id no hay modelo al que llamar. Lo que sí se comprueba
 * de esa familia es lo que se puede: la lista de voces, ahí abajo.
 */
function listaDeModelos(ent) {
  const idioma = idiomaDeLaSerie();
  const lista = [];

  for (const nivel of ['calidad', 'medio', 'economico']) {
    lista.push({
      clave: `imagen.${nivel}`,
      modelo: ent.modelos.imagen[nivel],
      verbo: 'generateContent',
      cuerpo: SIN_CONTENIDO,
      que: `comprobar el modelo de imagen de nivel ${nivel}`,
    });
  }

  for (const nivel of ['calidad', 'medio', 'economico']) {
    lista.push({
      clave: `veo.${nivel}`,
      modelo: ent.modelos.veo[nivel],
      // El mismo verbo con el que se generan los clips, para que lo que se
      // comprueba sea exactamente lo que después se va a usar. Sin instancias no
      // hay nada que generar: no se lanza ni un segundo de vídeo.
      verbo: 'predictLongRunning',
      cuerpo: SIN_INSTANCIAS,
      que: `comprobar el modelo de vídeo de nivel ${nivel}`,
    });
  }

  lista.push({
    clave: 'tts',
    modelo: ent.modelos.tts,
    verbo: 'generateContent',
    // La petición va dicha en el idioma en que se habla la serie, que es lo que
    // hay que comprobar: una cuenta puede tener el modelo y no tener ese idioma.
    // El cuerpo sigue estando vacío a propósito, así que no se sintetiza nada.
    cuerpo: {
      ...SIN_CONTENIDO,
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { languageCode: idioma } },
    },
    que: `comprobar el modelo de voz en ${idioma}`,
  });

  lista.push({
    clave: 'musica',
    modelo: ent.modelos.musica,
    verbo: 'generateContent',
    cuerpo: SIN_CONTENIDO,
    que: 'comprobar el modelo de música',
  });

  lista.push({
    clave: 'texto',
    modelo: ent.modelos.texto,
    verbo: 'generateContent',
    cuerpo: SIN_CONTENIDO,
    que: 'comprobar el modelo de texto',
  });

  return lista;
}

/**
 * Una llamada mínima a un modelo. Ver la regla 3 de la cabecera: el cuerpo va
 * inválido a propósito, así que un 400 es la respuesta buena.
 */
async function comprobarModelo(entrada, proyecto) {
  const modelo = entrada.modelo || {};

  if (!modelo.id) {
    return fichaDeModelo(
      entrada,
      false,
      'No hay ningún modelo declarado para esta casilla. Los ids salen de datos/serie.json y nunca ' +
        `del código; mientras tanto se puede poner uno en la variable ${modelo.variable || 'de entorno'}.`,
    );
  }

  // El permiso de acceso, ANTES de nada. Si Google no acepta la service account,
  // la llamada al modelo no llega a salir y el fallo que vuelve es el del canje
  // del token, que también puede ser un 400 —un JWT mal firmado lo es—. Sin esta
  // comprobación, una service account mal pegada pintaría los nueve modelos en
  // verde por la regla del 400, que es justo lo contrario de la verdad. El token
  // está cacheado y las nueve comprobaciones esperan al mismo canje, así que
  // esto no cuesta nueve llamadas ni rompe el que vayan todas a la vez.
  try {
    await token(AMBITOS.plataforma);
  } catch {
    return fichaDeModelo(
      entrada,
      false,
      'No se ha podido comprobar este modelo: Google no ha aceptado la identificación de la cuenta, ' +
        'así que la llamada no ha llegado a salir. De este modelo no se sabe nada todavía, ni bueno ' +
        'ni malo. El motivo, entero, está arriba en «credenciales».',
    );
  }

  try {
    await llamar(urlModelo(modelo, entrada.verbo, proyecto), entrada.cuerpo, {
      metodo: 'POST',
      limiteMs: LIMITE_MS,
      contexto: {
        que: entrada.que,
        modelo: modelo.id,
        region: modelo.region,
        variable: modelo.variable,
      },
    });
    // Con un cuerpo así, un 200 sería raro; pero si contesta, responde.
    return fichaDeModelo(entrada, true, null);
  } catch (fallo) {
    const http = Number(fallo && fallo.http);

    // 400: ha resuelto quién llama, dónde y a qué modelo, y lo único que no le
    // gusta es el cuerpo, que está mal a propósito. Hay acceso.
    if (http === 400) return fichaDeModelo(entrada, true, null);

    // 429: hay acceso, pero la cuota está al límite ahora mismo. Se cuenta como
    // sí y se deja dicho al lado, porque un 429 se confunde muchísimo con una
    // falta de permisos y lleva a tocar lo que no toca.
    if (http === 429) return fichaDeModelo(entrada, true, textoDeFallo(fallo));

    // 401, 403, 404 y lo demás: no se puede usar. El mensaje de `errores.js` ya
    // explica cada caso, incluido el 404 de los Gemini 3.x, que parece falta de
    // acceso y en realidad es que esos modelos solo se sirven desde «global».
    return fichaDeModelo(entrada, false, textoDeFallo(fallo));
  }
}

/** La ficha de un modelo tal y como la pinta la pantalla. */
function fichaDeModelo(entrada, ok, error) {
  const modelo = entrada.modelo || {};
  return {
    clave: entrada.clave,
    id: modelo.id ?? null,
    region: modelo.region ?? null,
    variable: modelo.variable ?? null,
    ok,
    error,
  };
}

// ---------------------------------------------------------------------------
// Las voces
// ---------------------------------------------------------------------------

/**
 * La lista de voces reales de Google para el idioma de la serie.
 *
 * Es una llamada de lectura, gratis, y de las más útiles que hay aquí: los ids
 * de voz NO se inventan ni se escriben en el código, se eligen escuchando en la
 * pantalla de Voces. Si esta lista viene vacía, esa pantalla no puede funcionar.
 */
async function comprobarVoces() {
  try {
    return { voces: await listarVoces(), error: null };
  } catch (fallo) {
    return { voces: [], error: textoDeFallo(fallo) };
  }
}

// ---------------------------------------------------------------------------
// El montador
// ---------------------------------------------------------------------------

/**
 * Si hay montador configurado o no.
 *
 * NO SE LE PREGUNTA A CLOUD RUN, a propósito. La service account de Vercel
 * necesita Cloud Run Invoker para lanzar el trabajo, y ese papel deja lanzarlo
 * pero NO deja leer su ficha: preguntar por él daría un 403 en una cuenta
 * perfectamente bien configurada, y Salud estaría enseñando en rojo algo que
 * funciona. Así que aquí solo se mira si la variable está puesta, que es lo que
 * de verdad falta cuando falta.
 *
 * FALTA EN EL CONTRATO: MONTAJE_URL y MONTAJE_KEY llegan con la enmienda §13.4 y
 * no están en lo que devuelve `entorno()` (§12), así que MONTAJE_URL se mira
 * aquí en el entorno, igual que hace api/_lib/montaje.js. Conviene añadirlas a
 * `entorno()`.
 */
function comprobarMontaje(ent) {
  const porUrl = Boolean((process.env.MONTAJE_URL || '').trim());
  const configurado = Boolean(ent.montajeJob) || porUrl;

  return {
    configurado,
    job: ent.montajeJob,
    region: ent.montajeRegion,
    variable: 'MONTAJE_JOB',
    error: configurado
      ? null
      : 'Todavía no hay montador, así que se puede generar todo pero no montar nada. Falta la ' +
        'variable MONTAJE_JOB (y MONTAJE_REGION si el montador está en otra región que la de ' +
        'GCP_LOCATION). El montador se instala una sola vez desde Cloud Shell tecleando dos líneas: ' +
        'se clona el repositorio y se ejecuta montador/instalar.sh, que lo construye, lo despliega, ' +
        'le da los permisos sobre el bucket y termina imprimiendo en un recuadro las variables con ' +
        'su nombre y su valor exactos. Tarda entre cinco y ocho minutos. Está en docs/despliegue.md.',
  };
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/** El idioma en que se habla la serie, tal como lo declara datos/serie.json. */
function idiomaDeLaSerie() {
  const escrito = String(((serie && serie.voces) || {}).idioma ?? '').trim();
  return escrito || IDIOMA_POR_DEFECTO;
}

/**
 * Un fallo, contado con palabras y en un solo texto: primero la frase en
 * español, y detrás lo que dijo Google sin traducir, que es lo único que dice de
 * verdad qué hay que cambiar. Traducir a Google es mentir.
 */
function textoDeFallo(fallo) {
  if (fallo instanceof ErrorDeCara) {
    const dicho = fallo.detalle ? recorte(String(fallo.detalle).trim(), MAXIMO_DICHO) : '';
    return dicho ? `${fallo.mensaje}\n\nGoogle ha dicho, literalmente: ${dicho}` : fallo.mensaje;
  }

  const dicho = fallo && fallo.message ? String(fallo.message) : String(fallo);
  return (
    'Se ha roto algo que no estaba previsto al hacer esta comprobación, y no tiene una explicación ' +
    `preparada. Debajo está, sin traducir, lo que ha dicho el programa: ${recorte(dicho, MAXIMO_DICHO)}`
  );
}

function recorte(texto, maximo) {
  const t = String(texto);
  return t.length <= maximo ? t : `${t.slice(0, maximo)}… (recortado: eran ${t.length} caracteres)`;
}

/**
 * Cómo se llama este despliegue, recortado a lo justo para reconocerlo.
 *
 * No identifica la cuenta ni el proyecto: es el commit y el momento en que se
 * construyó. Sirve para responder a la única pregunta que no se puede responder
 * de otra forma: «¿se ha llegado a hacer el Redeploy?». Si el sello es el mismo
 * que antes de tocar las variables, no se hizo.
 */
function selloDelDespliegue() {
  const commit = (process.env.VERCEL_GIT_COMMIT_SHA || '').trim();
  const entorno_ = (process.env.VERCEL_ENV || '').trim();
  return {
    commit: commit ? commit.slice(0, 7) : null,
    entorno: entorno_ || null,
    // La hora de arranque de este proceso. Dos respuestas seguidas con la misma
    // hora vienen del mismo arranque; si cambia, la función se ha reiniciado.
    arrancado: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
  };
}
