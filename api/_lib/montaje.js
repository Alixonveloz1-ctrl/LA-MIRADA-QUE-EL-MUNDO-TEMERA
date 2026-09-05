// El montaje: encargarle una pieza al montador y preguntar cómo va.
//
// Aquí viven dos ideas que gobiernan todo el archivo, y las dos están escritas
// en la FORMA del código y no en un aviso:
//
//   1. EL MONTADOR NO CONOCE NINGÚN ARCHIVO POR SU NOMBRE. Se le pasa la ruta de
//      un manifiesto y nada más. Ni un nombre de clip, ni un nombre de pista, ni
//      el de la salida: todo eso va dentro del manifiesto, que son datos. El
//      motivo real es que el montador se despliega A MANO y por tanto siempre va
//      por detrás del repositorio (docs/parche-despliegue.md §9): si añadir un
//      material nuevo obligara a redesplegar el contenedor, el diseño estaría
//      mal. Por eso `lanzar()` pasa MANIFIESTO, GCS_BUCKET y GCS_PREFIX, y
//      ninguna otra cosa.
//
//   2. UN CÓDIGO DE SALIDA NO ES UN MENSAJE DE ERROR. Cuando un montaje falla, lo
//      que se enseña en pantalla es lo que el montador escribió con sus palabras
//      en `montaje/{trabajo}/queja.txt` antes de salir, no un número. `estado()`
//      lee ese archivo del bucket. Solo si no hay queja escrita —el contenedor
//      se quedó sin memoria, por ejemplo— se compone una frase en español con lo
//      que diga Cloud Run, que sigue siendo palabras y no un código.
//
// Y una tercera, más callada: el manifiesto se COMPRUEBA antes de escribirlo.
// Un montaje cuesta minutos de máquina y, en un episodio, un buen rato; que
// falle a la mitad por un tramo que se sale de la pieza o por una entrada sin
// origen es tiempo tirado que se ve venir sin gastar nada. Las comprobaciones
// son las de docs/contrato.md §7.

import { entorno } from './entorno.js';
import { ErrorDeCara } from './errores.js';
import { escribir, leer, listar, borrar } from './gcs.js';
import { llamar, urlServicio } from './vertex.js';

// Dónde vive todo lo del montaje dentro del bucket (docs/contrato.md §11).
// Son rutas LÓGICAS: el prefijo del proyecto lo pone y lo quita gcs.js.
const CARPETA = 'montaje';

// El índice que hace posible que `estado(ejecucion)` encuentre la queja. Ver el
// comentario largo de `estado()`: el nombre de una ejecución de Cloud Run no
// lleva dentro el nombre del trabajo, así que se apunta al lanzarlo.
const CARPETA_DE_EJECUCIONES = `${CARPETA}/ejecuciones`;

// Un trabajo con este nombre pisaría el índice de arriba.
const NOMBRE_RESERVADO = 'ejecuciones';

// Las capas de docs/contrato.md §7. Un episodio no cabe en un solo trabajo: se
// monta por escenas, luego por actos y luego entero, y cada capa se guarda.
const CAPAS = ['escena', 'acto', 'episodio', 'pieza'];

// Las pistas de audio que sabe mezclar el montador. «musica» y «ambiente» se
// agachan bajo cada línea de «voz» (sidechaincompress); una pista con otro
// nombre no sabría a cuál de los dos grupos pertenece.
const PISTAS = ['musica', 'voz', 'ambiente'];

// Margen para comparar segundos. Un fotograma a 24 fps dura 0,0417 s: por debajo
// de eso lo que hay no es un hueco, es el redondeo de un número escrito con dos
// decimales.
const MARGEN_S = 0.05;

// Nombres tal como los admite Cloud Run. Un nombre de job que no cumpla esto no
// existe, y meterlo en una URL compondría una dirección distinta de la que se
// cree que se está pidiendo.
const NOMBRE_DE_JOB = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;
const NOMBRE_DE_REGION = /^[a-z][a-z0-9-]*$/;

// El host de Cloud Run. No identifica ninguna cuenta: es la puerta pública.
const HOST_RUN = 'run.googleapis.com';

// Lanzar un job es meterlo en una cola: Google contesta en un segundo. Consultar
// una ejecución es leer cuatro campos. Los dos límites van muy por debajo de los
// 60 s de la plataforma, que es lo único que tienen que garantizar.
const LIMITE_LANZAR_MS = 20_000;
const LIMITE_CONSULTA_MS = 20_000;

// Hiragana, katakana, kanji y katakana de media anchura. Sirve para el último
// cerrojo de un invariante de la serie: en pantalla no hay ni una palabra en
// japonés. El japonés únicamente se oye.
const JAPONES = /[぀-ヿ㐀-䶿一-鿿ｦ-ﾝ]/;

// ---------------------------------------------------------------------------
// Lanzar
// ---------------------------------------------------------------------------

/**
 * Comprueba el manifiesto, lo escribe en el bucket y le encarga el montaje al
 * Job de Cloud Run.
 *
 * Al montador se le pasan tres variables de entorno y ninguna más: la RUTA
 * LÓGICA del manifiesto, el bucket y el prefijo del proyecto. Ni un nombre de
 * archivo de material: todos van dentro del manifiesto, que son datos.
 *
 * @param {object} manifiesto el de docs/contrato.md §7.
 * @returns {Promise<{ejecucion:string, manifiestoRuta:string}>}
 *   `ejecucion` es el nombre completo con el que después se pregunta cómo va.
 */
export async function lanzar(manifiesto) {
  const ent = entorno();
  const trabajo = validarManifiesto(manifiesto);

  // La dirección del job se resuelve ANTES de escribir nada: si falta
  // MONTAJE_JOB, más vale decirlo sin haber dejado un manifiesto huérfano en el
  // bucket de un montaje que no se ha llegado a encargar.
  const direccion = direccionDelJob(ent);

  const manifiestoRuta = rutaDelManifiesto(trabajo);
  await escribir(manifiestoRuta, `${JSON.stringify(manifiesto, null, 2)}\n`);

  // La queja de un intento anterior de ESTE MISMO trabajo se borra antes de
  // empezar. Si no, un montaje que hoy falle sin escribir nada —el contenedor se
  // queda sin memoria y muere de golpe— enseñaría la queja de ayer como si fuera
  // la suya, que es peor que no enseñar ninguna.
  try {
    await borrar(rutaDeLaQueja(trabajo));
  } catch {
    // No poder borrarla no es motivo para no montar: lo único que se arriesga es
    // leer la queja de antes si este montaje falla sin llegar a escribir la suya,
    // y quedarse sin montar por eso sería mucho peor.
  }

  const respuesta = await llamar(`${direccion}:run`, cuerpoDeLanzamiento(manifiestoRuta, ent), {
    metodo: 'POST',
    limiteMs: LIMITE_LANZAR_MS,
    contexto: { que: 'encargarle el montaje al montador', servicio: 'run' },
  });

  const ejecucion = nombreDeLaEjecucion(respuesta, trabajo, manifiestoRuta);

  await apuntarLaEjecucion(ejecucion, trabajo);

  return { ejecucion, manifiestoRuta };
}

/**
 * Deja apuntado en el bucket a qué trabajo pertenece esta ejecución.
 *
 * Hace falta porque el nombre de una ejecución de Cloud Run NO lleva dentro el
 * nombre del trabajo —lleva el del job, que es siempre el mismo—, y sin saber el
 * trabajo no se puede encontrar la queja que el montador deja en
 * `montaje/{trabajo}/queja.txt`. Va al bucket y no a la memoria de la función por
 * lo de siempre: la función no recuerda nada entre llamadas y el navegador se
 * cierra.
 *
 * Si no se puede apuntar, el montaje YA está en marcha: no se tira por esto. Lo
 * que se pierde es poder leer la queja si falla, y `estado()` lo dice con
 * palabras cuando llega el caso.
 */
async function apuntarLaEjecucion(ejecucion, trabajo) {
  try {
    await escribir(rutaDelIndice(identificadorDe(ejecucion)), `${trabajo}\n`);
  } catch {
    // A propósito en silencio: ver arriba.
  }
}

/**
 * El cuerpo de `jobs:run`: overrides de contenedor con las tres variables que
 * necesita el montador, y nada más.
 *
 * GCS_PREFIX viaja aunque esté vacío, a propósito: vacío significa «sin carpeta
 * dentro del bucket», y no mandarla dejaría al contenedor con la que llevara
 * dentro de su imagen, que es de cuando se construyó.
 */
function cuerpoDeLanzamiento(manifiestoRuta, ent) {
  const variables = [
    // La ruta LÓGICA. El montador le pone delante el bucket y el prefijo, igual
    // que hace gcs.js de este lado.
    { name: 'MANIFIESTO', value: manifiestoRuta },
    { name: 'GCS_BUCKET', value: ent.bucket },
    { name: 'GCS_PREFIX', value: ent.prefijo },
  ];

  // La clave que solo comparten el endpoint y el montador (enmienda §13.4 del
  // contrato). Viaja al contenedor y el montador la comprueba antes de
  // trabajar. Si no está configurada no se manda: el montador dirá con sus
  // palabras que no la ha recibido.
  const clave = claveDelMontador();
  if (clave) variables.push({ name: 'MONTAJE_KEY', value: clave });

  return { overrides: { containerOverrides: [{ env: variables }] } };
}

/**
 * El nombre de la ejecución que acaba de crearse.
 *
 * `jobs:run` devuelve una operación de larga duración cuyos `metadata` son ya la
 * ejecución. Se busca ahí primero y en `response` después. Si no aparece por
 * ninguna parte se devuelve el nombre de la operación: `estado()` sabe resolver
 * las dos formas, y quedarse sin ninguna sería dejar el montaje huérfano —vivo,
 * cobrándose, y sin nadie que pueda preguntar por él—.
 */
function nombreDeLaEjecucion(respuesta, trabajo, manifiestoRuta) {
  const dentro = (respuesta && (respuesta.metadata || respuesta.response)) || null;
  const deLaEjecucion = dentro && typeof dentro.name === 'string' ? dentro.name.trim() : '';
  if (deLaEjecucion.includes('/executions/')) return deLaEjecucion;

  const deLaOperacion = respuesta && typeof respuesta.name === 'string' ? respuesta.name.trim() : '';
  if (deLaOperacion.includes('/operations/') || deLaOperacion.includes('/executions/')) {
    return deLaOperacion;
  }

  throw new ErrorDeCara(
    `El montador ha aceptado el encargo de «${trabajo}» pero Google no ha devuelto el nombre de la ` +
      'ejecución, que es lo único con lo que se puede preguntar después si el montaje ha terminado. ' +
      'Puede que se esté montando igualmente: el resultado aparecería en el bucket, y si algo sale ' +
      `mal la explicación quedaría escrita en «${rutaDeLaQueja(trabajo)}». El manifiesto de este ` +
      `trabajo está en «${manifiestoRuta}». Debajo está, tal cual, lo que contestó Google.`,
    { detalle: comoTexto(respuesta), reintentable: false, http: 502 },
  );
}

// ---------------------------------------------------------------------------
// Consultar
// ---------------------------------------------------------------------------

/**
 * Cómo va un montaje.
 *
 * DE DÓNDE SALE EL TRABAJO, que es lo que hay que saber para encontrar la queja.
 * El nombre de una ejecución de Cloud Run es
 * `projects/…/locations/…/jobs/{job}/executions/{job}-xxxxx`: lleva dentro el
 * nombre del JOB —que es siempre el mismo, el de MONTAJE_JOB— pero NO el del
 * trabajo. De ahí no se puede deducir. Así que se hacen las dos cosas que
 * permite el contrato, y en este orden:
 *
 *   1. Si quien llama lo sabe, se lo pasa: `estado(ejecucion, trabajo)`, o bien
 *      `estado({ ejecucion, trabajo })`. El modo `montaje-estado` de
 *      docs/contrato.md §2 solo lleva `ejecucion` en el cuerpo, así que esto es
 *      la comodidad, no el camino principal.
 *   2. Si no, se busca en el bucket. `lanzar()` deja apuntado en
 *      `montaje/ejecuciones/{id}.txt` a qué trabajo pertenece cada ejecución,
 *      por la misma razón por la que todo lo demás vive en el bucket: el
 *      navegador se cierra, la función no recuerda nada entre llamadas, y el
 *      bucket es la única verdad.
 *
 * FALTA EN EL CONTRATO: docs/contrato.md §12 escribe `estado(ejecucion)`. El
 * segundo argumento es opcional y no cambia esa llamada; se añade porque quien
 * ya sabe el trabajo se ahorra una lectura. Conviene apuntarlo en el contrato.
 *
 * @param {string|{ejecucion:string, trabajo?:string}} ejecucion el nombre
 *        completo que devolvió `lanzar()`.
 * @param {string|null} [trabajo] el trabajo, si quien llama lo sabe.
 * @returns {Promise<{hecho:boolean, bien:boolean, queja:string|null, salidas:string[]}>}
 */
export async function estado(ejecucion, trabajo = null) {
  const pedido = leerQueSeConsulta(ejecucion, trabajo);
  const nombre = await resolverEjecucion(pedido.ejecucion);

  const respuesta = await llamar(urlDeRecurso(nombre), null, {
    metodo: 'GET',
    limiteMs: LIMITE_CONSULTA_MS,
    contexto: { que: 'preguntar cómo va el montaje', servicio: 'run' },
  });

  const marcha = leerLaMarcha(respuesta);

  if (!marcha.hecho) return { hecho: false, bien: false, queja: null, salidas: [] };

  // El nombre por el que se preguntó también vale para buscar en el índice: si
  // al lanzar solo se pudo guardar el de la operación, es ahí donde quedó
  // apuntado el trabajo.
  const cual = pedido.trabajo || (await trabajoDeLaEjecucion([nombre, pedido.ejecucion]));

  const salidas = marcha.bien ? await buscarSalidas(cual) : [];

  // Cloud Run puede dar por bueno un montaje que no ha dejado nada escrito. Pasa
  // por una razón concreta y ya conocida (docs/parche-despliegue.md §6): el
  // montador NO se ejecuta con la service account de Vercel sino con la cuenta de
  // compute del proyecto, y si esa cuenta no tiene permiso sobre el bucket, el
  // trabajo se hace entero y se pierde al escribir el resultado. Un «bien» sin
  // archivo sería mentira, así que aquí se desmiente.
  const salioAlgo = salidas.length > 0 || cual === null;
  const bien = marcha.bien && salioAlgo;

  const queja = bien ? null : await componerQueja(cual, marcha, salidas.length > 0);

  return { hecho: true, bien, queja, salidas };
}

/**
 * Admite las tres formas de decir qué se consulta y devuelve
 * `{ ejecucion, trabajo }`. El trabajo puede quedar en null: entonces se busca
 * en el índice del bucket.
 */
function leerQueSeConsulta(ejecucion, trabajo) {
  const objeto = ejecucion && typeof ejecucion === 'object' && !Array.isArray(ejecucion)
    ? ejecucion
    : null;

  const nombre = String((objeto ? objeto.ejecucion : ejecucion) ?? '').trim();
  const cual = String(trabajo ?? (objeto ? objeto.trabajo : '') ?? '').trim();

  if (!nombre) {
    throw new ErrorDeCara(
      'Se ha pedido saber cómo va un montaje sin decir cuál. El nombre de la ejecución es lo que ' +
        'devuelve el montador al encargarle el trabajo y lo que queda guardado en el estado; sin él ' +
        'no hay nada por lo que preguntar.',
      { reintentable: false, http: 400 },
    );
  }

  if (!nombre.includes('/executions/') && !nombre.includes('/operations/')) {
    throw new ErrorDeCara(
      `«${nombre}» no es el nombre de una ejecución del montador. El que vale es el completo, el ` +
        'que devolvió Google al encargar el montaje, y lleva dentro «/executions/».',
      { reintentable: false, http: 400 },
    );
  }

  return { ejecucion: nombre, trabajo: cual && esNombreDeTrabajo(cual) ? cual : null };
}

/**
 * Si lo que se tiene es el nombre de la operación que creó la ejecución, se
 * pregunta por ella y se saca de dentro el nombre de la ejecución. Es el único
 * caso en que se hace una llamada de más, y existe para que un montaje no se
 * quede huérfano por no haber podido leer un campo al lanzarlo.
 */
async function resolverEjecucion(nombre) {
  if (nombre.includes('/executions/')) return nombre;

  const operacion = await llamar(urlDeRecurso(nombre), null, {
    metodo: 'GET',
    limiteMs: LIMITE_CONSULTA_MS,
    contexto: { que: 'buscar qué ejecución creó el encargo del montaje', servicio: 'run' },
  });

  // La ejecución viene dentro de la operación, en `metadata`; y si algún día la
  // API contestara con la ejecución misma, también vale.
  for (const nudo of [operacion && operacion.metadata, operacion && operacion.response, operacion]) {
    const nombreDentro = nudo && typeof nudo.name === 'string' ? nudo.name.trim() : '';
    if (nombreDentro.includes('/executions/')) return nombreDentro;
  }

  throw new ErrorDeCara(
    'Google ha aceptado el encargo del montaje pero todavía no dice qué ejecución lo está ' +
      'haciendo, así que no se puede preguntar por ella. Suele ser cosa de unos segundos: vuelve a ' +
      'consultarlo dentro de un momento.',
    { detalle: comoTexto(operacion), reintentable: true, http: 503 },
  );
}

/** Qué dice Cloud Run de una ejecución: si terminó y si terminó bien. */
function leerLaMarcha(ejecucion) {
  const condiciones = Array.isArray(ejecucion && ejecucion.conditions) ? ejecucion.conditions : [];
  const completada = condiciones.find((c) => c && c.type === 'Completed') || null;
  const veredicto = completada ? String(completada.state ?? completada.status ?? '') : '';

  const terminada = String(ejecucion?.completionTime ?? ejecucion?.completion_time ?? '').trim();
  const exitos = entero(ejecucion?.succeededCount ?? ejecucion?.succeeded_count);
  const fallos = entero(ejecucion?.failedCount ?? ejecucion?.failed_count);
  const cancelados = entero(ejecucion?.cancelledCount ?? ejecucion?.cancelled_count);
  const tareas = entero(ejecucion?.taskCount ?? ejecucion?.task_count);

  const hecho = Boolean(terminada) ||
    veredicto === 'CONDITION_SUCCEEDED' ||
    veredicto === 'CONDITION_FAILED';

  // El veredicto de Cloud Run manda; los contadores solo deciden cuando no lo
  // hay, que pasa con las versiones viejas de la API.
  const bien = hecho && (
    veredicto === 'CONDITION_SUCCEEDED' ||
    (!veredicto && fallos === 0 && cancelados === 0 && exitos >= Math.max(1, tareas))
  );

  return {
    hecho,
    bien,
    // Lo que Cloud Run dice con sus palabras cuando algo va mal. No es la queja
    // del montador —esa la escribe él en el bucket— pero es lo único que hay
    // cuando el contenedor muere sin llegar a escribir nada.
    dicho: completada ? textoDeCondicion(completada) : null,
    exitos,
    fallos,
    cancelados,
    tareas,
  };
}

/**
 * La queja, con palabras, en este orden:
 *
 *   1. Lo que el montador escribió en `montaje/{trabajo}/queja.txt` antes de
 *      salir. Es lo único que sabe de verdad qué ha pasado, y por eso existe ese
 *      archivo: un código de salida no es un mensaje de error.
 *   2. Si no hay queja escrita, una frase en español que lo dice y que lleva
 *      detrás lo que haya contado Cloud Run. Que el montador muera sin escribir
 *      es en sí un dato: suele ser memoria o un corte en seco.
 */
async function componerQueja(trabajo, marcha, huboSalidas) {
  if (trabajo) {
    let escrita = null;
    try {
      const archivo = await leer(rutaDeLaQueja(trabajo));
      escrita = archivo && archivo.texto ? archivo.texto.trim() : null;
    } catch {
      // Que no se pueda leer la queja no puede tapar el fallo del montaje: se
      // sigue y se cuenta lo que se sabe.
      escrita = null;
    }
    if (escrita) return escrita;
  }

  const trozos = [];

  if (marcha.bien && !huboSalidas) {
    trozos.push(
      'El montador dice que ha terminado bien, pero en el bucket no ha aparecido el archivo ' +
        'montado. Casi siempre es lo mismo, y es una trampa cara: el montador NO se ejecuta con la ' +
        'service account de Vercel, sino con la cuenta de compute del proyecto ' +
        '(la que acaba en «-compute@developer.gserviceaccount.com»), y si esa cuenta no tiene ' +
        'permiso de escritura sobre el bucket, el trabajo se hace entero y se pierde justo al ' +
        'guardarlo. El instalador del montador da ese permiso; está explicado en ' +
        'docs/despliegue.md.',
    );
  } else {
    trozos.push(
      'El montaje ha terminado mal y el montador no ha dejado escrito por qué. Cuando falla por su ' +
        `cuenta lo explica con sus palabras en «${trabajo ? rutaDeLaQueja(trabajo) : `${CARPETA}/{trabajo}/queja.txt`}», ` +
        'así que si ahí no hay nada es que se ha ido de golpe: normalmente por quedarse sin memoria ' +
        'con una pieza larga, o porque el contenedor se paró antes de poder contarlo.',
    );
    if (!trabajo) {
      trozos.push(
        'Además, esta ejecución no se ha podido relacionar con ningún trabajo, así que ni siquiera ' +
          'se sabe en qué carpeta buscar su queja. Vuelve a lanzar el montaje desde la pantalla de ' +
          'Montaje: los que se lanzan desde ahí quedan apuntados y sí se pueden seguir.',
      );
    }
  }

  if (marcha.dicho) trozos.push(`Cloud Run dice: ${marcha.dicho}`);

  const cuenta = [];
  if (marcha.tareas) cuenta.push(cantidad(marcha.tareas, 'tarea', 'tareas'));
  if (marcha.fallos) cuenta.push(cantidad(marcha.fallos, 'fallida', 'fallidas'));
  if (marcha.cancelados) cuenta.push(cantidad(marcha.cancelados, 'cancelada', 'canceladas'));
  if (marcha.exitos) cuenta.push(`${cantidad(marcha.exitos, 'terminada', 'terminadas')} bien`);
  if (cuenta.length) trozos.push(`De lo encargado: ${cuenta.join(', ')}.`);

  return trozos.join('\n\n');
}

/**
 * Lo que ha quedado escrito en el bucket, en rutas lógicas.
 *
 * Primero la salida que pedía el manifiesto —que puede estar fuera de la carpeta
 * del trabajo: `montaje/teaser-3.mp4`, por ejemplo— y detrás cualquier otra cosa
 * que el montador haya dejado dentro de `montaje/{trabajo}/`, que es donde caen
 * las capas intermedias. El manifiesto y la queja no son salidas.
 */
async function buscarSalidas(trabajo) {
  if (!trabajo) return [];

  const salidas = [];

  const pedida = await salidaDelManifiesto(trabajo);
  if (pedida) {
    try {
      // Listar con la ruta entera como prefijo es la forma barata de preguntar
      // si un archivo existe: leerlo se traería el MP4 completo por la función,
      // que es justo lo que no puede pasar nunca.
      const encontrado = await listar(pedida);
      if (encontrado.some((o) => o.ruta === pedida)) salidas.push(pedida);
    } catch {
      // Si no se puede mirar, no se inventa: sencillamente no se dice que esté.
    }
  }

  try {
    const dentro = await listar(`${CARPETA}/${trabajo}/`);
    for (const objeto of dentro) {
      if (objeto.ruta === rutaDelManifiesto(trabajo)) continue;
      if (objeto.ruta === rutaDeLaQueja(trabajo)) continue;
      if (!salidas.includes(objeto.ruta)) salidas.push(objeto.ruta);
    }
  } catch {
    // Igual: lo que no se ha podido mirar no se cuenta.
  }

  return salidas;
}

/** La `salida` que pedía el manifiesto de este trabajo, leída del bucket. */
async function salidaDelManifiesto(trabajo) {
  try {
    const archivo = await leer(rutaDelManifiesto(trabajo));
    if (!archivo || !archivo.texto) return null;
    const manifiesto = JSON.parse(archivo.texto);
    const salida = String((manifiesto && manifiesto.salida) ?? '').trim();
    return esRutaLogica(salida) ? salida : null;
  } catch {
    return null;
  }
}

/** El trabajo al que pertenece una ejecución, según el índice del bucket. */
async function trabajoDeLaEjecucion(nombres) {
  const ids = [...new Set(nombres.map(identificadorDe).filter(Boolean))];

  for (const id of ids) {
    try {
      const archivo = await leer(rutaDelIndice(id));
      const trabajo = archivo && archivo.texto ? archivo.texto.trim() : '';
      if (trabajo && esNombreDeTrabajo(trabajo)) return trabajo;
    } catch {
      // Si el índice no se puede leer se sigue: `estado()` cuenta lo que sepa.
    }
  }

  return null;
}

/** El último tramo de un nombre completo, que es lo que identifica el recurso. */
function identificadorDe(nombre) {
  const texto = String(nombre ?? '').trim();
  const id = texto.slice(texto.lastIndexOf('/') + 1).trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ? id : '';
}

// ---------------------------------------------------------------------------
// La dirección del montador
// ---------------------------------------------------------------------------

/**
 * La dirección del Job, sin el verbo. `lanzar()` le pega «:run».
 *
 * MONTAJE_URL manda si está puesta (enmienda §13.4 del contrato); si no, la
 * dirección se compone con MONTAJE_JOB, MONTAJE_REGION y el project id, que sale
 * SIEMPRE del `project_id` de la service account y nunca de una constante.
 */
function direccionDelJob(ent) {
  const escrita = urlDelMontador();
  if (escrita) return escrita;

  if (!ent.montajeJob) throw faltaMontajeJob();

  const job = String(ent.montajeJob).trim();
  if (!NOMBRE_DE_JOB.test(job)) {
    throw new ErrorDeCara(
      `MONTAJE_JOB está puesta como «${job}» y eso no es un nombre de trabajo de Cloud Run: van en ` +
        'minúsculas, empiezan por letra y solo llevan letras, números y guiones. Se copia tal cual ' +
        'lo imprime el instalador del montador al terminar, en el recuadro con las variables. Está ' +
        'explicado en docs/despliegue.md.',
      { reintentable: false, http: 500 },
    );
  }

  const region = String(ent.montajeRegion || ent.region).trim().toLowerCase();
  if (!NOMBRE_DE_REGION.test(region)) {
    throw new ErrorDeCara(
      `MONTAJE_REGION está puesta como «${region}» y eso no es una región de Google. Es la región ` +
        'donde el instalador dejó el montador; si se deja sin poner, se usa la de GCP_LOCATION. ' +
        'Está explicado en docs/despliegue.md.',
      { reintentable: false, http: 500 },
    );
  }

  const proyecto = String(ent.sa.project_id).trim();

  // El endpoint regional de Cloud Run. Un job vive en su región y solo desde ahí
  // se le encarga trabajo.
  return urlServicio(
    `${region}-${HOST_RUN}`,
    `v2/projects/${encodeURIComponent(proyecto)}/locations/${region}/jobs/${job}`,
  );
}

/**
 * MONTAJE_URL, comprobada. Sale de `entorno()`, como todo lo de la cuenta, para
 * que haya una sola fuente y para que el censor la vea.
 */
function urlDelMontador() {
  const crudo = String(entorno().montajeUrl || '').trim();
  if (!crudo) return null;

  // El instalador imprime la dirección del recurso; que alguien la copie con el
  // verbo pegado o con una barra de más no es motivo para no montar.
  const limpia = crudo.replace(/\/+$/, '').replace(/:run$/i, '');

  let direccion;
  try {
    direccion = new URL(limpia);
  } catch {
    throw new ErrorDeCara(
      `MONTAJE_URL está puesta como «${crudo}» y eso no es una dirección completa. Tiene que ser la ` +
        'que imprime el instalador del montador al terminar, en el recuadro con las variables. Si no ' +
        'la tienes a mano, borra MONTAJE_URL y deja solo MONTAJE_JOB y MONTAJE_REGION: la dirección ' +
        'se compone sola. Está explicado en docs/despliegue.md.',
      { reintentable: false, http: 500 },
    );
  }

  if (direccion.protocol !== 'https:' || !direccion.hostname.endsWith(HOST_RUN)) {
    // La trampa de docs/parche-despliegue.md §4, vista desde aquí: quien pega
    // una dirección de «…run.app» ha desplegado un SERVICIO, y el montador tiene
    // que ser un JOB. Un servicio se queda sin CPU a mitad del trabajo y el
    // vídeo se corta sin error claro.
    throw new ErrorDeCara(
      `MONTAJE_URL apunta a «${direccion.hostname || crudo}», que no es la dirección de un trabajo ` +
        'de Cloud Run. Si acaba en «.run.app», eso es un SERVICIO, y el montador tiene que ser un ' +
        'JOB: un servicio se queda sin procesador a mitad del montaje y el vídeo sale cortado sin ' +
        'decir por qué. Vuelve a instalar el montador con montador/instalar.sh y copia las ' +
        'variables tal cual las imprime al terminar. Está explicado en docs/despliegue.md.',
      { reintentable: false, http: 500 },
    );
  }

  if (!/\/v2\/projects\/[^/]+\/locations\/[^/]+\/jobs\/[^/]+$/.test(direccion.pathname)) {
    throw new ErrorDeCara(
      `MONTAJE_URL está puesta como «${crudo}» y no nombra ningún trabajo de Cloud Run: la ` +
        'dirección tiene que acabar en «/jobs/<nombre del trabajo>». Si no la tienes a mano, borra ' +
        'MONTAJE_URL y deja solo MONTAJE_JOB y MONTAJE_REGION, que es la forma corta. Está ' +
        'explicado en docs/despliegue.md.',
      { reintentable: false, http: 500 },
    );
  }

  return `https://${direccion.host}${direccion.pathname}`;
}

/**
 * La clave que solo comparten el endpoint y el montador. Puede no estar: sin
 * ella el montador trabaja igual, pero acepta el encargo de cualquiera. Sale de
 * `entorno()` para que el censor la tache si alguna vez se cuela en una
 * respuesta.
 */
function claveDelMontador() {
  return entorno().montajeKey;
}

/** Lo que se enseña cuando no hay montador configurado. */
function faltaMontajeJob() {
  return new ErrorDeCara(
    'No hay ningún montador configurado, así que no se puede montar nada todavía. Falta la ' +
      'variable de entorno MONTAJE_JOB, que lleva el nombre del trabajo de Cloud Run que hace el ' +
      'montaje con ffmpeg (y, si está en otra región que la de GCP_LOCATION, también MONTAJE_REGION). ' +
      'El montador se instala una sola vez desde Cloud Shell, tecleando dos líneas: se clona el ' +
      'repositorio y se ejecuta montador/instalar.sh, que lo construye, lo despliega, le da los ' +
      'permisos sobre el bucket e imprime al final, en un recuadro, las variables con su nombre y su ' +
      'valor exactos para llevarlas a Vercel. Tarda entre cinco y ocho minutos. Y una vez puestas en ' +
      'Vercel hace falta un Redeploy: Vercel no aplica una variable nueva a un despliegue ya ' +
      'construido, así que hasta que no se rehaga el despliegue esta pantalla seguirá diciendo que ' +
      'falta algo que ya está puesto. Todo el procedimiento está en docs/despliegue.md.',
    { reintentable: false, http: 500 },
  );
}

// ---------------------------------------------------------------------------
// El manifiesto (docs/contrato.md §7)
// ---------------------------------------------------------------------------

/**
 * Comprueba el manifiesto entero y devuelve el nombre del trabajo.
 *
 * Se juntan TODAS las quejas antes de lanzarlas, en vez de parar en la primera:
 * quien está montando quiere saber de una vez todo lo que hay que arreglar, no
 * descubrirlo de uno en uno.
 */
function validarManifiesto(manifiesto) {
  if (!manifiesto || typeof manifiesto !== 'object' || Array.isArray(manifiesto)) {
    throw new ErrorDeCara(
      'Se ha pedido un montaje sin manifiesto. El manifiesto es la hoja de montaje entera: qué ' +
        'clips van, de dónde salen, en qué segundo entra cada uno, qué audio se mezcla, qué ' +
        'subtítulos se queman y dónde se guarda el resultado. Lo compone la pantalla de Montaje, así ' +
        'que esto es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 400 },
    );
  }

  const quejas = [];

  const trabajo = String(manifiesto.trabajo ?? '').trim();
  if (!trabajo) {
    quejas.push(
      'No dice a qué trabajo pertenece («trabajo»). Ese nombre es la carpeta donde se guardan el ' +
        'manifiesto y, si algo sale mal, la explicación del montador.',
    );
  } else if (!esNombreDeTrabajo(trabajo)) {
    quejas.push(
      `«${trabajo}» no sirve como nombre de trabajo: acaba siendo una carpeta del bucket, así que ` +
        'va sin barras ni espacios (letras, números, punto, guion y guion bajo). Por ejemplo, ' +
        '«teaser-3».',
    );
  } else if (trabajo === NOMBRE_RESERVADO) {
    quejas.push(
      `«${NOMBRE_RESERVADO}» no se puede usar como nombre de trabajo: esa carpeta ya la usa el ` +
        'estudio para saber qué montaje corresponde a cada encargo. Ponle otro nombre.',
    );
  }

  const capa = String(manifiesto.capa ?? '').trim();
  if (!capa) {
    quejas.push(
      `No dice de qué capa es el montaje («capa»). Son ${enLista(CAPAS)}: un episodio no cabe en un ` +
        'solo trabajo y se monta por capas, guardando cada una, para que si falla la tercera no haya ' +
        'que rehacer las dos primeras.',
    );
  } else if (!CAPAS.includes(capa)) {
    quejas.push(`«${capa}» no es una capa de montaje. Las capas son ${enLista(CAPAS)}.`);
  }

  const salida = String(manifiesto.salida ?? '').trim();
  if (!salida) {
    quejas.push(
      'No dice dónde se guarda el resultado («salida»). Sin eso el montaje se haría entero y no ' +
        'quedaría en ninguna parte.',
    );
  } else if (!esRutaLogica(salida)) {
    quejas.push(
      `«${salida}» no sirve como sitio donde dejar el resultado. Las rutas del manifiesto son ` +
        'lógicas —«montaje/teaser-3.mp4»—, sin «gs://», sin «https://» y sin barra al principio: el ' +
        'bucket y la carpeta del proyecto los pone el montador con lo que se le pasa aparte.',
    );
  } else if (!salida.includes('.')) {
    quejas.push(
      `«${salida}» no lleva extensión, así que no se sabe qué archivo hay que escribir. El montaje ` +
        'de una pieza sale en «.mp4».',
    );
  }

  comprobarFormato(manifiesto.formato, quejas);

  const video = comprobarVideo(manifiesto.video, quejas);
  const previas = comprobarCapasPrevias(manifiesto.capas_previas, quejas);

  if (!video.length && !previas.length) {
    quejas.push(
      'No hay nada que montar: el manifiesto no trae ni un solo plano en «video» ni ninguna capa ya ' +
        'montada en «capas_previas».',
    );
  }
  if (video.length && previas.length) {
    quejas.push(
      'El manifiesto trae a la vez planos en «video» y capas ya montadas en «capas_previas», y así ' +
        'no se sabe qué va antes. Un montaje de capa «escena» o «pieza» lleva sus planos; uno de ' +
        'capa «acto» o «episodio» solo concatena lo ya montado y, como mucho, le pone su audio ' +
        'encima.',
    );
  }

  if (video.length) comprobarAcabado(manifiesto.acabado, quejas);

  const audio = comprobarAudio(manifiesto.audio, quejas);
  const silencios = comprobarSilencios(manifiesto.silencios, quejas);
  const subtitulos = comprobarSubtitulos(manifiesto.subtitulos, quejas);
  const cartela = comprobarCartela(manifiesto.cartela, quejas);

  comprobarQueNoSePisaLaEntrada(salida, video, audio, previas, quejas);
  comprobarLaLineaDeTiempo(video, quejas);
  comprobarQueNadaSeSaleDeLaPieza(
    { video, audio, silencios, subtitulos, cartela, hayPrevias: previas.length > 0 },
    quejas,
  );

  if (quejas.length) {
    throw new ErrorDeCara(
      'El manifiesto de montaje no está bien y no se ha encargado nada, así que no se ha gastado ' +
        `tiempo de máquina. ${quejas.length === 1 ? 'Esto es lo que falla' : 'Esto es todo lo que falla'}:\n` +
        quejas.map((q) => `· ${q}`).join('\n'),
      { reintentable: false, http: 400 },
    );
  }

  return trabajo;
}

/** El formato de salida: sin él no se sabe ni a qué tamaño se monta. */
function comprobarFormato(formato, quejas) {
  if (!formato || typeof formato !== 'object' || Array.isArray(formato)) {
    quejas.push(
      'Falta el formato de salida («formato»), que dice a qué tamaño y a cuántos fotogramas por ' +
        'segundo se monta. Sale de «formato» en datos/serie.json: 1920 × 1080 a 24 fps.',
    );
    return;
  }
  for (const campo of ['ancho', 'alto', 'fps']) {
    const valor = numero(formato[campo]);
    if (valor === null || valor <= 0 || !Number.isInteger(valor)) {
      quejas.push(
        `El formato de salida no dice «${campo}», o no es un número entero mayor que cero. Sale de ` +
          '«formato» en datos/serie.json.',
      );
    }
  }
}

/** El acabado, que es lo que separa esto de un vídeo de IA. */
function comprobarAcabado(acabado, quejas) {
  if (!acabado || typeof acabado !== 'object' || Array.isArray(acabado)) {
    quejas.push(
      'Falta el acabado («acabado»), que es la cadena de ffmpeg con el paso de dos, la aberración ' +
        'cromática, la halación, el grano y la viñeta. Sin él el montaje sale con cara de vídeo de ' +
        'IA. Está escrito en «piezas[…].acabado.cadena_ffmpeg» de datos/serie.json.',
    );
    return;
  }
  if (!String(acabado.cadena ?? '').trim()) {
    quejas.push(
      'El acabado viene sin su cadena de ffmpeg («acabado.cadena»). Se copia literal de ' +
        '«piezas[…].acabado.cadena_ffmpeg» en datos/serie.json: se mira una vez, se ajusta, y no se ' +
        'toca más en toda la serie.',
    );
  }
  if (acabado.paso_de_dos !== undefined && !Array.isArray(acabado.paso_de_dos)) {
    quejas.push(
      'El paso de dos («acabado.paso_de_dos») tiene que ser una lista con los planos que van a doce ' +
        'fotogramas. Los de cámara sobre fondo van a veinticuatro limpios, como en un anime de ' +
        'verdad.',
    );
  }
}

/** Los planos. Cada uno con su origen y su tramo. */
function comprobarVideo(video, quejas) {
  if (video === undefined || video === null) return [];
  if (!Array.isArray(video)) {
    quejas.push('«video» tiene que ser una lista de planos, uno por cada clip que entra en el montaje.');
    return [];
  }

  const limpios = [];
  const vistos = new Set();

  video.forEach((entrada, i) => {
    const cual = nombreDeEntrada(entrada, i, video.length, 'el plano');

    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
      quejas.push(`No se entiende ${cual}: se esperaba un plano con su origen y sus segundos.`);
      return;
    }

    const origen = comprobarOrigen(entrada.origen, cual, quejas);
    const tramo = comprobarTramo(entrada, cual, quejas);

    const id = String(entrada.id ?? '').trim();
    if (id) {
      if (vistos.has(id)) {
        quejas.push(
          `Hay dos planos llamados «${id}». Los identificadores nombran también qué planos llevan ` +
            'paso de dos, así que repetirlos deja el acabado a medias.',
        );
      }
      vistos.add(id);
    }

    if (origen && tramo) limpios.push({ ...tramo, id: id || cual, origen });
  });

  return limpios;
}

/** Las pistas de audio. */
function comprobarAudio(audio, quejas) {
  if (audio === undefined || audio === null) return [];
  if (!Array.isArray(audio)) {
    quejas.push('«audio» tiene que ser una lista de pistas: la música, el ambiente y las voces.');
    return [];
  }

  const limpias = [];

  audio.forEach((entrada, i) => {
    const cual = nombreDeEntrada(entrada, i, audio.length, 'la pista de audio');

    if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
      quejas.push(`No se entiende ${cual}: se esperaba una pista con su origen y sus segundos.`);
      return;
    }

    const pista = String(entrada.pista ?? '').trim();
    if (!pista) {
      quejas.push(
        `${primeraMayuscula(cual)} no dice de qué pista es. La música y el ambiente se agachan bajo ` +
          `cada línea de voz, así que hay que saber cuál es cuál: ${enLista(PISTAS)}.`,
      );
    } else if (!PISTAS.includes(pista)) {
      quejas.push(
        `${primeraMayuscula(cual)} dice ser de la pista «${pista}», que el montador no sabe qué es. ` +
          `Las pistas son ${enLista(PISTAS)}.`,
      );
    }

    const origen = comprobarOrigen(entrada.origen, cual, quejas);
    const tramo = comprobarTramo(entrada, cual, quejas);

    if (entrada.ganancia_db !== undefined && entrada.ganancia_db !== null &&
        numero(entrada.ganancia_db) === null) {
      quejas.push(
        `${primeraMayuscula(cual)} trae una ganancia («ganancia_db») que no es un número de ` +
          'decibelios.',
      );
    }
    if (entrada.agacha !== undefined && entrada.agacha !== null && typeof entrada.agacha !== 'boolean') {
      quejas.push(
        `${primeraMayuscula(cual)} tiene que decir con un sí o un no («agacha») si se agacha bajo ` +
          'las voces.',
      );
    }

    if (origen && tramo) {
      limpias.push({
        ...tramo,
        // El nombre con el que se hablará de ella si se sale de la pieza.
        id: `la pista de ${nombreDePista(pista)} ${i + 1} de ${audio.length}`,
        pista,
        origen,
      });
    }
  });

  return limpias;
}

/** Los silencios absolutos: pares [desde, hasta]. */
function comprobarSilencios(silencios, quejas) {
  if (silencios === undefined || silencios === null) return [];
  if (!Array.isArray(silencios)) {
    quejas.push(
      '«silencios» tiene que ser una lista de pares [desde, hasta]: los tramos en los que no suena ' +
        'absolutamente nada.',
    );
    return [];
  }

  const limpios = [];

  silencios.forEach((par, i) => {
    const cual = `el silencio ${i + 1} de ${silencios.length}`;
    if (!Array.isArray(par) || par.length !== 2) {
      quejas.push(`${primeraMayuscula(cual)} no es un par [desde, hasta].`);
      return;
    }
    const desde = numero(par[0]);
    const hasta = numero(par[1]);
    if (desde === null || hasta === null) {
      quejas.push(`${primeraMayuscula(cual)} no tiene bien escritos sus dos segundos.`);
      return;
    }
    if (desde < 0) {
      quejas.push(`${primeraMayuscula(cual)} empieza antes del principio (${segundos(desde)}).`);
      return;
    }
    if (hasta <= desde + MARGEN_S) {
      quejas.push(
        `${primeraMayuscula(cual)} no dura nada: empieza en ${segundos(desde)} y acaba en ` +
          `${segundos(hasta)}.`,
      );
      return;
    }
    limpios.push({ id: cual, en: desde, fin: hasta });
  });

  return limpios;
}

/**
 * Los subtítulos, que se queman en la imagen. Aquí está el último cerrojo de un
 * invariante de la serie: en pantalla no hay ni una palabra en japonés. El
 * japonés únicamente se oye. Si un texto japonés llegara hasta aquí, se quedaría
 * quemado en el vídeo y solo se vería mirándolo.
 */
function comprobarSubtitulos(subtitulos, quejas) {
  if (subtitulos === undefined || subtitulos === null) return [];
  if (!Array.isArray(subtitulos)) {
    quejas.push('«subtitulos» tiene que ser una lista de líneas con sus segundos y su texto.');
    return [];
  }

  const limpios = [];

  subtitulos.forEach((linea, i) => {
    const cual = `el subtítulo ${i + 1} de ${subtitulos.length}`;

    if (!linea || typeof linea !== 'object' || Array.isArray(linea)) {
      quejas.push(`No se entiende ${cual}.`);
      return;
    }

    const desde = numero(linea.desde);
    const hasta = numero(linea.hasta);
    const texto = String(linea.texto ?? '').trim();

    if (!texto) {
      quejas.push(`${primeraMayuscula(cual)} no trae texto.`);
    } else if (JAPONES.test(texto)) {
      quejas.push(
        `${primeraMayuscula(cual)} está en japonés («${recorte(texto, 60)}»), y los subtítulos se ` +
          'queman en la imagen: en pantalla solo hay español, el japonés únicamente se oye. El ' +
          'texto español de cada línea está en la pieza, en datos/serie.json.',
      );
    }

    if (desde === null || hasta === null) {
      quejas.push(
        `${primeraMayuscula(cual)} no tiene bien escritos sus segundos de entrada y salida. Salen ` +
          'medidos del audio de verdad, no estimados.',
      );
      return;
    }
    if (desde < 0) {
      quejas.push(`${primeraMayuscula(cual)} entra antes del principio (${segundos(desde)}).`);
      return;
    }
    if (hasta <= desde) {
      quejas.push(
        `${primeraMayuscula(cual)} sale (${segundos(hasta)}) antes de entrar (${segundos(desde)}), ` +
          'así que no llegaría a leerse.',
      );
      return;
    }

    limpios.push({ id: cual, en: desde, fin: hasta });
  });

  return limpios;
}

/** La cartela final. Mismo cerrojo del japonés que en los subtítulos. */
function comprobarCartela(cartela, quejas) {
  if (cartela === undefined || cartela === null) return null;
  if (typeof cartela !== 'object' || Array.isArray(cartela)) {
    quejas.push('«cartela» tiene que ser el rótulo final: cuándo entra, cuánto dura y qué dice.');
    return null;
  }

  const en = numero(cartela.en);
  const dur = numero(cartela.dur);
  const texto = String(cartela.texto ?? '').trim();

  if (!texto) {
    quejas.push('La cartela no dice qué texto lleva.');
  } else if (JAPONES.test(texto)) {
    quejas.push(
      `La cartela está en japonés («${recorte(texto, 60)}»), y se quema en la imagen: en pantalla ` +
        'solo hay español. El texto español de la cartela está en «cartela» de datos/serie.json, en ' +
        'su campo «es».',
    );
  }

  if (en === null || en < 0) {
    quejas.push('La cartela no dice en qué segundo entra, o entra antes del principio.');
    return null;
  }
  if (dur === null || dur <= 0) {
    quejas.push('La cartela no dice cuánto dura, o dura cero.');
    return null;
  }
  if (cartela.fundido !== undefined && cartela.fundido !== null) {
    const fundido = numero(cartela.fundido);
    if (fundido === null || fundido < 0) {
      quejas.push('El fundido de la cartela («fundido») no es un número de segundos.');
    } else if (fundido * 2 > dur + MARGEN_S) {
      quejas.push(
        `La cartela dura ${segundos(dur)} y sus fundidos de entrada y salida suman ` +
          `${segundos(fundido * 2)}: no le queda ni un instante quieta para leerla.`,
      );
    }
  }

  return { id: 'la cartela', en, fin: en + dur };
}

/** Las capas ya montadas que solo se concatenan. */
function comprobarCapasPrevias(previas, quejas) {
  if (previas === undefined || previas === null) return [];
  if (!Array.isArray(previas)) {
    quejas.push(
      '«capas_previas» tiene que ser una lista de rutas: los archivos ya montados que se concatenan ' +
        'tal cual.',
    );
    return [];
  }

  const limpias = [];
  previas.forEach((ruta, i) => {
    const cual = `la capa ya montada ${i + 1} de ${previas.length}`;
    const limpia = String(ruta ?? '').trim();
    if (!esRutaLogica(limpia)) {
      quejas.push(
        `${primeraMayuscula(cual)} no es una ruta del proyecto («${limpia || 'vacía'}»). Van en ` +
          'rutas lógicas, como «montaje/ep01-acto1.mp4».',
      );
      return;
    }
    if (limpias.includes(limpia)) {
      quejas.push(`La capa «${limpia}» está dos veces en «capas_previas», así que saldría repetida.`);
      return;
    }
    limpias.push(limpia);
  });

  return limpias;
}

/**
 * Toda entrada tiene origen. Es la regla de docs/contrato.md §7 y también la
 * razón de ser del montador: no conoce ningún archivo por su nombre, así que un
 * plano sin origen no es un plano al que le falte un dato, es un plano que no
 * existe para él.
 */
function comprobarOrigen(valor, cual, quejas) {
  const origen = String(valor ?? '').trim();

  if (!origen) {
    quejas.push(
      `${primeraMayuscula(cual)} no dice de qué archivo sale («origen»). El montador no conoce ` +
        'ningún archivo por su nombre: todo lo que tiene que usar llega escrito en el manifiesto.',
    );
    return null;
  }

  if (!esRutaLogica(origen)) {
    quejas.push(
      `${primeraMayuscula(cual)} sale de «${origen}», y eso no es una ruta del proyecto. Van en ` +
        'rutas lógicas —«veo/teaser/A1/1/xxx.mp4», «audio/voz/teaser/madre.wav»—, sin «gs://», sin ' +
        '«https://» y sin barra al principio: el bucket y la carpeta se los pone el montador con lo ' +
        'que se le pasa aparte.',
    );
    return null;
  }

  return origen;
}

/** El tramo de una entrada: de dónde a dónde se corta y en qué segundo entra. */
function comprobarTramo(entrada, cual, quejas) {
  const desde = numero(entrada.desde);
  const hasta = numero(entrada.hasta);
  const en = numero(entrada.en);

  if (desde === null || hasta === null || en === null) {
    quejas.push(
      `${primeraMayuscula(cual)} no tiene bien escritos sus tres segundos: «desde» y «hasta», que ` +
        'son el trozo que se coge del archivo, y «en», el segundo del montaje en el que entra.',
    );
    return null;
  }

  if (desde < 0) {
    quejas.push(
      `${primeraMayuscula(cual)} empieza a cortar en ${segundos(desde)}, antes del principio de su ` +
        'archivo.',
    );
    return null;
  }

  if (hasta <= desde) {
    quejas.push(
      `${primeraMayuscula(cual)} acaba (${segundos(hasta)}) antes de empezar (${segundos(desde)}), ` +
        'así que no se cogería nada de él.',
    );
    return null;
  }

  if (en < 0) {
    quejas.push(
      `${primeraMayuscula(cual)} entra en el segundo ${segundos(en)}, antes del principio del ` +
        'montaje.',
    );
    return null;
  }

  return { en, fin: en + (hasta - desde) };
}

/** Montar encima de un material que se está leyendo lo destruye a mitad. */
function comprobarQueNoSePisaLaEntrada(salida, video, audio, previas, quejas) {
  if (!salida) return;
  const entradas = [
    ...video.map((v) => v.origen),
    ...audio.map((a) => a.origen),
    ...previas,
  ];
  if (entradas.includes(salida)) {
    quejas.push(
      `El resultado se guardaría en «${salida}», que es uno de los archivos que el montaje usa como ` +
        'material. Escribir encima de lo que se está leyendo destroza las dos cosas: ponle otro ' +
        'nombre a la salida.',
    );
  }
}

/**
 * La línea de tiempo del vídeo no tiene huecos ni solapes. Es uno de los
 * invariantes de la serie, y este es su segundo cerrojo: el primero lo pone
 * herramientas/invariantes.mjs sobre los datos, y aquí se vuelve a mirar sobre lo
 * que de verdad se va a montar.
 *
 * Un solape sería dos planos a la vez —el montador no compone, corta— y un hueco
 * sería un negro en medio que nadie ha pedido.
 */
function comprobarLaLineaDeTiempo(video, quejas) {
  if (video.length < 2) return;

  const orden = [...video].sort((a, b) => a.en - b.en);

  for (let i = 1; i < orden.length; i += 1) {
    const anterior = orden[i - 1];
    const actual = orden[i];

    if (actual.en < anterior.fin - MARGEN_S) {
      quejas.push(
        `Se solapan ${anterior.id} y ${actual.id}: el primero acaba en ${segundos(anterior.fin)} y ` +
          `el segundo entra en ${segundos(actual.en)}. Dos planos no pueden estar en pantalla a la ` +
          'vez.',
      );
      continue;
    }

    if (actual.en > anterior.fin + MARGEN_S) {
      quejas.push(
        `Queda un hueco de ${segundos(actual.en - anterior.fin)} entre ${anterior.id}, que acaba en ` +
          `${segundos(anterior.fin)}, y ${actual.id}, que entra en ${segundos(actual.en)}. La línea ` +
          'de tiempo de una pieza no tiene huecos: ahí saldría un negro que nadie ha pedido.',
      );
    }
  }
}

/**
 * Ningún tramo se sale de la pieza.
 *
 * La pieza dura lo que dura su vídeo: desde cero hasta donde acaba el último
 * plano. Todo lo demás —música, voces, silencios, subtítulos y cartela— tiene
 * que caber dentro. Un subtítulo que entra después del último fotograma no se
 * lee nunca, y una pista que sigue sonando cuando ya no hay imagen no se oye:
 * las dos cosas se ven al montar, tarde, y las dos se ven aquí, gratis.
 *
 * Cuando el montaje solo concatena capas ya montadas no se sabe cuánto va a
 * durar —las duraciones están dentro de esos archivos, no en el manifiesto—, así
 * que ahí esta comprobación no se hace y se dice por qué.
 */
function comprobarQueNadaSeSaleDeLaPieza(partes, quejas) {
  if (!partes.video.length) return;   // solo concatena: la duración no se conoce aquí
  if (partes.hayPrevias) return;

  const fin = partes.video.reduce((mayor, plano) => Math.max(mayor, plano.fin), 0);

  const revisar = (lista) => {
    for (const tramo of lista) {
      // Primero el caso peor y más claro de contar: lo que entra cuando ya no
      // queda pieza no se ve ni se oye en absoluto.
      if (tramo.en > fin + MARGEN_S) {
        quejas.push(
          `${primeraMayuscula(tramo.id)} entra en ${segundos(tramo.en)}, cuando la pieza ya ha ` +
            `terminado (dura ${segundos(fin)}), así que no llegaría a verse ni a oírse.`,
        );
      } else if (tramo.fin > fin + MARGEN_S) {
        quejas.push(
          `${primeraMayuscula(tramo.id)} acaba en ${segundos(tramo.fin)} y la pieza dura ` +
            `${segundos(fin)}: se sale por ${segundos(tramo.fin - fin)}.`,
        );
      }
    }
  };

  revisar(partes.audio);
  revisar(partes.silencios);
  revisar(partes.subtitulos);
  if (partes.cartela) revisar([partes.cartela]);
}

// ---------------------------------------------------------------------------
// Rutas y auxiliares
// ---------------------------------------------------------------------------

/** `montaje/{trabajo}/manifiesto.json` */
function rutaDelManifiesto(trabajo) {
  return `${CARPETA}/${trabajo}/manifiesto.json`;
}

/** `montaje/{trabajo}/queja.txt` — lo que el montador escribe antes de salir mal. */
function rutaDeLaQueja(trabajo) {
  return `${CARPETA}/${trabajo}/queja.txt`;
}

/** `montaje/ejecuciones/{id}.txt` — a qué trabajo pertenece cada ejecución. */
function rutaDelIndice(id) {
  return `${CARPETA_DE_EJECUCIONES}/${id}.txt`;
}

/** La URL de un recurso de Cloud Run a partir de su nombre completo. */
function urlDeRecurso(nombre) {
  const conRegion = /\/locations\/([^/]+)/.exec(nombre);
  const region = conRegion ? String(conRegion[1]).trim().toLowerCase() : '';

  if (!NOMBRE_DE_REGION.test(region)) {
    throw new ErrorDeCara(
      `«${nombre}» no dice en qué región se está haciendo el montaje, y un trabajo de Cloud Run solo ` +
        'se puede consultar donde se creó. El nombre bueno es el completo, el que devolvió Google al ' +
        'encargar el montaje.',
      { reintentable: false, http: 400 },
    );
  }

  return urlServicio(`${region}-${HOST_RUN}`, `v2/${nombre.replace(/^\/+/, '')}`);
}

/** Un nombre de trabajo acaba siendo una carpeta del bucket. */
function esNombreDeTrabajo(valor) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(valor ?? '')) && !String(valor).includes('..');
}

/**
 * Una ruta lógica del proyecto. Ni «gs://», ni «https://», ni barra al
 * principio, ni «..»: el bucket y el prefijo los pone quien la usa, aquí y en el
 * montador, y nadie más.
 */
function esRutaLogica(valor) {
  const ruta = String(valor ?? '').trim();
  if (!ruta || ruta.startsWith('/') || ruta.endsWith('/')) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(ruta)) return false;
  if (ruta.split('/').includes('..')) return false;
  return true;
}

/**
 * Cómo se nombra una entrada del manifiesto cuando hay que hablar de ella. La
 * etiqueta llega con su artículo puesto («el plano», «la pista de audio»)
 * porque en español el género lo lleva la palabra, no el sitio.
 */
function nombreDeEntrada(entrada, i, total, etiqueta) {
  const id = entrada && typeof entrada === 'object' ? String(entrada.id ?? '').trim() : '';
  return id ? `${etiqueta} «${id}»` : `${etiqueta} ${i + 1} de ${total}`;
}

/** Cómo se llama cada pista cuando hay que nombrarla en una frase. */
function nombreDePista(pista) {
  if (pista === 'musica') return 'música';
  return pista || 'audio';
}

/** Un número de verdad, o null. */
function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** Un contador de Cloud Run, que puede no venir. */
function entero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/** «3,5 s», «4 s». Los segundos se escriben con coma, como en español. */
function segundos(s) {
  const redondeado = Math.round(Number(s) * 1000) / 1000;
  const texto = Number.isInteger(redondeado)
    ? String(redondeado)
    : String(redondeado).replace('.', ',');
  return `${texto} s`;
}

/** «1 tarea», «3 tareas». Contar en español lleva su singular y su plural. */
function cantidad(n, uno, varios) {
  return n === 1 ? `1 ${uno}` : `${n} ${varios}`;
}

/** «escena, acto, episodio o pieza» */
function enLista(valores) {
  if (valores.length === 1) return valores[0];
  return `${valores.slice(0, -1).join(', ')} o ${valores[valores.length - 1]}`;
}

/** Lo que dice una condición de Cloud Run, con su motivo si lo trae. */
function textoDeCondicion(condicion) {
  const trozos = [];
  const mensaje = String(condicion.message ?? '').trim();
  const motivo = String(condicion.reason ?? condicion.executionReason ?? '').trim();
  if (mensaje) trozos.push(mensaje);
  if (motivo && motivo !== mensaje) trozos.push(motivo);
  return trozos.length ? recorte(trozos.join(' · '), 800) : null;
}

/** Lo que contestó Google, para `detalle`, sin que un ciclo tumbe el error. */
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

function recorte(texto, maximo) {
  const t = String(texto);
  return t.length <= maximo ? t : `${t.slice(0, maximo)}…`;
}

function primeraMayuscula(t) {
  return t.length ? t[0].toUpperCase() + t.slice(1) : t;
}
