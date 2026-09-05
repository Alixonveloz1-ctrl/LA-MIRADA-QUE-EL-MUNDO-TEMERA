// Salud — la pantalla que responde de una vez qué tiene permitido esta cuenta.
//
// Es la primera que hay que mirar y la única que no depende de que nada esté
// generado todavía: dice si Google acepta la identificación, si el bucket se lee
// y se escribe, qué modelos contestan, y cuánto está pesando cada respuesta.
// Hasta que esto no está entero en verde no se sigue (docs/parche-despliegue.md
// §10).
//
// CUATRO COSAS QUE SOLO SE PUEDEN VER AQUÍ, Y POR QUÉ ESTÁN AQUÍ
//
//   1. LA CUENTA, ENMASCARADA. El repositorio es público y esta pantalla se abre
//      en un teléfono en cualquier sitio: el correo, el proyecto y el bucket
//      llegan ya recortados desde `enmascarar()` en la función. Aquí no se
//      desenmascara nada, no se guarda nada y no se copia nada de eso al
//      portapapeles. Basta para reconocerlos; no llega para usarlos.
//
//   2. CADA MODELO CON SU REGIÓN Y SU VARIABLE. Ningún id de modelo está escrito
//      en el código: salen de datos/serie.json y cada uno se enseña con la
//      variable de entorno que lo sustituye sin tocar una línea. Cuando uno
//      falla se enseña lo que dijo Google **literal**, plegado, porque traducir a
//      Google es mentir y porque nueve errores largos abiertos no caben en una
//      pantalla de teléfono.
//
//   3. EL CORS DEL BUCKET, COMPROBADO DE VERDAD DESDE EL NAVEGADOR. Desde el
//      servidor el bucket se lee igual con CORS que sin él; quien se estrella sin
//      CORS es el navegador, y lo hace mucho más tarde, al reducir un master a
//      1280 px antes de mandarlo a Veo — con un error de consola que no menciona
//      CORS por ninguna parte. Así que la función deja un PNG de un píxel en el
//      bucket y aquí se le hace un `fetch` de verdad, leyendo los bytes, que es
//      exactamente lo que hace `app/imagen.js` cuando reduce. Si falla, se dice
//      con todas las letras qué falta, qué deja de funcionar sin ello, y se
//      enseña el JSON que hay que aplicar con un botón para copiarlo.
//
//   4. LOS PESOS MEDIDOS. El tope de la plataforma son 4,5 MB por respuesta y
//      pasarse no parece un exceso de tamaño: parece un tiempo agotado. Ese fallo
//      no se ve razonando sobre el código, se ve midiendo. La función pone
//      `X-Peso-Respuesta` en todas las respuestas, el navegador se queda con el
//      máximo por modo y aquí se enseña contra el tope. Es la prueba del
//      invariante, no una curiosidad.
//
// Y una frase que se repite a propósito junto a todo lo que falte: Vercel no
// aplica una variable nueva a un despliegue ya construido. Sin decirlo, se busca
// el fallo donde no está.

import { llamar, pesos } from '../api.js';
import { actual, alCambiar } from '../estado.js';
import { h, pantalla, seccion, tarjeta, boton, aviso, espera, vaciar } from '../ui.js';
import { bytes, fecha, porcentaje, plural } from '../formato.js';

// ---------------------------------------------------------------------------
// Constantes de la pantalla
// ---------------------------------------------------------------------------

/**
 * El tope de la plataforma, en bytes: 4,5 MB de petición Y de respuesta.
 *
 * No es un dato de la serie ni de la cuenta —no sale de serie.json ni de una
 * variable— sino el límite de Vercel, y por eso está escrito aquí. `bytes()` usa
 * múltiplos de 1024, así que este número se lee en pantalla exactamente como
 * «4,5 MB», que es como lo escribe la documentación.
 */
const TOPE_RESPUESTA = 4.5 * 1024 * 1024;

/** A partir de esta parte del tope, un modo ya se pinta como aviso. */
const PARTE_QUE_PREOCUPA = 0.9;

/** Cada cuánto se refresca el «comprobado hace…» sin volver a preguntar nada. */
const REFRESCO_DEL_RELOJ_MS = 30000;

/** Cuánto se queda un botón de copiar diciendo que ya copió. */
const AVISO_DE_COPIA_MS = 2500;

/**
 * La frase que hay que decir junto a cada variable que falte. Está escrita una
 * sola vez para que sea idéntica en los cinco sitios donde aparece: es la trampa
 * que más tiempo hace perder de todo el despliegue.
 */
const REDESPLIEGUE =
  '¿La acabas de añadir? Vercel necesita un Redeploy: no aplica una variable nueva a un despliegue ' +
  'ya construido. Deployments → los tres puntos del último → Redeploy.';

/** Cómo se llama en pantalla cada familia de modelos. */
const FAMILIAS = {
  imagen: 'Imagen',
  veo: 'Vídeo',
  tts: 'Voz',
  musica: 'Música',
  texto: 'Texto',
  stt: 'Alineación',
};

/** Cómo se escribe cada nivel. El de los datos va sin tilde; en pantalla lleva. */
const NIVELES = {
  calidad: 'calidad',
  medio: 'medio',
  economico: 'económico',
};

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

export default {
  id: 'salud',
  titulo: 'Salud',
  icono: '\u{1FA7A}',

  /**
   * Pinta la pantalla dentro de `raiz` y devuelve cómo desmontarla.
   * @param {HTMLElement} raiz
   * @returns {Promise<() => void>}
   */
  async montar(raiz) {
    // Si el usuario se va a otra pestaña mientras se comprueba, lo que llegue
    // tarde no debe pintar nada: la pantalla ya no está.
    let vivo = true;
    let comprobando = false;

    // El hueco de cada sección, para repintar solo lo que cambia. Van con la
    // clase «rejilla» para que las tarjetas de dentro se repartan en dos columnas
    // cuando el teléfono se tumba, igual que si colgaran de la sección.
    const huecos = {
      variables: h('div', { clase: 'rejilla' }),
      cuenta: h('div', { clase: 'rejilla' }),
      bucket: h('div', { clase: 'rejilla' }),
      cors: h('div', { clase: 'rejilla' }),
      modelos: h('div', { clase: 'rejilla' }),
      voces: h('div', { clase: 'rejilla' }),
      montaje: h('div', { clase: 'rejilla' }),
      pesos: h('div', { clase: 'rejilla' }),
    };

    /** Cuándo se hizo la última comprobación, para el «comprobado hace…». */
    let cuando = null;
    const reloj = h('p', { clase: 'tenue' }, 'Sin comprobar todavía.');

    const botonDeComprobar = boton('Volver a comprobar', () => comprobar(), {
      tono: 'principal',
    });

    const cuerpo = pantalla(
      'Salud',
      h('p', { clase: 'suave' },
        'Qué modelos tiene permitidos esta cuenta, si el bucket contesta y cuánto pesa cada ' +
        'respuesta. Nada de lo que hay aquí gasta una generación: a cada modelo se le manda la ' +
        'petición más barata que demuestra acceso.'),
      seccion('Las variables', huecos.variables),
      seccion('La cuenta', huecos.cuenta),
      seccion('El bucket', huecos.bucket),
      seccion('CORS del bucket', huecos.cors),
      seccion('Los modelos', huecos.modelos),
      seccion('Las voces', huecos.voces),
      seccion('El montador', huecos.montaje),
      seccion('Lo que ha pesado cada respuesta', huecos.pesos),
      seccion(null, reloj, h('div', { clase: 'tarjeta-acciones' }, botonDeComprobar)),
    );

    raiz.appendChild(cuerpo);

    // Los pesos no dependen de la comprobación: se leen del estado y de lo que
    // lleva medido esta sesión, así que se pintan ya y se repintan solos cada vez
    // que alguien escribe el estado.
    pintarPesos(huecos.pesos);
    const desuscribir = alCambiar(() => {
      if (vivo) pintarPesos(huecos.pesos);
    });

    const tic = setInterval(() => {
      if (vivo) refrescarElReloj();
    }, REFRESCO_DEL_RELOJ_MS);

    /** «Comprobado hace 2 min», sin volver a preguntar nada a nadie. */
    function refrescarElReloj() {
      if (!cuando) return;
      vaciar(reloj);
      reloj.appendChild(document.createTextNode(`Comprobado ${fecha(cuando)}.`));
    }

    /**
     * Pregunta por todo y repinta. Es lo que hace el botón de volver a
     * comprobar, y lo que se hace solo al entrar.
     * @returns {Promise<void>}
     */
    async function comprobar() {
      if (comprobando) return;
      comprobando = true;
      botonDeComprobar.textContent = 'Comprobando…';

      for (const clave of ['cuenta', 'bucket', 'cors', 'modelos', 'voces', 'montaje']) {
        vaciar(huecos[clave]);
      }
      huecos.cuenta.appendChild(espera('Preguntando a Google por la cuenta y por cada modelo…'));

      try {
        let datos = null;
        let fallo = null;
        try {
          datos = await llamar('salud');
        } catch (error) {
          fallo = error;
        }

        if (!vivo) return;

        cuando = new Date().toISOString();
        refrescarElReloj();
        vaciar(huecos.cuenta);

        if (fallo) {
          pintarElFalloEntero(huecos.cuenta, fallo);
          for (const clave of ['bucket', 'cors', 'modelos', 'voces', 'montaje', 'variables']) {
            vaciar(huecos[clave]).appendChild(
              h('p', { clase: 'tenue' },
                'No se ha podido comprobar: la comprobación no ha llegado a contestar.'));
          }
          return;
        }

        pintarVariables(huecos.variables, datos);
        pintarCuenta(huecos.cuenta, datos);
        pintarBucket(huecos.bucket, datos);
        pintarModelos(huecos.modelos, datos);
        pintarVoces(huecos.voces, datos);
        pintarMontaje(huecos.montaje, datos);

        // El CORS lo comprueba el navegador por su cuenta, con la URL firmada
        // que acaba de llegar. Va después de pintar todo lo demás para que la
        // pantalla no se quede esperando a un `fetch` que puede tardar.
        await pintarCors(huecos.cors, datos, () => vivo);
      } finally {
        // Pase lo que pase, el botón vuelve a estar disponible: una pantalla de
        // Salud con el botón encallado en «Comprobando…» es un callejón, porque
        // esta es justo la pantalla a la que se viene cuando algo va mal.
        comprobando = false;
        botonDeComprobar.textContent = 'Volver a comprobar';
      }
    }

    // Se lanza sin esperarla: así la pantalla aparece entera y con su rueda en
    // vez de quedarse en blanco los veinte segundos que puede tardar la
    // comprobación de los nueve modelos.
    comprobar().catch((fallo) => {
      if (!vivo) return;
      vaciar(huecos.cuenta);
      pintarElFalloEntero(huecos.cuenta, fallo);
    });

    return () => {
      vivo = false;
      clearInterval(tic);
      desuscribir();
    };
  },
};

// ---------------------------------------------------------------------------
// La cuenta
// ---------------------------------------------------------------------------

/**
 * Quién es esta instalación: la service account, el proyecto, el bucket y el
 * prefijo, todos ya enmascarados en origen, y si Google acepta la
 * identificación.
 * @param {HTMLElement} hueco
 * @param {object} datos lo que devolvió el modo `salud`
 */
function pintarCuenta(hueco, datos) {
  const cuenta = objeto(datos.cuenta);
  const credenciales = objeto(datos.credenciales);
  const identificada = credenciales.ok !== false;

  const filas = [
    dato('Service account', cuenta.correo, {
      mono: true,
      nota: 'Va enmascarada: llega ya recortada desde la función y nunca sale entera de ahí. ' +
        'El JSON completo vive en la variable GCP_SERVICE_ACCOUNT.',
      falta: 'No hay service account puesta. Sin ella no se puede hacer absolutamente nada: ' +
        `el JSON entero va en la variable GCP_SERVICE_ACCOUNT. ${REDESPLIEGUE}`,
    }),
    dato('Project id', cuenta.proyecto, {
      mono: true,
      nota: 'Sale del propio JSON de la service account, nunca de una constante ni de otra variable.',
      falta: 'La service account no trae project_id dentro, así que no se sabe a qué proyecto ' +
        'llamar. Vuelve a pegar el JSON entero en GCP_SERVICE_ACCOUNT.',
    }),
    dato('Bucket', cuenta.bucket, {
      mono: true,
      nota: 'Variable GCS_BUCKET, sin «gs://» delante.',
      falta: `No hay bucket puesto. Va en la variable GCS_BUCKET, sin «gs://». ${REDESPLIEGUE}`,
    }),
    dato('Prefijo', cuenta.prefijo, {
      mono: true,
      nota: 'Variable GCS_PREFIX: la carpeta del proyecto dentro del bucket.',
      vacio: 'Ninguno: se trabaja en la raíz del bucket',
    }),
  ];

  hueco.appendChild(tarjeta({
    titulo: 'Quién es esta instalación',
    estado: identificada ? 'listo' : 'fallido',
    pie: h('div', null,
      h('dl', { estilo: estiloDeLista() }, filas),
      h('p', { clase: identificada ? 'suave' : null, estilo: { margin: '12px 0 0' } },
        identificada
          ? 'Google acepta la identificación de esta cuenta: la clave privada firma y el token se ' +
            'canjea. Lo que falle a partir de aquí es del modelo o del bucket, no de la cuenta.'
          : 'Google NO acepta la identificación de esta cuenta, así que todo lo de abajo falla por ' +
            'lo mismo y no hay que arreglarlo de uno en uno.'),
      credenciales.ok === false && credenciales.error
        ? plegado('Ver lo que ha contestado Google, palabra por palabra', credenciales.error)
        : null,
      credenciales.ok === false
        ? h('p', { clase: 'tenue', estilo: { margin: '8px 0 0' } }, REDESPLIEGUE)
        : null),
  }));
}

// ---------------------------------------------------------------------------
// El bucket
// ---------------------------------------------------------------------------

/**
 * Si el bucket se lee y se escribe de verdad. No basta con listar: el estado, el
 * banco y los montajes se escriben.
 * @param {HTMLElement} hueco
 * @param {object} datos
 */
function pintarBucket(hueco, datos) {
  const bucket = objeto(datos.bucket);
  const escribe = bucket.escritura === true;
  const lee = bucket.lectura === true;
  const bien = escribe && lee;

  hueco.appendChild(tarjeta({
    titulo: 'Lectura y escritura',
    estado: bien ? 'listo' : 'fallido',
    pie: h('div', null,
      h('dl', { estilo: estiloDeLista() },
        dato('Escritura', escribe ? 'Sí' : 'No', {
          color: escribe ? 'var(--listo)' : 'var(--fallido)',
          nota: 'Se escribe un archivo de prueba de verdad. El estado de la producción vive aquí.',
        }),
        dato('Lectura', lee ? 'Sí' : 'No', {
          color: lee ? 'var(--listo)' : 'var(--fallido)',
          nota: 'Se vuelve a leer lo escrito y se comprueba que es exactamente lo mismo.',
        })),
      bien
        ? h('p', { clase: 'suave', estilo: { margin: '12px 0 0' } },
            'El bucket acepta las dos cosas, que es lo que hace falta: todo lo aprobado vive ahí y ' +
            'el navegador solo tiene copia.')
        : h('p', { estilo: { margin: '12px 0 0' } },
            'La service account necesita las dos cosas sobre este bucket. Con una sola, la ' +
            'herramienta parece funcionar y pierde el trabajo mucho más tarde.'),
      bucket.error ? plegado('Ver por qué, palabra por palabra', bucket.error) : null,
      bien ? null : h('p', { clase: 'tenue', estilo: { margin: '8px 0 0' } }, REDESPLIEGUE)),
  }));
}

// ---------------------------------------------------------------------------
// El CORS, comprobado desde aquí
// ---------------------------------------------------------------------------

/**
 * Hace el `fetch` de verdad contra la URL firmada del PNG de un píxel que la
 * función ha dejado en el bucket, leyendo los bytes. Es exactamente lo que hace
 * `app/imagen.js` al reducir un master para Veo, así que si esto pasa, aquello
 * pasa.
 *
 * @param {HTMLElement} hueco
 * @param {object} datos
 * @param {() => boolean} sigueViva
 * @returns {Promise<void>}
 */
async function pintarCors(hueco, datos, sigueViva) {
  const prueba = objeto(datos.prueba_cors);
  const origen = origenDeLaAplicacion();

  vaciar(hueco);

  if (!prueba.url) {
    hueco.appendChild(aviso(
      'No se puede comprobar el CORS del bucket porque la función no ha podido dejar ahí el ' +
      'archivo de prueba ni firmarlo. Eso es un problema del bucket, no del CORS: arréglalo ' +
      'primero, arriba, y vuelve a comprobar.',
      { tono: 'error' }));
    hueco.appendChild(bloqueDeCors(origen));
    return;
  }

  const rueda = espera('Leyendo desde el navegador un archivo del bucket…');
  hueco.appendChild(rueda);

  const resultado = await leerLaPruebaDeCors(prueba.url);
  if (!sigueViva()) return;

  vaciar(hueco);

  if (resultado.ok) {
    hueco.appendChild(aviso(
      `El bucket deja que este navegador lea sus archivos: se ha bajado el archivo de prueba ` +
      `entero (${bytes(resultado.bytes)}) desde ${origen}. Con esto, reducir un master a 1280 px ` +
      'antes de mandarlo a Veo va a funcionar.',
      { tono: 'bien' }));
    hueco.appendChild(h('details', { clase: 'aviso-detalle' },
      h('summary', { clase: 'aviso-resumen' }, 'Ver de todas formas el CORS que tiene que estar puesto'),
      bloqueDeCors(origen)));
    return;
  }

  hueco.appendChild(aviso(
    resultado.caducada
      ? 'El archivo de prueba del bucket ha contestado que el enlace ya no vale. Las URL firmadas ' +
        'caducan a las seis horas: pulsa «Volver a comprobar» para pedir una nueva. Si acaba de ' +
        'comprobarse, entonces el problema es de permisos sobre el bucket, no de CORS.'
      : 'AL BUCKET LE FALTA LA CONFIGURACIÓN DE CORS. El navegador no ha podido leer un archivo ' +
        'que sí existe en el bucket. Sin CORS no se puede reducir la imagen a 1280 px antes de ' +
        'mandarla a Veo, y sin reducirla no cabe: un PNG de 2K son unos 6,8 MB, unos 9,1 MB en ' +
        'base64, y el tope de la plataforma son 4,5 MB. Es decir: sin esto no se genera ni un ' +
        'clip. Un <img> se ve igual sin CORS —por eso el fallo aparece mucho más tarde y el ' +
        'error de consola no menciona CORS por ninguna parte—, pero leer los bytes exige permiso ' +
        'del bucket. Se arregla una vez y no se vuelve a tocar.',
    { tono: 'error', detalle: resultado.detalle }));

  hueco.appendChild(bloqueDeCors(origen));
}

/**
 * El `fetch` de verdad. Se leen los bytes a propósito: un `fetch` que solo mira
 * la cabecera no prueba nada, porque lo que se hace de verdad con un master es
 * leerlo entero para dibujarlo en un lienzo.
 *
 * @param {string} url la URL firmada del PNG de un píxel
 * @returns {Promise<{ok:boolean, bytes:number, caducada:boolean, detalle:string|null}>}
 */
async function leerLaPruebaDeCors(url) {
  let respuesta;
  try {
    respuesta = await fetch(url, { mode: 'cors', cache: 'no-store' });
  } catch (fallo) {
    // Aquí es donde aparece la falta de CORS: el `fetch` revienta sin código y
    // sin cuerpo, y el navegador no cuenta por qué.
    return {
      ok: false,
      bytes: 0,
      caducada: false,
      detalle: loQueDijo(fallo),
    };
  }

  if (!respuesta.ok) {
    const codigo = Number(respuesta.status) || 0;
    return {
      ok: false,
      bytes: 0,
      caducada: codigo === 401 || codigo === 403,
      detalle: `El bucket ha contestado con un ${codigo} al pedirle el archivo de prueba.`,
    };
  }

  try {
    const trozo = await respuesta.blob();
    return { ok: true, bytes: Number(trozo.size) || 0, caducada: false, detalle: null };
  } catch (fallo) {
    return {
      ok: false,
      bytes: 0,
      caducada: false,
      detalle: loQueDijo(fallo),
    };
  }
}

/**
 * El JSON de CORS que hay que aplicar, con el origen de esta misma aplicación ya
 * puesto dentro, y su botón de copiar.
 * @param {string} origen
 * @returns {HTMLElement}
 */
function bloqueDeCors(origen) {
  const json = JSON.stringify(
    [
      {
        origin: [origen],
        method: ['GET', 'HEAD'],
        responseHeader: ['Content-Type'],
        maxAgeSeconds: 3600,
      },
    ],
    null,
    2,
  );

  const orden = 'gcloud storage buckets update gs://TU-BUCKET --cors-file=cors.json';

  return h('div', null,
    h('p', { clase: 'suave' },
      'Guarda esto como «cors.json» y aplícalo al bucket. El origen ya es el de esta aplicación, ' +
      'el mismo que se ve en la barra de direcciones:'),
    bloqueCopiable(json, 'Copiar el JSON de CORS'),
    h('p', { clase: 'suave', estilo: { margin: '12px 0 0' } },
      'Y después, desde Cloud Shell, con el nombre de tu bucket en vez de TU-BUCKET:'),
    bloqueCopiable(orden, 'Copiar la orden'),
    h('p', { clase: 'tenue' },
      'El terminal de Cloud Shell no deja pegar desde el móvil, así que el JSON se escribe con el ' +
      'editor de Cloud Shell (el botón «Abrir editor»), que sí acepta pegar, y la orden se teclea. ' +
      'También se puede hacer desde la consola web del bucket. Se hace una vez y no se vuelve a ' +
      'tocar en toda la serie.'));
}

/** El origen de esta aplicación, que es el que tiene que ir en el CORS. */
function origenDeLaAplicacion() {
  try {
    const dicho = String(window.location.origin || '').trim();
    if (dicho && dicho !== 'null') return dicho;
  } catch {
    // Un navegador sin `location` no existe, pero si existiera, mejor una frase
    // que un «null» pegado dentro del JSON.
  }
  return 'https://TU-APLICACION.vercel.app';
}

// ---------------------------------------------------------------------------
// Los modelos
// ---------------------------------------------------------------------------

/**
 * Una fila por modelo: su id, su región, la variable que lo sustituye, y el
 * semáforo con el error de Google plegado si falla.
 * @param {HTMLElement} hueco
 * @param {object} datos
 */
function pintarModelos(hueco, datos) {
  const modelos = Array.isArray(datos.modelos) ? datos.modelos : [];

  if (!modelos.length) {
    hueco.appendChild(aviso(
      'La comprobación no ha traído ningún modelo, y eso no es que la cuenta no tenga acceso: es ' +
      'que no hay ninguno declarado. Los ids salen de datos/serie.json, que va dentro del ' +
      'repositorio; si falta, el despliegue no ha subido entero.',
      { tono: 'error' }));
    return;
  }

  const responden = modelos.filter((m) => m && m.ok).length;

  hueco.appendChild(h('p', { clase: responden === modelos.length ? 'suave' : null },
    `Responden ${responden} de ${modelos.length}. `,
    'Ningún id está escrito en el código: todos salen de datos/serie.json y cada uno se puede ' +
    'sustituir con su variable de entorno sin tocar una línea. Nunca se cambia un modelo por otro ' +
    'en silencio.'));

  for (const modelo of modelos) {
    hueco.appendChild(fichaDeModelo(objeto(modelo)));
  }
}

/**
 * La tarjeta de un modelo.
 * @param {{clave:string, id:string|null, region:string|null, variable:string|null, ok:boolean, error:string|null}} modelo
 * @returns {HTMLElement}
 */
function fichaDeModelo(modelo) {
  const responde = modelo.ok === true;
  const hayNota = Boolean(modelo.error);

  /** ¿Este modelo tiene más de un nombre posible? Con uno solo no hay nada que contar. */
  const varias = (m) => Array.isArray(m.grafias) && m.grafias.length > 1;

  return tarjeta({
    titulo: nombreDeModelo(modelo.clave),
    // Un modelo que responde pero trae nota es el 429: hay acceso, pero ahora
    // mismo no hay cuota. Se distingue del verde limpio porque lleva a tocar
    // cosas muy distintas.
    estado: responde
      ? (hayNota ? { tipo: 'en-curso', texto: 'Responde, con nota' } : 'listo')
      : { tipo: 'fallido', texto: 'No se puede usar' },
    pie: h('div', null,
      h('dl', { estilo: estiloDeLista() },
        // Cuando responde, el id es el de la grafía QUE CONTESTÓ, no el primero
        // de la lista: es el nombre con el que de verdad se va a generar.
        dato('Id', modelo.id, {
          mono: true,
          nota: responde && varias(modelo) ? 'El nombre con el que ha contestado.' : null,
          falta: 'No hay ningún id declarado para esta casilla en datos/serie.json.',
        }),
        dato('Región', modelo.region, {
          mono: true,
          falta: 'Sin región declarada.',
        }),
        // Los nombres que se han probado. Se enseñan porque el error que más
        // confunde de todos —«tu cuenta no tiene este modelo»— casi nunca es
        // eso: es que Vertex lo publica con otro nombre. Ver cuántos se han
        // probado dice de un vistazo si el problema es el nombre o el acceso.
        varias(modelo)
          ? dato('Se ha probado como', modelo.grafias.join(', '), {
              mono: true,
              nota: 'Vertex publica el mismo modelo con el nombre de preview y con el ' +
                    'definitivo, y cuál contesta depende del proyecto. Se prueban todos.',
            })
          : null,
        dato('Variable', modelo.variable, {
          mono: true,
          nota: 'Ponla en Vercel con otro id dentro y este modelo se sustituye sin tocar código.',
          falta: 'Este modelo no se puede sustituir por variable de entorno.',
        })),
      hayNota
        ? plegado(
            responde
              ? 'Ver la nota que ha dejado Google'
              : 'Ver por qué no se puede usar, palabra por palabra',
            modelo.error)
        : null,
      responde
        ? null
        : h('p', { clase: 'tenue', estilo: { margin: '8px 0 0' } },
            `Si acabas de poner o cambiar ${modelo.variable ? `«${modelo.variable}»` : 'la variable'}: ` +
            REDESPLIEGUE),
  ),
  });
}

/** «imagen.calidad» → «Imagen · calidad». Lo que no esté en la tabla, tal cual. */
function nombreDeModelo(clave) {
  const partes = String(clave ?? '').split('.');
  const familia = FAMILIAS[partes[0]];
  if (!familia) return String(clave ?? 'Modelo sin nombre');
  if (partes.length < 2) return familia;
  const nivel = NIVELES[partes[1]] || partes[1];
  return `${familia} · ${nivel}`;
}

// ---------------------------------------------------------------------------
// Las voces
// ---------------------------------------------------------------------------

/**
 * Cuántas voces reales tiene la cuenta. No se listan aquí: se listan, se
 * escuchan y se eligen en la pantalla de Voces, que es donde se decide.
 * @param {HTMLElement} hueco
 * @param {object} datos
 */
function pintarVoces(hueco, datos) {
  const voces = Array.isArray(datos.voces) ? datos.voces : [];
  const fallo = datos.voces_error || null;

  if (voces.length) {
    hueco.appendChild(aviso(
      `Google ofrece ${voces.length} ${voces.length === 1 ? 'voz' : 'voces'} para el idioma de la ` +
      'serie. Los ids de voz no se inventan ni se escriben en el código: se eligen escuchándolos, ' +
      'en la pantalla de Voces.',
      { tono: 'bien' }));
    return;
  }

  hueco.appendChild(aviso(
    'No hay ninguna voz disponible, y sin lista la pantalla de Voces no puede funcionar: los ids ' +
    'de voz no se inventan. Casi siempre es que falta habilitar la API de síntesis de voz ' +
    '(texttospeech.googleapis.com) en el proyecto.',
    { tono: 'error', detalle: fallo }));
}

// ---------------------------------------------------------------------------
// El montador
// ---------------------------------------------------------------------------

/**
 * Si hay montador configurado. Sin él se genera todo pero no se monta nada, y
 * eso conviene saberlo antes de generar cuatrocientos planos.
 * @param {HTMLElement} hueco
 * @param {object} datos
 */
function pintarMontaje(hueco, datos) {
  const montaje = objeto(datos.montaje);

  if (montaje.configurado === undefined) {
    hueco.appendChild(h('p', { clase: 'tenue' },
      'Esta comprobación no ha contestado nada sobre el montador.'));
    return;
  }

  hueco.appendChild(tarjeta({
    titulo: 'ffmpeg en Cloud Run',
    estado: montaje.configurado ? 'listo' : { tipo: 'pendiente', texto: 'Sin instalar' },
    pie: h('div', null,
      h('dl', { estilo: estiloDeLista() },
        dato('Job', montaje.job, {
          mono: true,
          nota: 'Variable MONTAJE_JOB.',
          falta: 'Sin poner.',
        }),
        dato('Región', montaje.region, {
          mono: true,
          nota: 'Variable MONTAJE_REGION; si no está, la misma que GCP_LOCATION.',
          falta: 'Sin poner.',
        })),
      montaje.error
        ? h('p', { estilo: { margin: '12px 0 0' } }, montaje.error)
        : h('p', { clase: 'suave', estilo: { margin: '12px 0 0' } },
            'Hay montador configurado. Se comprueba de verdad al lanzar el primer montaje: ' +
            'preguntarle ahora daría un 403 en una cuenta perfectamente bien puesta, porque el ' +
            'permiso para lanzarlo no incluye el de leer su ficha.'),
      montaje.configurado
        ? null
        : h('p', { clase: 'tenue', estilo: { margin: '8px 0 0' } }, REDESPLIEGUE)),
  }));
}

// ---------------------------------------------------------------------------
// Los pesos medidos
// ---------------------------------------------------------------------------

/**
 * La tabla de pesos por modo contra el tope de 4,5 MB.
 *
 * Se juntan dos medidas y se toma la mayor: la que lleva guardada el estado en el
 * bucket, que sobrevive al cierre del móvil, y la de esta sesión, que todavía no
 * se ha escrito. Ninguna es una estimación: las dos salen de la cabecera
 * `X-Peso-Respuesta`, que trae el tamaño real del cuerpo ya serializado.
 *
 * @param {HTMLElement} hueco
 */
function pintarPesos(hueco) {
  vaciar(hueco);

  const medidos = juntarPesos();
  const nombres = Object.keys(medidos).sort((a, b) => medidos[b] - medidos[a]);

  hueco.appendChild(h('p', { clase: 'suave' },
    `El tope de la plataforma son ${bytes(TOPE_RESPUESTA)} por respuesta, y pasarse no parece un ` +
    'exceso de tamaño: parece un tiempo agotado. Por eso se mide en vez de razonarlo. Cada número ' +
    'es lo máximo que ha llegado a pesar la respuesta de ese modo.'));

  if (!nombres.length) {
    hueco.appendChild(h('p', { clase: 'tenue' },
      'Todavía no se ha medido ninguna respuesta en esta instalación. Se van midiendo solas según ' +
      'se usa la herramienta, sin ninguna petición de más, y se guardan en el estado. Antes de ' +
      'desplegar, «herramientas/pesar.mjs» las mide con material del tamaño real.'));
    return;
  }

  const tabla = h('table', {
    estilo: {
      width: '100%',
      'border-collapse': 'collapse',
      'font-variant-numeric': 'tabular-nums',
    },
  },
    h('thead', null,
      h('tr', null,
        celda('th', 'Modo', { encabezado: true }),
        celda('th', 'Pesó', { encabezado: true, derecha: true }),
        celda('th', 'Del tope', { encabezado: true, derecha: true }))),
    h('tbody', null, nombres.map((modo) => filaDePeso(modo, medidos[modo]))));

  hueco.appendChild(h('div', { estilo: { 'overflow-x': 'auto' } }, tabla));

  const pasados = nombres.filter((modo) => medidos[modo] >= TOPE_RESPUESTA);
  const apretados = nombres.filter(
    (modo) => medidos[modo] < TOPE_RESPUESTA && medidos[modo] >= TOPE_RESPUESTA * PARTE_QUE_PREOCUPA,
  );

  if (pasados.length) {
    hueco.appendChild(aviso(
      `Se ha pasado del tope: ${enumerar(pasados)}. Eso no se arregla reintentando —un 413 no se ` +
      'reintenta nunca— sino sacando el material grande de la respuesta: lo pesado se queda en el ' +
      'bucket y solo viaja su ruta y una URL firmada.',
      { tono: 'error' }));
  } else if (apretados.length) {
    hueco.appendChild(aviso(
      `Va apretado, por encima del 90 % del tope: ${enumerar(apretados)}. Todavía cabe, pero con ` +
      'una pieza más larga o una lista más grande dejará de caber, y el fallo parecerá un tiempo ' +
      'agotado.',
      { tono: 'nota' }));
  }
}

/**
 * Una fila de la tabla de pesos, con su barrita.
 * @param {string} modo
 * @param {number} cuantos
 * @returns {HTMLElement}
 */
function filaDePeso(modo, cuantos) {
  const parte = Math.min(1, cuantos / TOPE_RESPUESTA);
  const pasado = cuantos >= TOPE_RESPUESTA;
  const apretado = !pasado && cuantos >= TOPE_RESPUESTA * PARTE_QUE_PREOCUPA;
  const color = pasado ? 'var(--fallido)' : (apretado ? 'var(--en-curso)' : 'var(--listo)');

  return h('tr', null,
    celda('td',
      h('div', null,
        h('span', { clase: 'mono' }, modo),
        h('span', {
          estilo: {
            display: 'block',
            height: '3px',
            'margin-top': '6px',
            'border-radius': '999px',
            background: 'var(--fondo-hundido)',
          },
        },
          h('span', {
            estilo: {
              display: 'block',
              height: '100%',
              width: `${(parte * 100).toFixed(1)}%`,
              'border-radius': '999px',
              background: color,
            },
          })))),
    celda('td', bytes(cuantos), { derecha: true }),
    celda('td', porcentaje(cuantos, TOPE_RESPUESTA), { derecha: true, color }));
}

/**
 * Lo guardado en el estado y lo medido en esta sesión, con el máximo de cada
 * modo. El peso que interesa es el peor visto, no el último.
 * @returns {Object<string, number>}
 */
function juntarPesos() {
  const juntos = Object.create(null);

  const guardados = pesosDelEstado();
  for (const modo of Object.keys(guardados)) {
    const cuantos = Number(guardados[modo]);
    if (Number.isFinite(cuantos) && cuantos > 0) juntos[modo] = cuantos;
  }

  const deAhora = pesos();
  for (const modo of Object.keys(deAhora)) {
    const cuantos = Number(deAhora[modo]);
    if (!Number.isFinite(cuantos) || cuantos <= 0) continue;
    if (!(modo in juntos) || cuantos > juntos[modo]) juntos[modo] = cuantos;
  }

  return juntos;
}

/** `estado.pesos`, o nada si el estado todavía no ha llegado del bucket. */
function pesosDelEstado() {
  try {
    const estado = actual();
    return objeto(estado.pesos);
  } catch {
    // Que el estado no esté cargado no es un fallo de esta sección: los pesos de
    // esta sesión se enseñan igual, y el arranque ya cuenta lo suyo por su lado.
    return {};
  }
}

// ---------------------------------------------------------------------------
// Piezas que se repiten
// ---------------------------------------------------------------------------

/**
 * Una pareja etiqueta/valor de las listas de esta pantalla.
 *
 * Un valor que no está no se pinta con un guion: se dice qué falta y qué hay que
 * poner para que esté.
 *
 * @param {string} etiqueta
 * @param {*} valor
 * @param {{mono?:boolean, nota?:string, falta?:string, vacio?:string, color?:string}} [opciones]
 * @returns {HTMLElement[]}
 */
function dato(etiqueta, valor, opciones = {}) {
  const texto = valor == null ? '' : String(valor).trim();
  const hay = texto !== '';
  // Un valor vacío puede ser legítimo —el prefijo vacío significa «la raíz del
  // bucket»— y entonces se dice con palabras, no se pinta en rojo.
  const legitimo = !hay && Boolean(opciones.vacio);

  return [
    h('dt', { clase: 'tenue', estilo: { margin: '0' } }, etiqueta),
    h('dd', { estilo: { margin: '0' } },
      h('span', {
        clase: [hay && opciones.mono ? 'mono' : null, legitimo ? 'suave' : null],
        estilo: opciones.color && hay ? { color: opciones.color } : null,
      }, hay ? texto : (opciones.vacio || 'Falta')),
      opciones.nota && hay
        ? h('p', { clase: 'tenue', estilo: { margin: '2px 0 0', 'font-size': '13px' } }, opciones.nota)
        : null,
      !hay && !legitimo && opciones.falta
        ? h('p', { estilo: { margin: '2px 0 0', 'font-size': '13px' } }, opciones.falta)
        : null),
  ];
}

/** El estilo de las listas etiqueta/valor. Dos columnas, y una sola si no cabe. */
function estiloDeLista() {
  return {
    display: 'grid',
    'grid-template-columns': 'minmax(0, 7.5em) minmax(0, 1fr)',
    gap: '6px 12px',
    margin: '0',
    'align-items': 'baseline',
  };
}

/**
 * Un texto largo plegado. Los errores de Google vienen enormes y abiertos
 * empujan fuera de la pantalla lo único que hay que leer.
 * @param {string} resumen
 * @param {string} texto
 * @returns {HTMLElement}
 */
function plegado(resumen, texto) {
  return h('details', { clase: 'aviso-detalle', estilo: { 'margin-top': '10px' } },
    h('summary', { clase: 'aviso-resumen' }, resumen),
    h('pre', { clase: 'aviso-crudo' }, String(texto)));
}

/**
 * Un bloque de texto para copiar, con su botón. El texto se ve entero de todas
 * formas: si el navegador no deja copiar, se puede seleccionar a mano.
 * @param {string} texto
 * @param {string} etiqueta
 * @returns {HTMLElement}
 */
function bloqueCopiable(texto, etiqueta) {
  const caja = h('pre', {
    clase: 'mono',
    estilo: {
      margin: '8px 0',
      padding: '10px 12px',
      background: 'var(--fondo-hundido)',
      border: '1px solid var(--borde)',
      'border-radius': 'var(--radio-chico)',
      'white-space': 'pre-wrap',
      'font-size': '13px',
      'line-height': '1.5',
    },
  }, texto);

  const elBoton = boton(etiqueta, () => copiar(texto, elBoton, caja));

  return h('div', null, caja, h('div', { clase: 'tarjeta-acciones' }, elBoton));
}

/**
 * Copia al portapapeles y lo dice en el propio botón. Si el navegador no deja
 * —no hay permiso, o la página no va por https—, se selecciona el texto para que
 * se pueda copiar a mano, que es lo que quedaba por hacer de todas formas.
 *
 * @param {string} texto
 * @param {HTMLElement} elBoton
 * @param {HTMLElement} caja
 * @returns {Promise<void>}
 */
async function copiar(texto, elBoton, caja) {
  const antes = elBoton.textContent;

  try {
    await navigator.clipboard.writeText(texto);
    elBoton.textContent = 'Copiado';
  } catch {
    seleccionar(caja);
    elBoton.textContent = 'Ya está marcado: cópialo tú';
  }

  setTimeout(() => {
    elBoton.textContent = antes;
  }, AVISO_DE_COPIA_MS);
}

/** Deja un bloque de texto seleccionado, listo para copiar con el dedo. */
function seleccionar(nodo) {
  try {
    const rango = document.createRange();
    rango.selectNodeContents(nodo);
    const seleccion = window.getSelection();
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
  } catch {
    // Si ni eso se puede, el texto sigue en pantalla y se copia a mano.
  }
}

/**
 * Una celda de la tabla de pesos.
 * @param {string} etiqueta `th` o `td`
 * @param {*} dentro
 * @param {{encabezado?:boolean, derecha?:boolean, color?:string}} [opciones]
 * @returns {HTMLElement}
 */
function celda(etiqueta, dentro, opciones = {}) {
  return h(etiqueta, {
    clase: opciones.encabezado ? 'tenue' : null,
    estilo: {
      'text-align': opciones.derecha ? 'right' : 'left',
      padding: '8px 6px',
      'border-bottom': '1px solid var(--borde)',
      'font-weight': opciones.encabezado ? '600' : '400',
      'font-size': opciones.encabezado ? '13px' : '14px',
      'vertical-align': 'top',
      color: opciones.color || null,
    },
  }, dentro);
}

/**
 * El fallo de la comprobación entera, con su botón para volver a intentarlo. Es
 * el único sitio de esta pantalla donde no se puede decir nada de la cuenta,
 * porque no ha contestado nadie.
 * @param {HTMLElement} hueco
 * @param {*} fallo
 */
function pintarElFalloEntero(hueco, fallo) {
  const mensaje = fallo && fallo.mensaje
    ? fallo.mensaje
    : 'La comprobación de salud se ha roto de una manera que no estaba prevista.';
  const detalle = fallo && fallo.detalle ? fallo.detalle : loQueDijo(fallo);

  hueco.appendChild(aviso(mensaje, { tono: 'error', detalle }));
  hueco.appendChild(h('p', { clase: 'tenue' }, REDESPLIEGUE));
}

/** Los nombres de una lista, en español y con su «y» al final. */
function enumerar(nombres) {
  const lista = nombres.map((n) => `«${n}»`);
  if (lista.length <= 1) return lista.join('');
  return `${lista.slice(0, -1).join(', ')} y ${lista[lista.length - 1]}`;
}

/** Lo que dijo un fallo del navegador, literal, para el detalle. */
function loQueDijo(fallo) {
  if (!fallo) return null;
  if (typeof fallo === 'string') return fallo;
  if (fallo.message) return String(fallo.message);
  return String(fallo);
}

/** Un objeto de verdad, o uno vacío: así ninguna sección se rompe por un null. */
function objeto(valor) {
  return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : {};
}

/**
 * Las variables de entorno: cuáles están puestas y cuáles no. Nunca su valor.
 *
 * Va la primera de la pantalla cuando falta alguna obligatoria, porque si falta
 * GCP_SERVICE_ACCOUNT todo lo de abajo sale en rojo por la misma razón y no
 * tiene sentido leerlo modelo por modelo.
 *
 * Cada variable que falta lleva pegada la frase del Redeploy. Esa frase es la
 * que evita la tarde entera que se pierde cuando alguien pone la variable, la
 * pantalla sigue diciendo que falta, y se busca el fallo donde no está.
 */
function pintarVariables(hueco, datos) {
  vaciar(hueco);

  const lista = Array.isArray(datos?.variables) ? datos.variables : [];
  if (!lista.length) {
    hueco.appendChild(h('p', { clase: 'tenue' },
      'Esta versión de la función no dice qué variables tiene puestas.'));
    return;
  }

  const faltan = lista.filter((v) => v.obligatoria && !v.puesta);
  const sinPoner = lista.filter((v) => !v.obligatoria && !v.puesta);

  if (faltan.length) {
    hueco.appendChild(aviso(
      `Falta ${plural(faltan.length, 'una variable obligatoria', 'variables obligatorias')}: ` +
      `${faltan.map((v) => v.nombre).join(', ')}. Sin ellas no funciona nada de lo demás.`,
      { tono: 'error', detalle: REDESPLIEGUE },
    ));
  } else {
    hueco.appendChild(aviso('Todas las obligatorias están puestas.', { tono: 'bien' }));
  }

  // El sello del despliegue responde a la única pregunta que no se puede
  // responder de otra forma: si el Redeploy se llegó a hacer.
  const sello = datos?.despliegue;
  if (sello && (sello.commit || sello.arrancado)) {
    hueco.appendChild(h('p', { clase: 'tenue' },
      'Este despliegue: ' +
      [sello.commit && `commit ${sello.commit}`, sello.entorno,
       sello.arrancado && `arrancado ${fecha(sello.arrancado)}`]
        .filter(Boolean).join(' · ') +
      '. Si acabas de redesplegar y esto no ha cambiado, el Redeploy no se hizo.'));
  }

  for (const v of lista) {
    const acciones = [];
    if (!v.puesta) {
      acciones.push(h('p', { clase: 'tenue' }, REDESPLIEGUE));
    }
    hueco.appendChild(tarjeta({
      titulo: v.nombre,
      // `tarjeta` marca el estado con {tipo, texto} y los tipos son los de
      // ui.js: 'listo' pinta verde apagado, 'fallido' rojo apagado, 'pendiente'
      // gris. Y se distinguen también por la palabra, no solo por el color.
      estado: v.puesta
        ? { tipo: 'listo', texto: 'Puesta' }
        : { tipo: v.obligatoria ? 'fallido' : 'pendiente',
            texto: v.obligatoria ? 'Falta' : 'Sin poner' },
      pie: v.puesta
        ? v.para
        : `${v.para} ${v.obligatoria ? 'Sin ella no arranca nada.' : ''}`.trim(),
      acciones,
    }));
  }

  if (sinPoner.length) {
    hueco.appendChild(h('p', { clase: 'tenue' },
      `Hay ${plural(sinPoner.length, 'variable opcional sin poner', 'variables opcionales sin poner')}. ` +
      'No es un fallo: cada tarjeta dice qué se pierde sin ella.'));
  }
}
