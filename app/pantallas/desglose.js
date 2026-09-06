// El Desglose: del guion a los planos.
//
// Esta es la pantalla que decide si la herramienta sirve para una temporada o
// solo para un teaser. El teaser tiene sus 24 planos escritos a mano dentro de
// `datos/serie.json`; un episodio tiene unos cuatrocientos, y doce episodios son
// unos mil quinientos. Escribirlos a mano no es que sea trabajoso: es que no se
// hace. Aquí se eligen un episodio y se pide su desglose, y ya.
//
// LAS TRES REGLAS DURAS DE PRODUCTO QUE ESTA PANTALLA TIENE QUE HACER VISIBLES:
//
//   1. NO HAY NI UN SOLO CAMPO DE TEXTO, Y NO HAY APROBACIÓN DE PLANOS. No es
//      una omisión ni una fase que falte: el plan §7 lo dice con todas las
//      letras y el contrato §9 lo convierte en la regla que gobierna la interfaz
//      entera —el usuario solo decide sobre cosas que se perciben—. Un plano es
//      texto: cuántos segundos dura, con qué nivel de Veo se genera, qué placa
//      viaja como referencia. Pedirle a alguien que juzgue eso es pedirle que
//      haga de director sin serlo, y además no sirve de nada, porque lo que se
//      juzga de verdad se juzga después, mirando el keyframe. Así que aquí se
//      pulsa un botón, se mira cómo avanza, y lo desglosado aparece en Tomas.
//
//   2. UNA LLAMADA DE TEXTO POR ESCENA. Nunca una por episodio (contrato §13.3).
//      Son veinticuatro llamadas pequeñas e independientes: una por episodio no
//      cabe ni en la ventana del modelo ni en los sesenta segundos de la
//      función, y cuando falla se pierden las veinticuatro escenas en vez de
//      una. Por eso el botón «Desglosar» de un episodio no llama a nada: encola
//      veinticuatro trabajos y se va. Quien los hace, de uno en uno y desde el
//      bucket, es `app/cola.js`; si se cierra el móvil a mitad, al volver a
//      abrir siguen ahí.
//
//   3. UNA ESCENA QUE SALE MAL SE VUELVE A PEDIR ENTERA. No se edita a mano —no
//      hay dónde escribir— y no se corrige plano a plano. La función valida lo
//      que devuelve el modelo contra las reglas del contrato §6 y lo rechaza
//      diciendo QUÉ REGLA SE ROMPIÓ; esa frase, en español, es lo que se pinta
//      aquí, con el botón de pedir otro desglose al lado. Cada escena es
//      independiente: volver a pedir la 7 no toca las otras veintitrés.
//
// POR QUÉ SE ENSEÑA LA ACCIÓN DE LA ESCENA EN CURSO. Mientras corre, lo único
// que hay que mirar es una barra que sube. La acción de la escena que se está
// desglosando ahora mismo —tal cual está escrita en el guion— convierte esa
// barra en algo que se entiende: no es «7 de 24», es «va por la cripta». No se
// pide que se decida nada sobre ella. Se mira.
//
// POR QUÉ LA PIEZA SE ARMA SOLA AL TERMINAR. `app/cola.js` deja los planos de
// cada escena en `desglose/{episodio}/{escena}.json` dentro del bucket, uno por
// escena, porque es lo único que puede escribir sin depender de que el navegador
// siga abierto. Pero una pieza es la lista entera de planos en orden y con su
// línea de tiempo, y eso solo se puede armar cuando están las veinticuatro. En
// cuanto la última escena entra, esta pantalla recoge los veinticuatro archivos,
// los cose en orden, calcula el segundo en que empieza cada plano y escribe la
// pieza en el estado. Sin botón: el plan §7 dice «sin pasar por ninguna pantalla
// de aprobación», y un botón sería una aprobación con otro nombre.
//
// FALTA EN EL CONTRATO: el plan §7 dice que los planos «se escriben directamente
// como una pieza nueva en serie.json», pero `datos/serie.json` vive en el
// repositorio y desde un teléfono no se escribe. Aquí la pieza se escribe en
// `estado.piezas[«ep01»]`, dentro del bucket, con la misma forma que tienen las
// piezas de serie.json (título, duración, acabado y la lista de tomas), y sus
// tomas se crean en `estado.tomas` para que aparezcan en Tomas. Queda por
// decidir —y no es de esta pantalla— cómo llega esa pieza a la función: hoy
// `api/_lib/datos.js` lee las piezas solo de serie.json, así que para GENERAR
// los keyframes de un episodio desglosado hará falta que `pieza()` mire también
// el estado, o que la pieza baje al repositorio. Que se revise.

import { llamar, ErrorDeCara } from '../api.js';
import { actual, alCambiar, cambiar } from '../estado.js';
import { encolarVarios } from '../cola.js';
import {
  aviso,
  barra,
  boton,
  confirmar,
  espera,
  h,
  pantalla,
  seccion,
  vaciar
} from '../ui.js';
import { bytes as enBytes, fecha, plural, segundos as enSegundos } from '../formato.js';

// ---------------------------------------------------------------------------
// Números y palabras fijas de esta pantalla
// ---------------------------------------------------------------------------

/** Cuántas rutas caben en una sola llamada a `firmar` (contrato §2). */
const MAXIMO_POR_FIRMA = 200;

/** Cuánto de la acción de una escena se enseña como contexto, en caracteres. */
const RECORTE_DE_ACCION = 260;

/**
 * El tope de la plataforma por petición y por respuesta. El estado entero viaja
 * en cada guardado, así que las piezas desglosadas se miden contra esto y se
 * dice el número: es la única forma de enterarse antes de que un guardado
 * empiece a fallar con lo que parece un tiempo agotado.
 */
const LIMITE_PETICION = 4.5 * 1024 * 1024;

/** A partir de aquí se avisa de que las piezas ya ocupan una parte seria. */
const AVISO_DE_PESO = LIMITE_PETICION * 0.45;

// ---------------------------------------------------------------------------
// Lo que esta pantalla recuerda mientras la aplicación está abierta
// ---------------------------------------------------------------------------

/** `datos/guiones.json` y `datos/serie.json`, pedidos una sola vez. */
let promesaDeLosDatos = null;

/** Qué episodios están desplegados. */
const abiertos = new Set();

/** El último fallo de una acción de esta pantalla, para pintarlo arriba. */
let queja = null;

/** Los episodios cuya pieza se está armando ahora mismo. */
const armando = new Set();

/** Por qué no se ha podido armar la pieza de un episodio: `episodio → error`. */
const quejasDeArmado = new Map();

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

export default {
  id: 'desglose',
  titulo: 'Desglose',
  icono: '\u{1F4D0}',

  /**
   * Pinta el desglose dentro de `raiz` y se queda escuchando el estado.
   * @param {HTMLElement} raiz
   * @returns {Promise<() => void>} cómo desapuntarse al cambiar de pestaña
   */
  async montar(raiz) {
    const marco = h('div', { clase: 'desglose' });
    raiz.appendChild(marco);

    /** Cómo desapuntarse de lo que esté montado ahora mismo. */
    let soltar = null;

    const arrancar = async () => {
      if (typeof soltar === 'function') soltar();
      soltar = null;
      vaciar(marco);
      marco.appendChild(espera('Trayendo los doce guiones…'));

      let modelo;
      try {
        modelo = construirModelo(await losDatos());
      } catch (fallo) {
        const error = comoErrorDeCara(fallo);
        vaciar(marco);
        marco.appendChild(
          pantalla(
            'Desglose',
            seccion(
              null,
              aviso(error.mensaje, { tono: 'error', detalle: error.detalle }),
              h(
                'div',
                { clase: 'tarjeta-acciones' },
                boton(
                  'Volver a intentarlo',
                  () => {
                    promesaDeLosDatos = null;
                    arrancar();
                  },
                  { tono: 'principal' }
                )
              )
            )
          )
        );
        return;
      }

      const repintar = () => {
        vaciar(marco);
        marco.appendChild(construir(modelo, repintar));
      };

      const desapuntar = alCambiar(repintar);
      soltar = () => desapuntar();
      repintar();
    };

    await arrancar();

    return () => {
      if (typeof soltar === 'function') soltar();
      soltar = null;
    };
  }
};

// ---------------------------------------------------------------------------
// Los datos del repositorio, del lado del navegador
// ---------------------------------------------------------------------------

// FALTA EN EL CONTRATO: §12 da `api/_lib/datos.js` para la función, pero ningún
// módulo de datos para el navegador; `app/cola.js` y `app/pantallas/banco.js` ya
// se bajan `serie.json` por su cuenta con este mismo patrón. Esta pantalla
// necesita además `guiones.json`, que es la serie entera escrita: doce
// episodios, 289 escenas, con su lugar, su momento y su acción. Saber qué
// escenas tiene el episodio 3 no es componer un prompt ni conocer un id de
// modelo, que es lo único que §0 le prohíbe al navegador. Que se revise si debe
// acabar en un `app/datos.js` compartido.

/**
 * `datos/guiones.json` y `datos/serie.json`, bajados una vez y guardados.
 * @returns {Promise<{guiones:object, serie:object}>}
 */
function losDatos() {
  if (!promesaDeLosDatos) {
    promesaDeLosDatos = bajarLosDatos().catch((fallo) => {
      // Una caída de red no puede dejar la pantalla sin datos para siempre.
      promesaDeLosDatos = null;
      throw fallo;
    });
  }
  return promesaDeLosDatos;
}

/**
 * Los dos archivos, a la vez.
 * @returns {Promise<{guiones:object, serie:object}>}
 */
async function bajarLosDatos() {
  const [guiones, serie] = await Promise.all([
    bajarJson(
      new URL('../../datos/guiones.json', import.meta.url).href,
      'datos/guiones.json',
      'ahí está la serie entera escrita: los doce episodios con sus escenas, su lugar, su ' +
        'momento y su acción. Sin él esta pantalla no sabe qué hay que desglosar'
    ),
    bajarJson(
      new URL('../../datos/serie.json', import.meta.url).href,
      'datos/serie.json',
      'ahí está escrito cómo se produce la serie, y de ahí sale la cadena de acabado que se le ' +
        'pone a la pieza que se arma al terminar el desglose'
    )
  ]);
  return { guiones, serie };
}

/**
 * Baja un JSON del repositorio y lo explica con palabras si no puede.
 * @param {string} direccion
 * @param {string} nombre cómo se llama el archivo, para decirlo en el mensaje
 * @param {string} paraQue para qué hace falta, en una frase
 * @returns {Promise<object>}
 */
async function bajarJson(direccion, nombre, paraQue) {
  let respuesta;
  try {
    respuesta = await fetch(direccion, { cache: 'no-cache' });
  } catch (fallo) {
    throw new ErrorDeCara(
      `No se ha podido leer ${nombre}, y ${paraQue}. Comprueba la conexión del teléfono; si tienes ` +
        'cobertura, es que el despliegue está a medias.',
      { detalle: mensajeDe(fallo), reintentable: true, http: 0 }
    );
  }

  if (!respuesta.ok) {
    throw new ErrorDeCara(
      `No se ha podido leer ${nombre}: el servidor ha contestado con un ${respuesta.status}. Ese ` +
        'archivo va dentro del repositorio, así que si no está es que el despliegue no ha subido ' +
        'entero.',
      {
        detalle: `HTTP ${respuesta.status}`,
        reintentable: respuesta.status >= 500,
        http: respuesta.status
      }
    );
  }

  try {
    return await respuesta.json();
  } catch (fallo) {
    throw new ErrorDeCara(
      `${nombre} se ha bajado pero no se entiende: no es un JSON válido. Es un fallo del propio ` +
        'estudio, no de tu cuenta.',
      { detalle: mensajeDe(fallo), reintentable: false, http: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// El modelo: los doce episodios tal como se pintan
// ---------------------------------------------------------------------------

/**
 * Ordena los guiones en lo que esta pantalla necesita y comprueba que hay algo
 * que desglosar. No toca ni una palabra del guion: solo lo recorre.
 *
 * @param {{guiones:object, serie:object}} datos
 * @returns {{episodios:object[], escenas:number, acabado:object|null, piezasDeLaSerie:string[]}}
 */
function construirModelo(datos) {
  const crudos = datos.guiones && Array.isArray(datos.guiones.guiones) ? datos.guiones.guiones : [];

  const episodios = crudos
    .filter((uno) => uno && (uno.episodio !== undefined && uno.episodio !== null))
    .map((uno) => {
      const escenas = (Array.isArray(uno.escenas) ? uno.escenas : [])
        .filter((una) => una && una.escena !== undefined && una.escena !== null)
        .map((una) => ({
          escena: String(una.escena),
          lugar: texto(una.lugar),
          momento: texto(una.momento),
          flashback: una.flashback === true,
          escenario: texto(una.escenario),
          luz: texto(una.luz),
          personajes: Array.isArray(una.personajes) ? una.personajes.map(texto).filter(Boolean) : [],
          lineas: Array.isArray(una.dialogo) ? una.dialogo.length : 0,
          accion: texto(una.accion)
        }));

      return {
        episodio: String(uno.episodio),
        numero: Number(uno.episodio),
        titulo: texto(uno.titulo) || `Episodio ${uno.episodio}`,
        acto: texto(uno.acto),
        idPieza: idDePieza(uno.episodio),
        escenas
      };
    })
    .filter((uno) => uno.escenas.length);

  if (!episodios.length) {
    throw new ErrorDeCara(
      'datos/guiones.json se ha leído bien pero no trae ningún episodio con escenas dentro, así ' +
        'que no hay nada que desglosar. Es un fallo del propio estudio, no de tu cuenta: el ' +
        'archivo del repositorio no es el que debería.',
      { reintentable: false, http: 500 }
    );
  }

  return {
    episodios,
    escenas: episodios.reduce((suma, uno) => suma + uno.escenas.length, 0),
    acabado: acabadoDeReferencia(datos.serie),
    piezasDeLaSerie: Object.keys((datos.serie && datos.serie.piezas) || {})
  };
}

/**
 * El acabado que se le pone a una pieza recién desglosada.
 *
 * La cadena de ffmpeg es la misma para toda la serie —el plan §9 dice que se
 * mira una vez, se ajusta y no se toca más—, así que se copia de la primera
 * pieza de serie.json que la tenga escrita en vez de escribirla aquí otra vez:
 * dos copias de la misma cadena acabarían siendo dos cadenas distintas.
 *
 * @param {object} serie
 * @returns {{cadena_ffmpeg:string}|null}
 */
function acabadoDeReferencia(serie) {
  const piezas = (serie && serie.piezas) || {};
  for (const laPieza of Object.values(piezas)) {
    const cadena = laPieza && laPieza.acabado && texto(laPieza.acabado.cadena_ffmpeg);
    if (cadena) return { cadena_ffmpeg: cadena };
  }
  return null;
}

/** «ep01», «ep12». Es el nombre que el plan §4 le da a la pieza de un episodio. */
function idDePieza(episodio) {
  const numero = Number(episodio);
  if (Number.isFinite(numero)) return `ep${String(Math.trunc(numero)).padStart(2, '0')}`;
  return `ep${String(episodio).trim().replace(/[^0-9A-Za-z_-]+/g, '-')}`;
}

// ---------------------------------------------------------------------------
// El estado, leído
// ---------------------------------------------------------------------------

/** El estado, o un hueco con la forma justa si todavía no se ha traído. */
function leerEstado() {
  try {
    return actual();
  } catch {
    return { desglose: {}, cola: [], piezas: {}, tomas: {} };
  }
}

/** La clave con la que `app/cola.js` apunta una escena desglosada. */
function claveDeEscena(episodio, escena) {
  return `${episodio}/${escena}`;
}

/**
 * Lo que hay apuntado de una escena ya desglosada, o null.
 * @param {object} estado
 * @param {string} episodio
 * @param {string} escena
 * @returns {{ruta:string, planos:number, cuando:string}|null}
 */
function desgloseDe(estado, episodio, escena) {
  const mapa = estado && typeof estado.desglose === 'object' && estado.desglose ? estado.desglose : {};
  const apunte = mapa[claveDeEscena(episodio, escena)];
  if (!apunte || typeof apunte !== 'object') return null;
  const ruta = texto(apunte.ruta);
  if (!ruta) return null;
  return {
    ruta,
    planos: Number(apunte.planos) || 0,
    cuando: texto(apunte.cuando)
  };
}

/**
 * Qué está haciendo la cola con cada escena, para poder pintar «desglosando» y,
 * sobre todo, POR QUÉ falló la que falló. Un fallo cuyo texto solo viva en la
 * pantalla de Cola obliga a cambiar de pestaña para saber qué le pasa a la
 * escena que se está mirando.
 *
 * @param {object} estado
 * @returns {Map<string, object>} la clave es `«episodio»/«escena»`
 */
function indexarCola(estado) {
  const indice = new Map();
  const cola = estado && Array.isArray(estado.cola) ? estado.cola : [];

  for (const trabajo of cola) {
    if (!trabajo || trabajo.tipo !== 'desglose-escena') continue;
    const args = trabajo.args && typeof trabajo.args === 'object' ? trabajo.args : {};
    const episodio = texto(args.episodio);
    const escena = texto(args.escena);
    if (!episodio || !escena) continue;

    const clave = claveDeEscena(episodio, escena);
    const anterior = indice.get(clave);
    // De un trabajo revivido solo interesa lo último que le ha pasado.
    if (anterior && mandaSobre(anterior.estado, trabajo.estado)) continue;

    indice.set(clave, {
      estado: texto(trabajo.estado),
      error: texto(trabajo.error) || null,
      detalle: texto(trabajo.detalle) || null,
      intentos: Number(trabajo.intentos) || 0,
      actualizado: texto(trabajo.actualizado)
    });
  }

  return indice;
}

/** Cuál de dos estados de trabajo se enseña cuando hay dos para la misma escena. */
function mandaSobre(anterior, nuevo) {
  const peso = { en_curso: 4, pendiente: 3, fallido: 2, detenido: 1, hecho: 0 };
  return (peso[anterior] ?? 0) >= (peso[texto(nuevo)] ?? 0);
}

/**
 * Cómo va un episodio: cuántas escenas están desglosadas, cuántos planos han
 * salido y qué está pasando con las que faltan.
 *
 * @param {object} episodio
 * @param {object} estado
 * @param {Map<string, object>} trabajos
 * @returns {object}
 */
function comoVa(episodio, estado, trabajos) {
  const cuenta = {
    total: episodio.escenas.length,
    desglosadas: 0,
    planos: 0,
    enCurso: 0,
    pendientes: 0,
    fallidas: 0,
    detenidas: 0,
    escenasEnCurso: [],
    escenasFallidas: [],
    sinPedir: []
  };

  for (const escena of episodio.escenas) {
    const hecho = desgloseDe(estado, episodio.episodio, escena.escena);
    const trabajo = trabajos.get(claveDeEscena(episodio.episodio, escena.escena)) || null;

    if (hecho) {
      cuenta.desglosadas += 1;
      cuenta.planos += hecho.planos;
    }

    const como = trabajo ? trabajo.estado : '';
    if (como === 'en_curso') {
      cuenta.enCurso += 1;
      cuenta.escenasEnCurso.push(escena);
    } else if (como === 'pendiente') {
      cuenta.pendientes += 1;
    } else if (como === 'fallido') {
      cuenta.fallidas += 1;
      cuenta.escenasFallidas.push(escena);
    } else if (como === 'detenido') {
      cuenta.detenidas += 1;
    }

    // «Sin pedir» es lo que hay que encolar cuando se pulsa Desglosar: ni está
    // hecho, ni hay nadie ocupándose de ello ahora mismo.
    if (!hecho && como !== 'en_curso' && como !== 'pendiente') cuenta.sinPedir.push(escena);
  }

  cuenta.enMarcha = cuenta.enCurso + cuenta.pendientes;
  cuenta.completo = cuenta.desglosadas === cuenta.total && cuenta.total > 0;
  return cuenta;
}

/** El texto de estado de un episodio, tal como se lee en la lista. */
function comoSeLee(cuenta) {
  if (cuenta.completo) {
    return `Desglosado, ${plural(cuenta.planos, 'plano', 'planos')}`;
  }
  if (cuenta.enMarcha) {
    return `Desglosando ${cuenta.desglosadas} de ${cuenta.total}`;
  }
  if (cuenta.desglosadas) {
    return `A medias: ${cuenta.desglosadas} de ${cuenta.total} escenas`;
  }
  return 'Sin desglosar';
}

/**
 * El color con el que se escribe esa frase.
 *
 * El color nunca va solo y nunca dice nada que la frase no diga ya: es lo que
 * permite recorrer doce episodios de un vistazo, pero lo que se lee es el texto.
 * Son las mismas variables que usa la hoja de estilo para los estados.
 *
 * @param {object} cuenta
 * @returns {string}
 */
function colorDelEstado(cuenta) {
  if (cuenta.completo) return 'var(--listo)';
  if (cuenta.enCurso) return 'var(--en-curso)';
  if (cuenta.fallidas) return 'var(--fallido)';
  if (cuenta.detenidas) return 'var(--detenido)';
  if (cuenta.enMarcha) return 'var(--pendiente)';
  return 'var(--texto-tenue)';
}

// ---------------------------------------------------------------------------
// Pintar
// ---------------------------------------------------------------------------

/**
 * La pantalla entera.
 * @param {object} modelo
 * @param {() => void} repintar
 * @returns {HTMLElement}
 */
function construir(modelo, repintar) {
  const estado = leerEstado();
  const trabajos = indexarCola(estado);
  const ctx = { modelo, estado, trabajos, repintar };

  // Los episodios que ya están completos y cuya pieza no está escrita —o está
  // vieja— se arman aquí, sin botón. Es lo que dice el plan §7.
  for (const episodio of modelo.episodios) {
    armarSiToca(episodio, ctx);
  }

  return pantalla('Desglose', seccionCabecera(ctx), seccionEpisodios(ctx));
}

// ---------------------------------------------------------------------------
// La cabecera
// ---------------------------------------------------------------------------

/**
 * Lo de arriba: qué es esta pantalla, cuánto hay desglosado de toda la serie y
 * cuánto ocupan en el estado las piezas que han salido.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionCabecera(ctx) {
  const { modelo, estado, trabajos, repintar } = ctx;

  let desglosadas = 0;
  let planos = 0;
  let enCurso = 0;
  const enCursoAhora = [];

  for (const episodio of modelo.episodios) {
    const cuenta = comoVa(episodio, estado, trabajos);
    desglosadas += cuenta.desglosadas;
    planos += cuenta.planos;
    enCurso += cuenta.enCurso;
    for (const escena of cuenta.escenasEnCurso) enCursoAhora.push({ episodio, escena });
  }

  const partes = [];

  if (queja) {
    partes.push(
      aviso(queja.mensaje, { tono: 'error', detalle: queja.detalle }),
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton('Quitar este aviso', () => {
          queja = null;
          repintar();
        })
      )
    );
  }

  partes.push(
    aviso(
      'Aquí no se escribe ni se aprueba nada. Se elige un episodio, se pulsa Desglosar y la ' +
        'herramienta pide los planos de sus escenas una a una: una llamada pequeña por escena, ' +
        'no una gigante por episodio. Lo que salga se guarda solo y aparece en Tomas, que es ' +
        'donde se mira un keyframe y se decide de verdad. Si una escena sale mal, tiene su ' +
        'botón para pedir otra propuesta: los planos no se corrigen a mano.',
      { tono: 'nota' }
    ),
    barra(desglosadas, modelo.escenas, { etiqueta: 'Escenas desglosadas de toda la serie' })
  );

  if (planos) {
    partes.push(
      h(
        'p',
        { clase: 'suave' },
        `Llevan salidos ${plural(planos, 'plano', 'planos')} en ${plural(
          desglosadas,
          'escena',
          'escenas'
        )}.`
      )
    );
  }

  // El contexto de lo que está pasando: la acción de la escena en curso. No se
  // decide nada sobre ella; se mira para saber por dónde va.
  if (enCursoAhora.length) {
    partes.push(espera(fraseDeLoQueSeEstaHaciendo(enCursoAhora)));
    for (const cual of enCursoAhora.slice(0, 3)) {
      partes.push(contextoDeEscena(cual.episodio, cual.escena));
    }
  } else if (enCurso) {
    partes.push(espera('Desglosando…'));
  }

  const pesoDeLasPiezas = pesoDeLoDesglosado(estado);
  if (pesoDeLasPiezas > 0) {
    partes.push(
      h(
        'p',
        { clase: 'tenue numero' },
        `Las piezas desglosadas ocupan ${enBytes(pesoDeLasPiezas)} dentro del estado.` +
          (pesoDeLasPiezas > AVISO_DE_PESO
            ? ` El estado entero viaja en cada guardado y la plataforma no admite más de ${enBytes(
                LIMITE_PETICION
              )} por petición: conviene ir bajando al repositorio los episodios ya producidos.`
            : '')
      )
    );
  }

  return seccion(null, partes);
}

/** Qué se está desglosando ahora mismo, dicho en una frase. */
function fraseDeLoQueSeEstaHaciendo(enCursoAhora) {
  if (enCursoAhora.length === 1) {
    const uno = enCursoAhora[0];
    return `Desglosando la escena ${uno.escena.escena} del episodio ${uno.episodio.numero}…`;
  }
  return `Desglosando ${plural(enCursoAhora.length, 'escena', 'escenas')} a la vez…`;
}

/**
 * La acción de una escena, tal cual está escrita en el guion, como contexto de
 * lo que la herramienta está haciendo en este momento.
 * @param {object} episodio
 * @param {object} escena
 * @returns {HTMLElement}
 */
function contextoDeEscena(episodio, escena) {
  return h(
    'blockquote',
    {
      estilo: {
        margin: '0',
        padding: 'var(--espacio-3)',
        background: 'var(--fondo-hundido)',
        'border-left': '3px solid var(--borde-fuerte)',
        'border-radius': 'var(--radio-chico)'
      }
    },
    h(
      'p',
      { clase: 'suave', estilo: { margin: '0 0 6px', 'font-size': '13px' } },
      `Episodio ${episodio.numero}, escena ${escena.escena} · ${dondeYCuando(escena)}`
    ),
    h('p', { clase: 'tenue', estilo: { margin: '0', 'font-size': '13px' } }, recorte(escena.accion))
  );
}

/** «CRIPTA, noche · flashback», para situar una escena de un vistazo. */
function dondeYCuando(escena) {
  const trozos = [];
  if (escena.lugar) trozos.push(escena.lugar);
  if (escena.momento) trozos.push(escena.momento.toLowerCase());
  const donde = trozos.join(', ');
  return escena.flashback ? `${donde || 'sin lugar escrito'} · flashback` : donde || 'sin lugar escrito';
}

/**
 * Lo que ocupan en el estado las piezas ya desglosadas. Se mide, no se estima:
 * es el mismo texto que viaja en cada guardado.
 * @param {object} estado
 * @returns {number}
 */
function pesoDeLoDesglosado(estado) {
  const piezas = estado && typeof estado.piezas === 'object' && estado.piezas ? estado.piezas : null;
  if (!piezas || !Object.keys(piezas).length) return 0;
  try {
    const serializado = JSON.stringify(piezas);
    return new TextEncoder().encode(serializado).length;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Los doce episodios
// ---------------------------------------------------------------------------

/**
 * La lista de episodios. Cada uno es un pliegue: dentro están sus veinticuatro
 * escenas, y solo se construyen cuando se abre. Doce pliegues con 289 filas
 * abiertas a la vez son una pantalla que no se puede usar con un pulgar.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionEpisodios(ctx) {
  return seccion(
    'Los doce episodios',
    ...ctx.modelo.episodios.map((episodio) => pliegueDeEpisodio(episodio, ctx))
  );
}

/**
 * Un episodio: su título, sus escenas, su estado y su botón de desglosar.
 * @param {object} episodio
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function pliegueDeEpisodio(episodio, ctx) {
  const { estado, trabajos } = ctx;
  const cuenta = comoVa(episodio, estado, trabajos);
  const abierto = abiertos.has(episodio.episodio);

  const cuerpo = h('div', {
    estilo: { padding: '0 var(--espacio-3) var(--espacio-3)' }
  });

  const pliegue = h(
    'details',
    {
      open: abierto,
      estilo: {
        background: 'var(--fondo-alto)',
        border: '1px solid var(--borde)',
        'border-radius': 'var(--radio)',
        'box-shadow': 'var(--sombra)'
      },
      alDesplegar: () => {
        if (pliegue.open) abiertos.add(episodio.episodio);
        else abiertos.delete(episodio.episodio);
        if (pliegue.open && !cuerpo.childElementCount) llenarPliegue(cuerpo, episodio, cuenta, ctx);
      }
    },
    h(
      'summary',
      { estilo: { padding: 'var(--espacio-3)', 'min-height': 'var(--toque)', cursor: 'pointer' } },
      h(
        'span',
        { estilo: { 'font-weight': '600' } },
        `${episodio.numero}. ${episodio.titulo}`
      ),
      h(
        'span',
        { clase: 'suave', estilo: { display: 'block', 'font-size': '13px', 'margin-top': '2px' } },
        `Acto ${episodio.acto || 'sin escribir'} · ${plural(cuenta.total, 'escena', 'escenas')}`
      ),
      h(
        'span',
        {
          clase: 'numero',
          estilo: {
            display: 'block',
            'font-size': '13px',
            'margin-top': '2px',
            color: colorDelEstado(cuenta)
          }
        },
        comoSeLee(cuenta)
      ),
      cuenta.fallidas
        ? h(
            'span',
            {
              estilo: {
                display: 'block',
                'font-size': '13px',
                'margin-top': '2px',
                color: 'var(--fallido)'
              }
            },
            `${plural(cuenta.fallidas, 'escena', 'escenas')} sin salir. Ábrelo para leer qué pasó.`
          )
        : null
    ),
    cuerpo
  );

  if (abierto) llenarPliegue(cuerpo, episodio, cuenta, ctx);

  return pliegue;
}

/** Mete dentro del pliegue el progreso, los botones y las escenas. */
function llenarPliegue(cuerpo, episodio, cuenta, ctx) {
  vaciar(cuerpo);

  cuerpo.appendChild(
    barra(cuenta.desglosadas, cuenta.total, { etiqueta: `Escenas del episodio ${episodio.numero}` })
  );

  for (const nodo of avisosDelEpisodio(episodio, cuenta, ctx)) cuerpo.appendChild(nodo);
  cuerpo.appendChild(accionesDelEpisodio(episodio, cuenta, ctx));

  const lista = h('div', { estilo: { 'margin-top': 'var(--espacio-3)' } });
  for (const escena of episodio.escenas) {
    lista.appendChild(filaDeEscena(episodio, escena, ctx));
  }
  cuerpo.appendChild(lista);
}

/**
 * Lo que hay que decir de un episodio antes de sus escenas: que se está armando
 * su pieza, que no se ha podido armar, o que ya está escrita.
 * @param {object} episodio
 * @param {object} cuenta
 * @param {object} ctx
 * @returns {HTMLElement[]}
 */
function avisosDelEpisodio(episodio, cuenta, ctx) {
  const partes = [];
  const guardada = piezaGuardada(ctx.estado, episodio.idPieza);
  const fallo = quejasDeArmado.get(episodio.episodio);

  if (armando.has(episodio.episodio)) {
    partes.push(espera('Recogiendo los planos de las escenas y armando la pieza…'));
  }

  if (fallo) {
    partes.push(
      aviso(fallo.mensaje, { tono: 'error', detalle: fallo.detalle }),
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton(
          'Volver a armar la pieza',
          () => {
            quejasDeArmado.delete(episodio.episodio);
            ctx.repintar();
          },
          { tono: 'principal' }
        )
      )
    );
  }

  if (guardada) {
    partes.push(
      aviso(
        `Los planos de este episodio ya están escritos como la pieza «${episodio.idPieza}»: ` +
          `${plural(guardada.tomas, 'plano', 'planos')} y ${enSegundos(guardada.duracion_s)} de ` +
          'metraje. Aparecen en Tomas, que es donde se generan y se aprueban los keyframes.' +
          (guardada.cuando ? ` Se armó ${fecha(guardada.cuando)}.` : ''),
        { tono: 'bien' }
      )
    );
  }

  if (cuenta.fallidas) {
    partes.push(
      aviso(
        `${plural(cuenta.fallidas, 'escena', 'escenas')} de este episodio no han salido. Cada una ` +
          'dice más abajo qué regla del desglose se rompió y tiene su botón para pedir otra ' +
          'propuesta. Volver a pedir una escena no toca ninguna de las demás.',
        { tono: 'error' }
      )
    );
  }

  return partes;
}

/**
 * Los botones de un episodio. «Desglosar» encola una tarea por escena; nunca
 * una llamada por episodio (contrato §13.3).
 * @param {object} episodio
 * @param {object} cuenta
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function accionesDelEpisodio(episodio, cuenta, ctx) {
  const acciones = [];

  if (cuenta.sinPedir.length) {
    const cuantas = cuenta.sinPedir.length;
    acciones.push(
      boton(
        cuantas === cuenta.total
          ? `Desglosar el episodio ${episodio.numero}`
          : `Desglosar las ${cuantas} escenas que faltan`,
        () => encolarEscenas(episodio, cuenta.sinPedir, ctx),
        { tono: 'principal' }
      )
    );
  } else if (cuenta.enMarcha) {
    acciones.push(
      boton('Desglosar', () => {}, {
        desactivado:
          `Ya está pedido: ${plural(cuenta.enMarcha, 'escena', 'escenas')} de este episodio están ` +
          'en la cola. Cuando terminen aparecen aquí solas, aunque cierres la aplicación.'
      })
    );
  }

  if (cuenta.completo) {
    acciones.push(
      boton(
        'Volver a desglosarlo entero',
        async () => {
          const seguro = await confirmar(
            `¿Volver a desglosar las ${cuenta.total} escenas del episodio ${episodio.numero}? Es ` +
              `otra llamada de texto por escena y los ${cuenta.planos} planos de ahora se ` +
              'sustituyen por los nuevos. Lo que ya esté generado de esos planos —keyframes y ' +
              'clips— sigue en el bucket, pero puede dejar de corresponderse con lo que pida la ' +
              'pieza nueva.'
          );
          if (!seguro) return;
          encolarEscenas(episodio, episodio.escenas, ctx);
        },
        { tono: 'peligro' }
      )
    );
  }

  return h('div', { clase: 'tarjeta-acciones' }, acciones);
}

/**
 * Encola una tarea por escena, todas con una sola escritura del estado.
 * @param {object} episodio
 * @param {object[]} escenas
 * @param {object} ctx
 */
function encolarEscenas(episodio, escenas, ctx) {
  try {
    encolarVarios(
      escenas.map((escena) => ({
        tipo: 'desglose-escena',
        args: { episodio: episodio.episodio, escena: escena.escena }
      }))
    );
    // Si se vuelve a pedir, lo armado antes ya no vale: se olvida la queja para
    // que la pieza se rehaga cuando entren las escenas nuevas.
    quejasDeArmado.delete(episodio.episodio);
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  ctx.repintar();
}

// ---------------------------------------------------------------------------
// Una escena
// ---------------------------------------------------------------------------

/**
 * Una fila de escena: dónde pasa, cómo va, cuántos planos han salido y su botón
 * de volver a pedirla. Si falló, aquí es donde se lee qué regla se rompió.
 *
 * @param {object} episodio
 * @param {object} escena
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function filaDeEscena(episodio, escena, ctx) {
  const hecho = desgloseDe(ctx.estado, episodio.episodio, escena.escena);
  const trabajo = ctx.trabajos.get(claveDeEscena(episodio.episodio, escena.escena)) || null;
  const como = trabajo ? trabajo.estado : '';
  const fallida = como === 'fallido';

  const cabecera = h(
    'div',
    { estilo: { display: 'flex', 'align-items': 'baseline', gap: 'var(--espacio-2)', 'flex-wrap': 'wrap' } },
    h('span', { clase: 'numero', estilo: { 'font-weight': '600' } }, `Escena ${escena.escena}`),
    h('span', { clase: 'tenue', estilo: { 'font-size': '13px' } }, dondeYCuando(escena))
  );

  const pie = h(
    'p',
    { clase: 'suave', estilo: { margin: '4px 0 0', 'font-size': '13px' } },
    estadoDeEscenaEnPalabras(hecho, como, escena)
  );

  const partes = [cabecera, pie];

  if (como === 'en_curso') {
    partes.push(contextoDeEscena(episodio, escena));
  }

  if (fallida && trabajo && trabajo.error) {
    const explicado = explicarFallo(trabajo.error);
    partes.push(aviso(explicado.frase, { tono: 'error', detalle: trabajo.detalle }));
    if (explicado.reglas.length) {
      partes.push(
        h(
          'ul',
          { clase: 'suave', estilo: { margin: '6px 0 0', 'padding-left': '20px', 'font-size': '13px' } },
          explicado.reglas.map((regla) => h('li', regla))
        )
      );
    }
  }

  partes.push(accionesDeEscena(episodio, escena, hecho, como, ctx));

  return h(
    'div',
    {
      estilo: {
        padding: 'var(--espacio-3) 0',
        'border-top': '1px solid var(--borde)'
      }
    },
    partes
  );
}

/** Cómo va una escena, dicho con palabras. */
function estadoDeEscenaEnPalabras(hecho, como, escena) {
  const cuantasLineas = escena.lineas
    ? `${plural(escena.lineas, 'línea de diálogo', 'líneas de diálogo')}`
    : 'sin diálogo';

  if (como === 'en_curso') return `Desglosando ahora mismo · ${cuantasLineas}`;
  if (como === 'pendiente') return `En la cola, esperando turno · ${cuantasLineas}`;
  if (como === 'detenido') return `Detenida: la cola está parada · ${cuantasLineas}`;
  if (como === 'fallido') return `No ha salido · ${cuantasLineas}`;
  if (hecho) {
    return `${plural(hecho.planos, 'plano', 'planos')}${
      hecho.cuando ? ` · ${fecha(hecho.cuando)}` : ''
    } · ${cuantasLineas}`;
  }
  return `Sin desglosar · ${cuantasLineas}`;
}

/**
 * El botón de una escena. Siempre es el mismo: pedir otro desglose. No hay
 * ninguno para editar los planos, y eso es a propósito.
 * @param {object} episodio
 * @param {object} escena
 * @param {object|null} hecho
 * @param {string} como
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function accionesDeEscena(episodio, escena, hecho, como, ctx) {
  if (como === 'en_curso' || como === 'pendiente') {
    return h(
      'div',
      { clase: 'tarjeta-acciones' },
      boton('Volver a pedirla', () => {}, {
        desactivado:
          'Esta escena ya está pedida y la cola se está ocupando de ella. Pedirla otra vez ahora ' +
          'sería pagar dos desgloses de la misma escena.'
      })
    );
  }

  const etiqueta = hecho || como === 'fallido' ? 'Volver a pedirla' : 'Desglosar esta escena';

  return h(
    'div',
    { clase: 'tarjeta-acciones' },
    boton(etiqueta, () => encolarEscenas(episodio, [escena], ctx), {
      tono: como === 'fallido' ? 'principal' : 'suave'
    })
  );
}

/**
 * Parte el mensaje de un desglose rechazado en la frase que lo explica y la
 * lista de reglas que se rompieron.
 *
 * La función devuelve las reglas rotas dentro del propio mensaje, una por línea
 * y con un punto medio delante (`api/_lib/texto.js`). En un párrafo suelto se
 * leen todas seguidas y no se entiende ninguna; en una lista se lee cuál falló.
 *
 * @param {string} mensaje
 * @returns {{frase:string, reglas:string[]}}
 */
function explicarFallo(mensaje) {
  const lineas = String(mensaje || '').split('\n');
  const frase = [];
  const reglas = [];

  for (const linea of lineas) {
    const limpia = linea.trim();
    if (!limpia) continue;
    if (limpia.startsWith('·') || limpia.startsWith('-') || limpia.startsWith('•')) {
      reglas.push(limpia.replace(/^[·\-•]\s*/, ''));
    } else {
      frase.push(limpia);
    }
  }

  return { frase: frase.join(' ') || String(mensaje || ''), reglas };
}

// ---------------------------------------------------------------------------
// Armar la pieza
// ---------------------------------------------------------------------------

/**
 * Si el episodio está entero y su pieza no está escrita —o está vieja porque se
 * ha vuelto a desglosar alguna escena—, se arma. Sin botón: el plan §7 dice que
 * los planos se escriben «sin pasar por ninguna pantalla de aprobación».
 *
 * El candado de `armando` y el de `quejasDeArmado` son los que impiden que esto
 * se convierta en un bucle: cada armado termina repintando, y un repintado que
 * volviera a armar no pararía nunca.
 *
 * @param {object} episodio
 * @param {object} ctx
 */
function armarSiToca(episodio, ctx) {
  if (armando.has(episodio.episodio)) return;
  if (quejasDeArmado.has(episodio.episodio)) return;

  const cuenta = comoVa(episodio, ctx.estado, ctx.trabajos);
  if (!cuenta.completo) return;

  // Mientras quede una escena por venir no se arma nada, y esto no es una
  // optimización: al volver a desglosar un episodio entero, sus veinticuatro
  // escenas siguen contando como hechas —las de la vez anterior— y cada una que
  // entra cambiaría la huella. Sin este alto se armaría la pieza veinticuatro
  // veces, cada una con una mezcla de planos viejos y nuevos, y las
  // veinticuatro serían mentira menos la última.
  if (cuenta.enMarcha || cuenta.detenidas) return;

  const sello = selloDelEpisodio(episodio, ctx.estado);
  const guardada = piezaGuardada(ctx.estado, episodio.idPieza);
  if (guardada && guardada.sello === sello) return;

  armando.add(episodio.episodio);

  armarLaPieza(episodio, ctx.modelo, sello)
    .catch((fallo) => {
      quejasDeArmado.set(
        episodio.episodio,
        conCabeza(
          comoErrorDeCara(fallo),
          `No se han podido recoger los planos del episodio ${episodio.numero} para escribirlos ` +
            'como pieza. El desglose de las escenas está hecho y guardado en el bucket: no se ha ' +
            'perdido nada y no hay que volver a pedirlo.'
        )
      );
    })
    .finally(() => {
      armando.delete(episodio.episodio);
      ctx.repintar();
    });
}

/**
 * Lo que hay escrito de una pieza desglosada, en corto.
 * @param {object} estado
 * @param {string} idPieza
 * @returns {{sello:string, tomas:number, duracion_s:number, cuando:string}|null}
 */
function piezaGuardada(estado, idPieza) {
  const piezas = estado && typeof estado.piezas === 'object' && estado.piezas ? estado.piezas : {};
  const laPieza = piezas[idPieza];
  if (!laPieza || typeof laPieza !== 'object') return null;
  return {
    sello: texto(laPieza.sello),
    tomas: Array.isArray(laPieza.tomas) ? laPieza.tomas.length : 0,
    duracion_s: Number(laPieza.duracion_s) || 0,
    cuando: texto(laPieza.cuando)
  };
}

/**
 * La huella de un episodio desglosado: sus escenas y la hora a la que salió cada
 * una. Si se vuelve a pedir una sola escena, cambia, y la pieza se rehace.
 * @param {object} episodio
 * @param {object} estado
 * @returns {string}
 */
function selloDelEpisodio(episodio, estado) {
  const trozos = episodio.escenas.map((escena) => {
    const hecho = desgloseDe(estado, episodio.episodio, escena.escena);
    return `${escena.escena}:${hecho ? hecho.cuando || hecho.planos : 'no'}`;
  });
  return huella(trozos.join('|'));
}

/**
 * Recoge los planos de las escenas del bucket, los cose en orden y escribe la
 * pieza en el estado con sus tomas.
 *
 * @param {object} episodio
 * @param {object} modelo
 * @param {string} sello
 * @returns {Promise<void>}
 */
async function armarLaPieza(episodio, modelo, sello) {
  const estado = leerEstado();

  const encargos = episodio.escenas.map((escena) => {
    const hecho = desgloseDe(estado, episodio.episodio, escena.escena);
    if (!hecho) {
      throw new ErrorDeCara(
        `La escena ${escena.escena} del episodio ${episodio.numero} ya no está desglosada, así que ` +
          'no se puede armar la pieza entera. Vuelve a pedir esa escena.',
        { reintentable: false, http: 400 }
      );
    }
    return { escena, ruta: hecho.ruta };
  });

  const urls = await firmar(encargos.map((uno) => uno.ruta));

  const tomas = [];
  let inicio = 0;

  for (const encargo of encargos) {
    const url = texto(urls[encargo.ruta]);
    if (!url) {
      throw new ErrorDeCara(
        `No se ha podido conseguir un enlace para leer «${encargo.ruta}», que es donde están los ` +
          `planos de la escena ${encargo.escena.escena}. Vuelve a intentarlo; si sigue igual, mira ` +
          'en la pantalla de Salud si el bucket se lee bien.',
        { reintentable: true, http: 500 }
      );
    }

    const planos = await leerLosPlanos(url, encargo.escena, episodio);

    for (const plano of planos) {
      const dur = Number(plano.dur) || 0;
      tomas.push({
        id: texto(plano.id),
        escena: encargo.escena.escena,
        inicio,
        dur,
        dur_gen: Number(plano.dur_gen) || 0,
        recorte: Array.isArray(plano.recorte) ? plano.recorte.map((n) => Number(n) || 0) : [0, dur],
        veo: texto(plano.veo),
        luz: texto(plano.luz) || encargo.escena.luz,
        escenario: texto(plano.escenario) || encargo.escena.escenario,
        refs: Array.isArray(plano.refs) ? plano.refs.map(texto).filter(Boolean) : [],
        encadena_con: texto(plano.encadena_con) || null,
        boca_visible: texto(plano.boca_visible) || null,
        imagen: texto(plano.imagen),
        video: texto(plano.video),
        // El puntero al archivo, si el desglose ha decidido reutilizar un plano
        // de ambiente en vez de encargar uno nuevo. Es el campo que decide si
        // este plano se paga o no se paga.
        de_archivo: texto(plano.de_archivo) || null
      });
      inicio += dur;
    }
  }

  if (!tomas.length) {
    throw new ErrorDeCara(
      `Los archivos de desglose del episodio ${episodio.numero} están, pero no traen ni un plano ` +
        'dentro. Vuelve a desglosar el episodio.',
      { reintentable: false, http: 500 }
    );
  }

  const pieza = {
    id: episodio.idPieza,
    episodio: episodio.episodio,
    titulo: episodio.titulo,
    acto: episodio.acto,
    origen: 'desglose',
    sello,
    cuando: new Date().toISOString(),
    duracion_s: inicio,
    // El acabado es el mismo de toda la serie (plan §9). El paso de dos se
    // reserva para los planos que llevan personaje: los de cámara sobre fondo
    // —los que el desglose marca como «economico»— van a 24 limpios, igual que
    // en un anime de verdad.
    acabado: modelo.acabado
      ? {
          cadena_ffmpeg: modelo.acabado.cadena_ffmpeg,
          paso_de_dos: tomas
            .filter((una) => una.veo !== 'economico' && !una.de_archivo)
            .map((una) => una.id)
        }
      : null,
    tomas
  };

  await cambiar((vivo) => {
    if (!vivo.piezas || typeof vivo.piezas !== 'object') vivo.piezas = {};
    vivo.piezas[episodio.idPieza] = pieza;

    // Y las entradas de cada toma, con la forma exacta del contrato §5, para que
    // la pieza aparezca en Tomas. Lo que ya estuviera generado no se toca: un
    // keyframe aprobado de un plano que sigue llamándose igual sigue valiendo.
    if (!vivo.tomas || typeof vivo.tomas !== 'object') vivo.tomas = {};
    for (const una of tomas) {
      // Un plano que apunta al archivo NO tiene entrada propia: su material vive
      // a nombre del archivo y ya está generado. Crearle una vacía lo pintaría
      // en Tomas como si le faltara todo, y alguien acabaría generándolo.
      if (una.de_archivo) continue;
      const clave = `${episodio.idPieza}/${una.id}`;
      if (vivo.tomas[clave] && typeof vivo.tomas[clave] === 'object') continue;
      vivo.tomas[clave] = {
        keyframe_aprobado: null,
        intentos_keyframe: [],
        clip_elegido: null,
        intentos_clip: [],
        operacion_en_curso: null
      };
    }
  });
}

/**
 * Las URL firmadas de unas rutas, en lotes: 289 escenas no pueden ser 289
 * peticiones de firma.
 * @param {string[]} rutas
 * @returns {Promise<Object<string, string>>}
 */
async function firmar(rutas) {
  const urls = {};
  for (let i = 0; i < rutas.length; i += MAXIMO_POR_FIRMA) {
    const lote = rutas.slice(i, i + MAXIMO_POR_FIRMA);
    const respuesta = await llamar('firmar', { rutas: lote });
    Object.assign(urls, (respuesta && respuesta.urls) || {});
  }
  return urls;
}

/**
 * Lee del bucket los planos de una escena.
 *
 * Se baja con `fetch` desde la URL firmada porque el archivo vive en el bucket y
 * no pasa por la función: el estudio no tiene ningún modo para leer texto, y
 * meter 289 archivos por la puerta solo para volver a sacarlos sería gastar
 * llamadas sin motivo.
 *
 * @param {string} url
 * @param {object} escena
 * @param {object} episodio
 * @returns {Promise<object[]>}
 */
async function leerLosPlanos(url, escena, episodio) {
  let respuesta;
  try {
    respuesta = await fetch(url, { mode: 'cors', cache: 'no-store' });
  } catch (fallo) {
    // `fetch` revienta sin código y sin cuerpo: es CORS casi siempre.
    throw new ErrorDeCara(
      `No se han podido leer del bucket los planos de la escena ${escena.escena}, y esto casi ` +
        'siempre significa una sola cosa: al bucket le falta CORS. El desglose está hecho y ' +
        'guardado; lo que no se puede es volver a leerlo desde el navegador. La pantalla de Salud ' +
        'comprueba justo esto con un archivo de un píxel: si ahí también falla, es CORS seguro.',
      { detalle: mensajeDe(fallo), reintentable: false, http: 0 }
    );
  }

  if (!respuesta.ok) {
    const codigo = Number(respuesta.status) || 0;
    if (codigo === 401 || codigo === 403) {
      throw new ErrorDeCara(
        `El enlace para leer los planos de la escena ${escena.escena} ya no vale: las URL firmadas ` +
          'caducan a las seis horas. No es un problema de permisos ni de tu cuenta. Vuelve a ' +
          'entrar en esta pantalla para que pida enlaces nuevos.',
        { detalle: `HTTP ${codigo}`, reintentable: true, http: codigo }
      );
    }
    throw new ErrorDeCara(
      `El bucket ha contestado con un ${codigo} al pedirle los planos de la escena ` +
        `${escena.escena} del episodio ${episodio.numero}.`,
      { detalle: `HTTP ${codigo}`, reintentable: codigo >= 500, http: codigo }
    );
  }

  let leido;
  try {
    leido = await respuesta.json();
  } catch (fallo) {
    throw new ErrorDeCara(
      `El archivo de desglose de la escena ${escena.escena} está en el bucket pero no se entiende: ` +
        'no es un JSON válido. Vuelve a pedir esa escena.',
      { detalle: mensajeDe(fallo), reintentable: false, http: 500 }
    );
  }

  const planos = leido && Array.isArray(leido.planos) ? leido.planos : null;
  if (!planos || !planos.length) {
    throw new ErrorDeCara(
      `El archivo de desglose de la escena ${escena.escena} no trae ningún plano dentro. Vuelve a ` +
        'pedir esa escena.',
      { reintentable: false, http: 500 }
    );
  }

  const rotos = planos.filter((plano) => !plano || !texto(plano.id));
  if (rotos.length) {
    throw new ErrorDeCara(
      `${plural(rotos.length, 'plano', 'planos')} de la escena ${escena.escena} han llegado sin ` +
        'id, y sin id no se pueden guardar ni generar. Vuelve a pedir esa escena.',
      { reintentable: false, http: 500 }
    );
  }

  return planos;
}

// ---------------------------------------------------------------------------
// Menudencias
// ---------------------------------------------------------------------------

/**
 * Una huella corta y estable de un texto. FNV-1a de 32 bits: no es criptografía
 * y no pretende serlo, solo tiene que dar siempre lo mismo para lo mismo.
 * @param {string} valor
 * @returns {string}
 */
function huella(valor) {
  let numero = 0x811c9dc5;
  const cadena = String(valor);
  for (let i = 0; i < cadena.length; i += 1) {
    numero ^= cadena.charCodeAt(i);
    numero =
      (numero + ((numero << 1) + (numero << 4) + (numero << 7) + (numero << 8) + (numero << 24))) >>> 0;
  }
  return numero.toString(36).padStart(7, '0');
}

/** Un texto limpio, o cadena vacía. Vale para null, números y basura. */
function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor).trim();
}

/** Los primeros caracteres de la acción de una escena, sin cortar una palabra. */
function recorte(accion) {
  const plano = String(accion || '').replace(/\s+/g, ' ').trim();
  if (!plano) return 'La escena no trae acción escrita.';
  if (plano.length <= RECORTE_DE_ACCION) return plano;
  const cortado = plano.slice(0, RECORTE_DE_ACCION);
  const hueco = cortado.lastIndexOf(' ');
  return `${hueco > 40 ? cortado.slice(0, hueco) : cortado}…`;
}

/** Lo que dijo un fallo del navegador, literal, para el detalle. */
function mensajeDe(fallo) {
  if (!fallo) return null;
  if (typeof fallo === 'string') return fallo;
  if (fallo.message) return String(fallo.message);
  return String(fallo);
}

/**
 * El mismo error con una frase delante que sitúa dónde ha pasado.
 * @param {ErrorDeCara} error
 * @param {string} cabeza
 * @returns {ErrorDeCara}
 */
function conCabeza(error, cabeza) {
  return new ErrorDeCara(`${cabeza} ${error.mensaje}`, {
    detalle: error.detalle,
    reintentable: error.reintentable,
    http: error.http
  });
}

/**
 * Cualquier cosa que se haya lanzado, convertida en el error que se enseña. Un
 * fallo del propio navegador saldría en inglés y sin decir qué hacer.
 * @param {*} fallo
 * @returns {ErrorDeCara}
 */
function comoErrorDeCara(fallo) {
  if (fallo instanceof ErrorDeCara) return fallo;
  return new ErrorDeCara(
    'El estudio se ha roto por dentro pintando el desglose. No es un problema de tu cuenta ni de ' +
      'la nube: es un fallo del propio código. Debajo está lo que dijo el navegador, tal cual.',
    { detalle: mensajeDe(fallo), reintentable: false, http: 500 }
  );
}
