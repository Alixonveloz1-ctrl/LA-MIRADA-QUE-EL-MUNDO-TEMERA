// La Cola: qué se está generando, qué ha fallado y por qué, y cuánto va costando.
//
// Es la única pantalla que no sirve para hacer nada nuevo. Sirve para mirar lo
// que ya está en marcha, pararlo si hace falta, y entender por qué algo no ha
// salido. Con veinticuatro planos se puede vivir sin ella; con cuatrocientos, es
// donde se pasa la mitad del tiempo.
//
// LO QUE ESTA PANTALLA TIENE QUE HACER BIEN, Y POR QUÉ:
//
//   · UN FALLO SE LEE AQUÍ, EN ESPAÑOL, SIN IR A NINGÚN REGISTRO. El usuario de
//     esta herramienta no abre la consola de Google Cloud y no tiene por qué.
//     Cada trabajo fallido enseña la frase que explica qué ha pasado y, plegado
//     debajo, lo que dijo Google palabra por palabra. La frase primero porque es
//     lo que dice qué hacer; el original debajo porque a veces hace falta y
//     porque tapar lo que dijo el otro lado es mentir a medias.
//
//   · EL BOTÓN DE DETENER NO ABORTA LO QUE YA ESTÁ EN CURSO, Y SE DICE. Una
//     operación de Veo lanzada sigue generándose en Google se mire o no se mire,
//     y ya está pagada: abandonarla la dejaría huérfana, con el clip terminado
//     en el bucket y nadie que lo recoja. Detener para lo que no ha empezado.
//
//   · UNA GENERACIÓN CADA VEZ, Y NO ES UN AJUSTE. Aquí había un selector de 1 a
//     8 y venía a 3. Ya no: las cuotas de esta cuenta son cortas y con cuotas
//     cortas la concurrencia no da velocidad, da fallos. Vertex pasado de cuota
//     no devuelve «has gastado tu cuota»: devuelve errores que parecen falta de
//     acceso al modelo, y se acaba buscando el fallo en los permisos, que es
//     donde no está. Así que se explica la regla en vez de ofrecer una palanca
//     que solo sirve para romper cosas.
//
//   · EL GASTO ES INFORMACIÓN, NO UN LÍMITE. No hay tope, no hay bloqueo y no
//     hay que pedir permiso para gastar. Lo que hay es la cuenta: cuántas
//     imágenes por nivel y cuántos segundos de vídeo por nivel, repartidos
//     POR PIEZA. Con cuatrocientos planos, saber que un episodio se ha ido en
//     clips de nivel «calidad» cambia la decisión siguiente; sin ese número no
//     se cambia nada porque no se sabe.
//
//   · LAS OPERACIONES DE VEO EN VUELO SE VEN Y SE PUEDEN EMPUJAR. Cada clip que
//     Google está generando ahora mismo, con su toma, cuánto lleva y un botón
//     para preguntar ya en vez de esperar al turno.
//
// POR QUÉ EL EURO VA MARCADO COMO ORIENTATIVO Y LOS PRECIOS ESTÁN EN UNA
// CONSTANTE. Los precios los pone Google, cambian sin avisar, dependen de la
// región y de si la cuenta tiene descuentos, y están en dólares. Un número
// escondido en el código que se presenta como «lo que llevas gastado» sería una
// factura falsa. Lo que se enseña es un orden de magnitud, dicho como tal, con
// los precios en `PRECIOS` —aquí arriba, editables de un vistazo— y con la fecha
// en que se escribieron.

import { ErrorDeCara } from '../api.js';
import { actual, alCambiar, cambiar } from '../estado.js';
import {
  EVENTO_FALLO_DE_COLA,
  corriendo,
  detener,
  encolarVarios,
  reanudar,
  resumen
} from '../cola.js';
import {
  aviso,
  barra,
  boton,
  confirmar,
  espera,
  filtro,
  h,
  pantalla,
  seccion,
  vaciar
} from '../ui.js';
import { fecha, plural, segundos as enSegundos } from '../formato.js';

// ---------------------------------------------------------------------------
// LOS PRECIOS. Se editan aquí y en ningún otro sitio.
// ---------------------------------------------------------------------------

/**
 * Cuánto cuesta, aproximadamente, cada cosa que genera esta herramienta.
 *
 * NO SON LOS PRECIOS DE TU CUENTA. Los pone Google, cambian, dependen de la
 * región, del modelo exacto y de los descuentos que tenga la cuenta, y están
 * publicados en dólares. Estos números están escritos a mano para que la
 * pantalla pueda decir un orden de magnitud —«esto llevará unos treinta euros»,
 * que es lo que cambia una decisión— y no para cuadrar una factura. Para
 * ajustarlos se cambian aquí y ya: no hay ningún otro sitio donde estén.
 */
const PRECIOS = {
  /** Euros por imagen generada, por nivel del modelo de imagen. */
  imagen: { calidad: 0.12, medio: 0.04, economico: 0.03 },
  /** Euros por segundo de vídeo generado, por nivel de Veo. */
  video_s: { calidad: 0.35, medio: 0.15, economico: 0.1 },
  /** Euros por segundo de música de Lyria. */
  musica_s: 0.006,
  /** Euros por segundo de voz de Gemini TTS. */
  voz_s: 0.002,
  /** Cuándo se escribieron estos números, para saber si ya están viejos. */
  escritos: 'septiembre de 2026'
};

// ---------------------------------------------------------------------------
// Números y palabras fijas de esta pantalla
// ---------------------------------------------------------------------------

/**
 * Cuántas veces insiste la cola antes de rendirse con un error reintentable:
 * espera 2 s, 4 s, 8 s y 16 s, y para (contrato §8). Se necesita aquí para
 * distinguir un trabajo que falló DESPUÉS de que la cola insistiera —esos son
 * los que tiene sentido volver a pedir— de uno que falló a la primera, que es
 * lo que hace la cola con un error que no va a cambiar por insistir: un 4xx, un
 * 413, un keyframe que falta.
 */
const INSISTENCIAS = 4;

/** Cuántos trabajos se pintan de una vez. Cuatrocientos no caben en un pulgar. */
const POR_TANDA = 40;

/** Cada cuánto se refrescan los «lleva 4 min», en milisegundos. */
const LATIDO_MS = 10000;

/** Cuántos fallos sueltos de la cola se guardan para enseñarlos. */
const MAXIMO_FALLOS = 5;

/** Cómo se llama cada tipo de trabajo cuando se lee (contrato §8). */
const TIPOS = {
  placa: 'Placa del banco',
  escenario: 'Escenario',
  poster: 'Póster o miniatura',
  keyframe: 'Keyframe',
  clip: 'Clip de vídeo',
  'clip-consultar': 'Recoger un clip',
  musica: 'Música',
  voz: 'Voz',
  alinear: 'Medir los tiempos de la voz',
  'desglose-escena': 'Desglose de una escena',
  ficha: 'Ficha para publicar',
  montaje: 'Montaje'
};

/** Los filtros de la lista de trabajos. */
const FILTROS = [
  { id: 'activos', texto: 'En marcha', estados: ['en_curso', 'pendiente'] },
  { id: 'fallido', texto: 'Fallidos', estados: ['fallido'] },
  { id: 'detenido', texto: 'Detenidos', estados: ['detenido'] },
  { id: 'hecho', texto: 'Hechos', estados: ['hecho'] },
  { id: 'todo', texto: 'Todo', estados: null }
];

/** En qué orden se leen los trabajos: lo que necesita atención, arriba. */
const ORDEN = { fallido: 0, en_curso: 1, pendiente: 2, detenido: 3, hecho: 4 };

// ---------------------------------------------------------------------------
// Lo que esta pantalla recuerda mientras la aplicación está abierta
// ---------------------------------------------------------------------------

/** `datos/serie.json`, para saber cuántos segundos y de qué nivel es cada clip. */
let promesaDeLaSerie = null;

/** La serie ya traída, o null. Sin ella el gasto por pieza no se puede repartir. */
let laSerie = null;

/** Por qué no se ha podido traer la serie, si es que no se ha podido. */
let quejaDeLaSerie = null;

/** El filtro puesto en la lista de trabajos. */
let filtroPuesto = 'activos';

/** Cuántos trabajos se están enseñando ahora mismo. */
let cuantosSeVen = POR_TANDA;

/** El último fallo de una acción de esta pantalla. */
let queja = null;

/** Los fallos que la cola no ha podido meter en ningún trabajo. */
let fallosDeLaCola = [];

/**
 * Si se ha pulsado detener desde esta pantalla.
 *
 * FALTA EN EL CONTRATO: §12 da `corriendo()` en `app/cola.js`, que dice si el
 * obrero está trabajando, pero no hay ninguna función que diga si está PARADO, y
 * son cosas distintas: la cola también deja de correr cuando no queda nada que
 * hacer. Mientras no la haya se combinan las dos señales que sí existen —lo que
 * se ha pulsado aquí y los trabajos que quedaron en «detenido», que es lo que ve
 * cualquier otro móvil que abra la aplicación—. Que se revise.
 */
let paradoAqui = false;

/** Los nodos que enseñan «lleva 4 min» y hay que refrescar con el latido. */
let relojes = [];

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

export default {
  id: 'cola',
  titulo: 'Cola',
  icono: '\u{23F3}',

  /**
   * Pinta la cola dentro de `raiz` y se queda escuchando el estado, los fallos
   * sueltos de la cola y el paso del tiempo.
   * @param {HTMLElement} raiz
   * @returns {Promise<() => void>} cómo desapuntarse al cambiar de pestaña
   */
  async montar(raiz) {
    const marco = h('div', { clase: 'cola' });
    raiz.appendChild(marco);

    const repintar = () => {
      relojes = [];
      vaciar(marco);
      marco.appendChild(construir(repintar));
    };

    const alFallar = (evento) => {
      const dicho = (evento && evento.detail) || {};
      fallosDeLaCola = [
        { mensaje: String(dicho.mensaje || ''), detalle: dicho.detalle || null, cuando: ahoraIso() },
        ...fallosDeLaCola
      ].slice(0, MAXIMO_FALLOS);
      repintar();
    };

    const desapuntar = alCambiar(repintar);
    window.addEventListener(EVENTO_FALLO_DE_COLA, alFallar);

    // El latido solo toca los textos de tiempo. Repintar la pantalla entera cada
    // diez segundos movería la lista bajo el dedo de quien la está leyendo.
    const latido = setInterval(() => {
      for (const reloj of relojes) {
        if (reloj.nodo && reloj.nodo.isConnected) reloj.nodo.textContent = cuantoLleva(reloj.desde);
      }
    }, LATIDO_MS);

    repintar();

    // La serie se pide en segundo plano: la cola se puede mirar sin ella, lo
    // único que falta es el reparto del gasto por pieza.
    pedirLaSerie(repintar);

    return () => {
      desapuntar();
      window.removeEventListener(EVENTO_FALLO_DE_COLA, alFallar);
      clearInterval(latido);
      relojes = [];
    };
  }
};

// ---------------------------------------------------------------------------
// datos/serie.json, del lado del navegador
// ---------------------------------------------------------------------------

// FALTA EN EL CONTRATO: §12 no da ningún módulo de datos para el navegador;
// `app/cola.js` y las demás pantallas se bajan `serie.json` por su cuenta con
// este mismo patrón. Aquí hace falta para una sola cosa: saber cuántos segundos
// dura la generación de cada toma y con qué nivel de Veo, que es lo que permite
// repartir el gasto de vídeo por pieza. No es componer un prompt ni conocer un
// id de modelo. Que se revise si debe acabar en un `app/datos.js` compartido.

/** Pide la serie una vez y repinta cuando llega. */
function pedirLaSerie(repintar) {
  if (laSerie || promesaDeLaSerie) return;

  promesaDeLaSerie = bajarLaSerie()
    .then((datos) => {
      laSerie = datos;
      quejaDeLaSerie = null;
    })
    .catch((fallo) => {
      quejaDeLaSerie = comoErrorDeCara(fallo);
      // Se deja pedida para que un fallo de red no reintente en cada repintado,
      // que es lo que haría un bucle: el repintado lo dispara el propio fallo.
    })
    .finally(() => {
      repintar();
    });
}

/**
 * Baja `datos/serie.json`.
 * @returns {Promise<object>}
 */
async function bajarLaSerie() {
  const direccion = new URL('../../datos/serie.json', import.meta.url).href;

  let respuesta;
  try {
    respuesta = await fetch(direccion, { cache: 'no-cache' });
  } catch (fallo) {
    throw new ErrorDeCara(
      'No se ha podido leer datos/serie.json, que es donde está escrito cuántos segundos y de qué ' +
        'nivel se genera cada plano. La cola se ve igual; lo único que falta sin ese archivo es el ' +
        'reparto del gasto por pieza.',
      { detalle: mensajeDe(fallo), reintentable: true, http: 0 }
    );
  }

  if (!respuesta.ok) {
    throw new ErrorDeCara(
      `No se ha podido leer datos/serie.json: el servidor ha contestado con un ${respuesta.status}. ` +
        'Ese archivo va dentro del repositorio, así que si no está es que el despliegue no ha ' +
        'subido entero.',
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
      'datos/serie.json se ha bajado pero no se entiende: no es un JSON válido. Es un fallo del ' +
        'propio estudio, no de tu cuenta.',
      { detalle: mensajeDe(fallo), reintentable: false, http: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// El estado, leído
// ---------------------------------------------------------------------------

/** El estado, o un hueco con la forma justa si todavía no se ha traído. */
function leerEstado() {
  try {
    return actual();
  } catch {
    return { cola: [], tomas: {}, gasto: {}, audio: { musica: {}, voz: {} }, banco: {}, escenarios: {} };
  }
}

/** La lista de trabajos, siempre una lista. */
function colaDe(estado) {
  return estado && Array.isArray(estado.cola) ? estado.cola.filter(Boolean) : [];
}

// ---------------------------------------------------------------------------
// Pintar
// ---------------------------------------------------------------------------

/**
 * La pantalla entera.
 * @param {() => void} repintar
 * @returns {HTMLElement}
 */
function construir(repintar) {
  const estado = leerEstado();
  const trabajos = colaDe(estado);
  const ctx = { estado, trabajos, repintar };

  return pantalla(
    'Cola',
    seccionMando(ctx),
    seccionOperaciones(ctx),
    seccionGasto(ctx),
    seccionTrabajos(ctx)
  );
}

// ---------------------------------------------------------------------------
// El mando: cómo va, detener, reanudar y la regla de una cada vez
// ---------------------------------------------------------------------------

/**
 * Lo de arriba: el resumen, el botón grande y el tope de generaciones a la vez.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionMando(ctx) {
  const cuenta = resumen();
  const total =
    cuenta.pendientes + cuenta.enCurso + cuenta.hechas + cuenta.fallidas + cuenta.detenidas;
  // Detenida quiere decir dos cosas a la vez, y las dos cuentan: que hay
  // trabajos aparcados en el bucket —eso lo ve cualquier móvil que abra la
  // aplicación— o que se ha pulsado detener aquí y el obrero ya no está en
  // marcha. Lo segundo lleva la comprobación de `corriendo()` pegada porque
  // `app/main.js` vuelve a arrancar la cola cada vez que la aplicación vuelve al
  // frente, y entonces lo que se pulsó hace media hora ya no vale.
  const parada = cuenta.detenidas > 0 || (paradoAqui && !corriendo());
  const partes = [];

  if (queja) {
    partes.push(
      aviso(queja.mensaje, { tono: 'error', detalle: queja.detalle }),
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton('Quitar este aviso', () => {
          queja = null;
          ctx.repintar();
        })
      )
    );
  }

  for (const fallo of fallosDeLaCola) {
    partes.push(
      aviso(
        `${fallo.mensaje} (${fecha(fallo.cuando)})`,
        { tono: 'error', detalle: fallo.detalle }
      )
    );
  }
  if (fallosDeLaCola.length) {
    partes.push(
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton('Quitar estos avisos', () => {
          fallosDeLaCola = [];
          ctx.repintar();
        })
      )
    );
  }

  partes.push(barra(cuenta.hechas, total, { etiqueta: 'Trabajos terminados' }));
  partes.push(h('p', { clase: 'suave' }, frasesDelResumen(cuenta, parada)));

  if (cuenta.enCurso && !parada) {
    partes.push(espera(`Generando ${plural(cuenta.enCurso, 'cosa', 'cosas')} a la vez…`));
  }

  // Los dos botones pueden hacer falta a la vez: con trabajos detenidos de antes
  // y trabajos nuevos esperando turno, ni «reanudar» ni «detener» sobra.
  const mandos = [];

  if (parada || cuenta.detenidas) {
    mandos.push(
      boton(
        'REANUDAR',
        () => {
          paradoAqui = false;
          try {
            reanudar();
          } catch (fallo) {
            queja = comoErrorDeCara(fallo);
          }
          ctx.repintar();
        },
        { tono: 'principal' }
      )
    );
  }

  if (!parada || cuenta.pendientes) {
    mandos.push(
      boton(
        'DETENER',
        async () => {
          const seguro = await confirmar(
            'Detener la cola deja parado todo lo que aún no ha empezado. Lo que ya se está ' +
              'generando termina de generarse: una operación de Veo lanzada sigue su curso en ' +
              'Google esté abierta o no esta pantalla, y ya está pagada, así que abandonarla ' +
              'sería tirar el dinero y dejar el clip sin recoger. ¿Detener?'
          );
          if (!seguro) return;
          paradoAqui = true;
          try {
            detener();
          } catch (fallo) {
            queja = comoErrorDeCara(fallo);
          }
          ctx.repintar();
        },
        {
          tono: 'peligro',
          desactivado: cuenta.pendientes
            ? false
            : 'No hay nada esperando turno, así que no hay nada que detener. Lo que esté en curso ' +
              'se termina de todas formas: abandonarlo sería dejarlo pagado y sin recoger.'
        }
      )
    );
  }

  partes.push(h('div', { clase: 'tarjeta-acciones' }, mandos));

  partes.push(bloqueDeConcurrencia(ctx));

  return seccion(null, partes);
}

/** El resumen de la cola, dicho con palabras. */
function frasesDelResumen(cuenta, parada) {
  const trozos = [];
  if (cuenta.enCurso) trozos.push(`${cuenta.enCurso} en curso`);
  if (cuenta.pendientes) trozos.push(`${cuenta.pendientes} esperando turno`);
  if (cuenta.detenidas) trozos.push(plural(cuenta.detenidas, 'detenido', 'detenidos'));
  if (cuenta.fallidas) trozos.push(plural(cuenta.fallidas, 'fallido', 'fallidos'));
  if (cuenta.hechas) trozos.push(plural(cuenta.hechas, 'hecho', 'hechos'));

  if (!trozos.length) return 'La cola está vacía: no hay nada pedido ni nada por recoger.';

  let cabeza;
  if (cuenta.detenidas) {
    cabeza =
      cuenta.detenidas === 1
        ? 'Hay un trabajo detenido esperando a que lo reanudes.'
        : `Hay ${cuenta.detenidas} trabajos detenidos esperando a que los reanudes.`;
  } else if (parada) {
    cabeza = 'La cola está detenida: no se coge nada nuevo hasta que la reanudes.';
  } else if (corriendo()) {
    cabeza = 'La cola está trabajando.';
  } else {
    cabeza = 'La cola está al día y no tiene nada que hacer ahora mismo.';
  }

  return `${cabeza} ${trozos.join(' · ')}.`;
}

/**
 * La regla de una generación cada vez, dicha en pantalla.
 *
 * ESTO ERA UN SELECTOR de 1 a 8 y ya no lo es. Con las cuotas de esta cuenta,
 * subir el número no va más rápido: tumba la tanda entera y hay que reintentarla,
 * y los errores que llegan no dicen «cuota», dicen cosas que parecen falta de
 * acceso al modelo. Así que no es un ajuste, es una regla, y lo que se hace aquí
 * es explicarla en vez de ofrecer una palanca que solo sirve para romper cosas.
 *
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function bloqueDeConcurrencia(ctx) {
  return h(
    'div',
    null,
    h(
      'p',
      { clase: 'suave', estilo: { margin: '0 0 var(--espacio-2)' } },
      'Una generación cada vez.'
    ),
    h(
      'p',
      { clase: 'tenue', estilo: { 'font-size': '13px', margin: '0' } },
      'Termina una, empieza la siguiente. Aunque pidas diez voces de golpe, se genera la primera ' +
        'y las otras nueve esperan su turno en esta cola, en orden. No hay un número que subir: ' +
        'con las cuotas de esta cuenta, pedir varias a la vez no va más rápido, tumba la tanda ' +
        'entera, y lo que llega no es «has gastado tu cuota» sino errores que parecen falta de ' +
        'acceso al modelo, que es donde nunca está el fallo. Vale para todo: imágenes, clips, ' +
        'voces, música y montajes.'
    )
  );
}

// ---------------------------------------------------------------------------
// Las operaciones de Veo en vuelo
// ---------------------------------------------------------------------------

/**
 * Los clips que Google está generando ahora mismo. Cada uno es dinero ya
 * gastado: si nadie los recoge, el vídeo se queda en el bucket y la toma dice
 * «generando» para siempre.
 * @param {object} ctx
 * @returns {HTMLElement|null}
 */
function seccionOperaciones(ctx) {
  const enVuelo = operacionesEnVuelo(ctx.estado, ctx.trabajos);
  if (!enVuelo.length) return null;

  const partes = [
    h(
      'p',
      { clase: 'suave' },
      `${plural(enVuelo.length, 'clip', 'clips')} generándose en Google ahora mismo. No hace falta ` +
        'tener esto abierto: cada uno tiene apuntada su operación y se recoge solo, también si ' +
        'cierras la aplicación y vuelves mañana.'
    ),
    h(
      'div',
      { clase: 'tarjeta-acciones' },
      boton(
        enVuelo.length === 1 ? 'Preguntar ahora' : `Preguntar por los ${enVuelo.length} ahora`,
        () => consultarYa(enVuelo, ctx),
        { tono: 'principal' }
      )
    )
  ];

  for (const una of enVuelo) partes.push(filaDeOperacion(una, ctx));

  return seccion('Vídeos en marcha', partes);
}

/**
 * Todas las tomas con una operación de Veo apuntada, con lo que se sepa de su
 * consulta en la cola.
 * @param {object} estado
 * @param {object[]} trabajos
 * @returns {object[]}
 */
function operacionesEnVuelo(estado, trabajos) {
  const tomas = estado && typeof estado.tomas === 'object' && estado.tomas ? estado.tomas : {};
  const salida = [];

  for (const [clave, entrada] of Object.entries(tomas)) {
    if (!entrada || typeof entrada !== 'object') continue;
    // Llega como `true`, no como el nombre: el nombre lleva el project id dentro
    // y se queda en el bucket. Aquí basta con saber que hay vídeo en vuelo.
    if (!entrada.operacion_en_curso) continue;

    const corte = String(clave).indexOf('/');
    if (corte <= 0) continue;
    const pieza = String(clave).slice(0, corte);
    const toma = String(clave).slice(corte + 1);

    // La consulta se encola en el mismo instante del lanzamiento, así que su
    // hora de creación es la hora a la que Veo empezó a generar.
    const consulta = trabajos.find(
      (trabajo) =>
        trabajo.tipo === 'clip-consultar' &&
        trabajo.args &&
        texto(trabajo.args.pieza) === pieza &&
        texto(trabajo.args.id) === toma
    );

    // AQUÍ NO VA EL NOMBRE DE LA OPERACIÓN, Y NO ES UN OLVIDO.
    //
    // Antes se guardaba aquí, y cuando se decidió que el nombre NO viajara al
    // navegador —lleva el project id dentro— se quitó la variable y se quedó el
    // campo, escrito en forma corta. Un campo suelto que nombra una variable que
    // ya no existe no es un campo vacío: es un ReferenceError que revienta esta
    // pantalla entera, y solo cuando hay un vídeo en vuelo, que es exactamente
    // cuando hace falta mirarla. Nadie lo lee, así que no está.
    salida.push({
      pieza,
      toma,
      desde: consulta ? texto(consulta.creado) : '',
      consultas: consulta ? Number(consulta.consultas) || 0 : 0,
      estadoDeLaConsulta: consulta ? texto(consulta.estado) : '',
      trabajo: consulta || null
    });
  }

  return salida.sort((a, b) => String(a.desde).localeCompare(String(b.desde)));
}

/**
 * Una operación en vuelo: su toma, cuánto lleva y su botón de preguntar ya.
 * @param {object} una
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function filaDeOperacion(una, ctx) {
  const reloj = h('span', { clase: 'numero' }, cuantoLleva(una.desde));
  relojes.push({ nodo: reloj, desde: una.desde });

  return h(
    'div',
    {
      estilo: {
        padding: 'var(--espacio-3)',
        background: 'var(--fondo-alto)',
        border: '1px solid var(--borde)',
        'border-radius': 'var(--radio-chico)'
      }
    },
    h(
      'p',
      { estilo: { margin: '0', 'font-weight': '600' } },
      `Toma ${una.toma}`,
      h('span', { clase: 'suave', estilo: { 'font-weight': '400' } }, ` · pieza «${una.pieza}»`)
    ),
    h('p', { clase: 'suave', estilo: { margin: '4px 0 0', 'font-size': '13px' } }, reloj,
      una.consultas
        ? ` · se ha preguntado ${plural(una.consultas, 'vez', 'veces')}`
        : ' · todavía no se ha preguntado'
    ),
    h(
      'div',
      { clase: 'tarjeta-acciones', estilo: { 'margin-top': 'var(--espacio-2)' } },
      boton('Preguntar ahora', () => consultarYa([una], ctx))
    )
  );
}

/**
 * Pregunta ya por unas operaciones en vez de esperar a su turno.
 *
 * Son dos cosas y las dos hacen falta: quitarle al trabajo de consulta la hora
 * de «vuelve luego» —si no, seguiría esperando— y encolarlo, que además despierta
 * al obrero si estaba durmiendo.
 *
 * @param {object[]} unas
 * @param {object} ctx
 */
async function consultarYa(unas, ctx) {
  const suyos = new Set(unas.map((una) => (una.trabajo ? una.trabajo.id : '')).filter(Boolean));

  try {
    if (suyos.size) {
      await cambiar((vivo) => {
        for (const trabajo of colaDe(vivo)) {
          if (suyos.has(trabajo.id) && trabajo.estado === 'pendiente') trabajo.proximo = null;
        }
      });
    }

    encolarVarios(
      unas.map((una) => ({
        tipo: 'clip-consultar',
        args: { pieza: una.pieza, id: una.toma }
      }))
    );
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }

  ctx.repintar();
}

// ---------------------------------------------------------------------------
// El gasto
// ---------------------------------------------------------------------------

/**
 * El contador. No es un límite: es la cuenta de por dónde se está yendo el
 * dinero, que con cuatrocientos planos es lo que cambia la decisión siguiente.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionGasto(ctx) {
  const gasto = ctx.estado && typeof ctx.estado.gasto === 'object' && ctx.estado.gasto ? ctx.estado.gasto : {};
  const imagenes = porNiveles(gasto.imagen);
  const video = porNiveles(gasto.video_s);
  const musica = Number(gasto.musica_s) || 0;
  const voz = Number(gasto.voz_s) || 0;

  const partes = [];

  const totalImagenes = sumar(imagenes);
  const totalVideo = sumar(video);

  if (!totalImagenes && !totalVideo && !musica && !voz) {
    partes.push(
      h('p', { clase: 'suave' }, 'Todavía no se ha generado nada, así que no hay nada que contar.')
    );
    return seccion('Gasto', partes);
  }

  partes.push(
    h(
      'p',
      { clase: 'suave' },
      'Esto es todo lo generado desde que existe la producción, contado según pasaba. No es un ' +
        'tope y no bloquea nada: está aquí para saber en qué se va.'
    )
  );

  partes.push(
    lineasDeGasto('Imágenes generadas', imagenes, (n) => plural(n, 'imagen', 'imágenes')),
    lineasDeGasto('Vídeo generado', video, (n) => enSegundos(n))
  );

  if (musica) {
    partes.push(
      h('p', { clase: 'numero' }, `Música de Lyria: ${enSegundos(musica)}.`)
    );
  }
  if (voz) {
    partes.push(h('p', { clase: 'numero' }, `Voz de Gemini TTS: ${enSegundos(voz)}.`));
  }

  const euros =
    eurosDeNiveles(imagenes, PRECIOS.imagen) +
    eurosDeNiveles(video, PRECIOS.video_s) +
    musica * PRECIOS.musica_s +
    voz * PRECIOS.voz_s;

  partes.push(bloqueDeEuros(euros));
  partes.push(...bloquesPorPieza(ctx));

  return seccion('Gasto', partes);
}

/** Una línea por nivel, más el total. */
function lineasDeGasto(titulo, niveles, comoSeLee) {
  const total = sumar(niveles);
  const trozos = Object.keys(niveles)
    .filter((nivel) => niveles[nivel] > 0)
    .map((nivel) => `${nombreDeNivel(nivel)} ${comoSeLee(niveles[nivel])}`);

  return h(
    'p',
    { clase: 'numero' },
    h('span', { estilo: { 'font-weight': '600' } }, `${titulo}: ${comoSeLee(total)}`),
    trozos.length ? h('span', { clase: 'suave' }, ` — ${trozos.join(' · ')}` ) : null
  );
}

/**
 * La estimación en euros, dicha como lo que es: una estimación.
 * @param {number} euros
 * @returns {HTMLElement}
 */
function bloqueDeEuros(euros) {
  return h(
    'div',
    {
      estilo: {
        padding: 'var(--espacio-3)',
        background: 'var(--fondo-hundido)',
        border: '1px dashed var(--borde-fuerte)',
        'border-radius': 'var(--radio-chico)'
      }
    },
    h(
      'p',
      { clase: 'numero', estilo: { margin: '0', 'font-weight': '600' } },
      `Orientativo: unos ${enEuros(euros)}.`
    ),
    h(
      'p',
      { clase: 'tenue', estilo: { margin: '6px 0 0', 'font-size': '13px' } },
      `Este número no es una factura y puede estar lejos. Los precios los pone Google, cambian sin ` +
        `avisar, dependen de la región y de los descuentos de la cuenta, y están publicados en ` +
        `dólares. Los que usa esta pantalla están escritos a mano en la constante PRECIOS, al ` +
        `principio de app/pantallas/cola.js, y se anotaron en ${PRECIOS.escritos}. La cuenta buena ` +
        `es la de la facturación de Google.`
    )
  );
}

/**
 * El gasto repartido por pieza.
 *
 * El total de arriba lo lleva `estado.gasto`, que se va sumando según pasa. El
 * reparto se cuenta desde otro sitio: los intentos que hay guardados en cada
 * toma. Son dos medidas distintas de lo mismo y pueden no cuadrar al céntimo —lo
 * que se generó antes de que existiera el contador aparece aquí y no allí—, pero
 * esta es la que dice EN QUÉ PIEZA se está yendo el dinero, que es la pregunta.
 *
 * @param {object} ctx
 * @returns {HTMLElement[]}
 */
function bloquesPorPieza(ctx) {
  if (quejaDeLaSerie) {
    return [
      aviso(
        `${quejaDeLaSerie.mensaje} El total de arriba está bien: lo único que falta es saber a qué ` +
          'pieza pertenece cada plano.',
        { tono: 'nota', detalle: quejaDeLaSerie.detalle }
      )
    ];
  }

  if (!laSerie) return [espera('Trayendo la serie para repartir el gasto por pieza…')];

  const piezas = indexarPiezas(laSerie, ctx.estado);
  const reparto = repartirPorPieza(ctx.estado, piezas);

  if (!reparto.length) return [];

  const partes = [
    h(
      'p',
      { clase: 'suave', estilo: { 'margin-top': 'var(--espacio-4)', 'font-weight': '600' } },
      'Por pieza'
    ),
    h(
      'p',
      { clase: 'tenue', estilo: { 'font-size': '13px', margin: '0' } },
      'Contado desde los intentos guardados en cada toma. Un keyframe cuesta céntimos y un clip ' +
        'cuesta cerca de un euro: si una pieza se ha ido en clips, es aquí donde se ve.'
    )
  ];

  for (const fila of reparto) partes.push(bloqueDePieza(fila));

  return partes;
}

/**
 * Qué tomas tiene cada pieza y cuánto cuesta generar cada una.
 * Las piezas salen de dos sitios: las escritas en `datos/serie.json` y las que
 * ha dejado el desglose en el estado.
 *
 * @param {object} serie
 * @param {object} estado
 * @returns {Map<string, {titulo:string, tomas:Map<string, object>}>}
 */
function indexarPiezas(serie, estado) {
  const piezas = new Map();

  const meter = (id, laPieza) => {
    if (!laPieza || typeof laPieza !== 'object') return;
    const tomas = new Map();
    for (const una of Array.isArray(laPieza.tomas) ? laPieza.tomas : []) {
      if (!una || !texto(una.id)) continue;
      tomas.set(texto(una.id), {
        veo: texto(una.veo) || 'medio',
        durGen: Number(una.dur_gen) || 0
      });
    }
    piezas.set(id, { titulo: texto(laPieza.titulo) || id, tomas });
  };

  for (const [id, laPieza] of Object.entries((serie && serie.piezas) || {})) meter(id, laPieza);
  for (const [id, laPieza] of Object.entries((estado && estado.piezas) || {})) meter(id, laPieza);

  return piezas;
}

/**
 * Cuenta lo generado de cada pieza a partir de los intentos guardados.
 * @param {object} estado
 * @param {Map<string, object>} piezas
 * @returns {object[]}
 */
function repartirPorPieza(estado, piezas) {
  const filas = new Map();

  const dame = (id) => {
    if (!filas.has(id)) {
      const conocida = piezas.get(id);
      filas.set(id, {
        id,
        titulo: conocida ? conocida.titulo : id,
        conocida: Boolean(conocida),
        tomas: conocida ? conocida.tomas.size : 0,
        keyframes: 0,
        clips: 0,
        video: { calidad: 0, medio: 0, economico: 0 },
        voz_s: 0,
        musica_s: 0
      });
    }
    return filas.get(id);
  };

  const tomas = estado && typeof estado.tomas === 'object' && estado.tomas ? estado.tomas : {};
  for (const [clave, entrada] of Object.entries(tomas)) {
    if (!entrada || typeof entrada !== 'object') continue;
    const corte = String(clave).indexOf('/');
    if (corte <= 0) continue;
    const idPieza = String(clave).slice(0, corte);
    const idToma = String(clave).slice(corte + 1);

    const cuantosKeyframes = Array.isArray(entrada.intentos_keyframe)
      ? entrada.intentos_keyframe.length
      : 0;
    const cuantosClips = Array.isArray(entrada.intentos_clip) ? entrada.intentos_clip.length : 0;
    if (!cuantosKeyframes && !cuantosClips) continue;

    const fila = dame(idPieza);
    fila.keyframes += cuantosKeyframes;
    fila.clips += cuantosClips;

    const laToma = piezas.get(idPieza) ? piezas.get(idPieza).tomas.get(idToma) : null;
    if (laToma && cuantosClips) {
      const nivel = fila.video[laToma.veo] === undefined ? 'medio' : laToma.veo;
      fila.video[nivel] += cuantosClips * laToma.durGen;
    }
  }

  const voz = ((estado || {}).audio || {}).voz || {};
  for (const [clave, entrada] of Object.entries(voz)) {
    if (!entrada || typeof entrada !== 'object') continue;
    const corte = String(clave).indexOf('/');
    if (corte <= 0) continue;
    const durS = Number(entrada.dur_s) || 0;
    if (!durS) continue;
    dame(String(clave).slice(0, corte)).voz_s += durS;
  }

  const musica = ((estado || {}).audio || {}).musica || {};
  for (const [clave, entrada] of Object.entries(musica)) {
    if (!entrada || typeof entrada !== 'object') continue;
    const durS = Number(entrada.dur_s) || 0;
    if (!durS) continue;
    // Las piezas de música se llaman «{pieza}-loquesea» (datos/serie.json), así
    // que la pieza sale del principio del id. Lo que no encaje con ninguna se
    // queda sin repartir en vez de colgarse de la que no es.
    const suya = [...piezas.keys()].find((id) => String(clave).startsWith(`${id}-`));
    if (suya) dame(suya).musica_s += durS;
  }

  return [...filas.values()].sort((a, b) => eurosDeFila(b) - eurosDeFila(a));
}

/** Lo que lleva costando una pieza, en euros orientativos. */
function eurosDeFila(fila) {
  const nivelPorDefecto = nivelDeImagenPorDefecto();
  return (
    fila.keyframes * (PRECIOS.imagen[nivelPorDefecto] ?? PRECIOS.imagen.medio) +
    eurosDeNiveles(fila.video, PRECIOS.video_s) +
    fila.voz_s * PRECIOS.voz_s +
    fila.musica_s * PRECIOS.musica_s
  );
}

/**
 * Una pieza, con lo que se ha generado de ella.
 * @param {object} fila
 * @returns {HTMLElement}
 */
function bloqueDePieza(fila) {
  const totalVideo = sumar(fila.video);
  const detalle = Object.keys(fila.video)
    .filter((nivel) => fila.video[nivel] > 0)
    .map((nivel) => `${nombreDeNivel(nivel)} ${enSegundos(fila.video[nivel])}`);

  return h(
    'div',
    {
      estilo: {
        padding: 'var(--espacio-3)',
        background: 'var(--fondo-alto)',
        border: '1px solid var(--borde)',
        'border-radius': 'var(--radio-chico)'
      }
    },
    h(
      'p',
      { estilo: { margin: '0', 'font-weight': '600' } },
      fila.titulo,
      h(
        'span',
        { clase: 'suave', estilo: { 'font-weight': '400' } },
        fila.conocida ? ` · ${plural(fila.tomas, 'plano', 'planos')}` : ' · pieza que ya no está escrita'
      )
    ),
    h(
      'p',
      { clase: 'suave numero', estilo: { margin: '4px 0 0', 'font-size': '13px' } },
      `${plural(fila.keyframes, 'imagen', 'imágenes')} · ${plural(fila.clips, 'clip', 'clips')}` +
        (totalVideo ? ` · ${enSegundos(totalVideo)} de vídeo` : '') +
        (detalle.length ? ` (${detalle.join(' · ')})` : '') +
        (fila.voz_s ? ` · ${enSegundos(fila.voz_s)} de voz` : '') +
        (fila.musica_s ? ` · ${enSegundos(fila.musica_s)} de música` : '')
    ),
    h(
      'p',
      { clase: 'tenue numero', estilo: { margin: '4px 0 0', 'font-size': '13px' } },
      `Orientativo: unos ${enEuros(eurosDeFila(fila))}.`
    )
  );
}

/** El nivel de imagen que se usa cuando nadie dice cuál. Sale de serie.json. */
function nivelDeImagenPorDefecto() {
  const dicho =
    laSerie && laSerie.modelos && laSerie.modelos.imagen && laSerie.modelos.imagen.por_defecto;
  return texto(dicho) || 'medio';
}

// ---------------------------------------------------------------------------
// La lista de trabajos
// ---------------------------------------------------------------------------

/**
 * Los trabajos, filtrados por estado y de cuarenta en cuarenta.
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function seccionTrabajos(ctx) {
  const { trabajos } = ctx;

  if (!trabajos.length) {
    return seccion(
      'Trabajos',
      h(
        'p',
        { clase: 'suave' },
        'No hay ningún trabajo en la cola. Se llenan desde las demás pantallas: el Banco encola ' +
          'sus placas, Tomas sus keyframes y sus clips, Desglose sus escenas.'
      )
    );
  }

  const opciones = FILTROS.map((uno) => ({
    id: uno.id,
    texto: uno.texto,
    cuenta: uno.estados
      ? trabajos.filter((trabajo) => uno.estados.includes(texto(trabajo.estado))).length
      : trabajos.length
  }));

  const elegido = FILTROS.find((uno) => uno.id === filtroPuesto) || FILTROS[0];
  const filtrados = elegido.estados
    ? trabajos.filter((trabajo) => elegido.estados.includes(texto(trabajo.estado)))
    : [...trabajos];

  filtrados.sort((a, b) => {
    const porEstado = (ORDEN[texto(a.estado)] ?? 9) - (ORDEN[texto(b.estado)] ?? 9);
    if (porEstado) return porEstado;
    return String(b.actualizado).localeCompare(String(a.actualizado));
  });

  const partes = [
    filtro(opciones, filtroPuesto, (id) => {
      filtroPuesto = id;
      cuantosSeVen = POR_TANDA;
      ctx.repintar();
    })
  ];

  for (const nodo of accionesDeLosFallidos(ctx)) partes.push(nodo);

  if (!filtrados.length) {
    partes.push(h('p', { clase: 'suave' }, 'Con este filtro puesto no hay ningún trabajo.'));
    return seccion('Trabajos', partes);
  }

  for (const trabajo of filtrados.slice(0, cuantosSeVen)) {
    partes.push(filaDeTrabajo(trabajo, ctx));
  }

  if (filtrados.length > cuantosSeVen) {
    const quedan = filtrados.length - cuantosSeVen;
    partes.push(
      h(
        'div',
        { clase: 'tarjeta-acciones' },
        boton(`Ver más · quedan ${quedan}`, () => {
          cuantosSeVen += POR_TANDA;
          ctx.repintar();
        })
      )
    );
  }

  return seccion('Trabajos', partes);
}

/**
 * Los dos botones que gobiernan lo fallido: volver a pedir lo que falló después
 * de insistir, y quitar de la cola lo que no se arregla insistiendo.
 * @param {object} ctx
 * @returns {HTMLElement[]}
 */
function accionesDeLosFallidos(ctx) {
  const fallidos = ctx.trabajos.filter((trabajo) => texto(trabajo.estado) === 'fallido');
  if (!fallidos.length) return [];

  const seInsistio = fallidos.filter(falloTrasInsistir);
  const aLaPrimera = fallidos.filter((trabajo) => !falloTrasInsistir(trabajo));

  const partes = [
    aviso(
      `${plural(fallidos.length, 'trabajo ha fallado', 'trabajos han fallado')}. La cola insiste ` +
        'sola cuando el error es de los que pueden cambiar, y cuánto espera depende de qué falló: ' +
        'si es la CUOTA (429), tres veces esperando medio minuto, uno y minuto y medio, porque ' +
        'las cuotas de Vertex se reponen por minutos y insistir en segundos es gastar los ' +
        'intentos contra lo mismo. Para lo demás —un tiempo agotado, una caída del otro lado— ' +
        'cuatro veces a los 2, 4, 8 y 16 segundos. Y ahí para: lo que falla tres o cuatro veces ' +
        'seguidas no funciona a la décima, y dejar la máquina dando vueltas media hora acaba en ' +
        'el mismo sitio con media hora menos. Con el resto no insiste, y no es dejadez: un 4xx ' +
        'dice que la petición está mal y no va a dejar de estarlo, y un 413 dice que algo no ' +
        'cabe, que tampoco cambia por repetirlo.',
      { tono: 'error' }
    )
  ];

  const acciones = [];

  if (seInsistio.length) {
    acciones.push(
      boton(
        seInsistio.length === 1
          ? 'Volver a pedir el que se quedó sin intentos'
          : `Volver a pedir los ${seInsistio.length} que se quedaron sin intentos`,
        () => volverAPedir(seInsistio, ctx),
        { tono: 'principal' }
      )
    );
  }

  if (aLaPrimera.length) {
    acciones.push(
      boton(
        aLaPrimera.length === 1
          ? 'Quitar de la cola el que no se arregla insistiendo'
          : `Quitar de la cola los ${aLaPrimera.length} que no se arreglan insistiendo`,
        async () => {
          const seguro = await confirmar(
            `Se van a quitar de la cola ${plural(
              aLaPrimera.length,
              'trabajo',
              'trabajos'
            )} que fallaron a la primera. No se borra nada de lo generado: solo desaparecen de esta ` +
              'lista, con su explicación. Se pueden volver a pedir desde su pantalla cuando esté ' +
              'arreglado lo que los tumbó. ¿Quitarlos?'
          );
          if (!seguro) return;
          quitarDeLaCola(aLaPrimera, ctx);
        },
        { tono: 'peligro' }
      )
    );
  }

  if (acciones.length) partes.push(h('div', { clase: 'tarjeta-acciones' }, acciones));

  return partes;
}

/**
 * Si un trabajo fallido llegó a fallar DESPUÉS de que la cola insistiera.
 *
 * La cola solo insiste con los errores marcados como reintentables y para a los
 * cuatro intentos (contrato §8). Así que un fallido con más intentos que esos es
 * uno al que se le dio de todo y aun así no salió —merece otra oportunidad,
 * porque puede haber sido la red o una cuota—, y uno con menos es uno al que la
 * cola no quiso insistir, que es lo que hace con un 4xx o con un 413.
 *
 * @param {object} trabajo
 * @returns {boolean}
 */
function falloTrasInsistir(trabajo) {
  return (Number(trabajo.intentos) || 0) > INSISTENCIAS;
}

/**
 * Un trabajo: qué es, cómo va y, si falló, por qué.
 * @param {object} trabajo
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function filaDeTrabajo(trabajo, ctx) {
  const estadoDelTrabajo = texto(trabajo.estado);
  const partes = [
    h(
      'div',
      {
        estilo: {
          display: 'flex',
          'align-items': 'baseline',
          gap: 'var(--espacio-2)',
          'flex-wrap': 'wrap'
        }
      },
      h('span', { estilo: { 'font-weight': '600' } }, queEs(trabajo)),
      h('span', { clase: 'tenue', estilo: { 'font-size': '13px' } }, TIPOS[trabajo.tipo] || trabajo.tipo)
    ),
    h('p', { clase: 'suave', estilo: { margin: '4px 0 0', 'font-size': '13px' } }, comoVa(trabajo))
  ];

  if (estadoDelTrabajo === 'fallido' && texto(trabajo.error)) {
    partes.push(aviso(trabajo.error, { tono: 'error', detalle: trabajo.detalle }));
  } else if (texto(trabajo.error)) {
    // Un trabajo que falló y sigue esperando su siguiente intento: la frase ya
    // está escrita y esconderla sería dejar el «pendiente» sin explicación.
    partes.push(aviso(trabajo.error, { tono: 'nota', detalle: trabajo.detalle }));
  }

  if (texto(trabajo.aviso)) {
    partes.push(aviso(trabajo.aviso, { tono: 'nota' }));
  }

  partes.push(accionesDeUnTrabajo(trabajo, ctx));

  return h(
    'div',
    { estilo: { padding: 'var(--espacio-3) 0', 'border-top': '1px solid var(--borde)' } },
    partes
  );
}

/** Qué es un trabajo, dicho de forma que se reconozca en la lista. */
function queEs(trabajo) {
  const args = trabajo.args && typeof trabajo.args === 'object' ? trabajo.args : {};
  const pieza = texto(args.pieza);

  switch (trabajo.tipo) {
    case 'placa':
    case 'escenario':
      return texto(args.id) || 'sin nombre';
    case 'poster':
      return `${texto(args.id) || 'sin nombre'} · ${texto(args.proporcion) || 'sin formato'}`;
    case 'keyframe':
    case 'clip':
    case 'clip-consultar':
      return `${texto(args.id) || 'sin toma'} · ${pieza || 'sin pieza'}`;
    case 'musica':
      return `${texto(args.id) || 'sin id'} · ${pieza || 'sin pieza'}`;
    case 'voz':
    case 'alinear':
      return `${texto(args.bloque) || 'sin bloque'} · ${pieza || 'sin pieza'}`;
    case 'desglose-escena':
      return `Episodio ${texto(args.episodio) || '?'}, escena ${texto(args.escena) || '?'}`;
    case 'montaje':
      return `${texto(args.trabajo) || 'sin nombre'} · capa ${texto(args.capa) || 'sin capa'}`;
    default:
      return texto(args.id) || texto(trabajo.id);
  }
}

/** Cómo va un trabajo, con palabras y con la hora. */
function comoVa(trabajo) {
  const cuando = texto(trabajo.actualizado);
  const intentos = Number(trabajo.intentos) || 0;
  const cola = intentos ? ` · ${plural(intentos, 'intento', 'intentos')}` : '';

  switch (texto(trabajo.estado)) {
    case 'en_curso':
      return `Generándose ahora · empezó ${fecha(cuando)}${cola}`;
    case 'pendiente':
      return trabajo.proximo
        ? `Esperando · vuelve a mirarse ${fecha(trabajo.proximo)}${cola}`
        : `Esperando turno${cola}`;
    case 'hecho':
      return `Hecho ${fecha(cuando)}${cola}`;
    case 'fallido':
      return `Falló ${fecha(cuando)}${cola}`;
    case 'detenido':
      return `Detenido ${fecha(cuando)}${cola}`;
    default:
      return `Sin estado · ${fecha(cuando)}`;
  }
}

/**
 * Los botones de un trabajo. Volver a pedirlo siempre se puede; quitarlo de la
 * lista, solo cuando no deja nada colgando.
 * @param {object} trabajo
 * @param {object} ctx
 * @returns {HTMLElement}
 */
function accionesDeUnTrabajo(trabajo, ctx) {
  const estadoDelTrabajo = texto(trabajo.estado);
  const enMarcha = estadoDelTrabajo === 'en_curso' || estadoDelTrabajo === 'pendiente';
  const acciones = [];

  if (enMarcha) {
    acciones.push(
      boton('Volver a pedirlo', () => {}, {
        desactivado:
          'Este trabajo ya está pedido y la cola se está ocupando de él. Pedirlo otra vez ahora ' +
          'sería generarlo dos veces y pagarlo dos veces.'
      })
    );
  } else {
    acciones.push(boton('Volver a pedirlo', () => volverAPedir([trabajo], ctx)));
  }

  const porQueNo = porQueNoSeQuita(trabajo, ctx.estado);
  acciones.push(
    porQueNo
      ? boton('Quitar de la lista', () => {}, { desactivado: porQueNo })
      : boton('Quitar de la lista', () => quitarDeLaCola([trabajo], ctx), { tono: 'suave' })
  );

  return h('div', { clase: 'tarjeta-acciones', estilo: { 'margin-top': 'var(--espacio-2)' } }, acciones);
}

/**
 * Por qué un trabajo no se puede quitar de la cola, o null si sí se puede.
 *
 * Lo caro es la consulta de un clip: si se quita mientras su toma sigue con una
 * operación de Veo apuntada, ese clip se queda generándose en Google, se cobra
 * igual, y nadie vuelve a preguntar por él. Eso es exactamente lo que la cola
 * existe para que no pase.
 *
 * @param {object} trabajo
 * @param {object} estado
 * @returns {string|null}
 */
function porQueNoSeQuita(trabajo, estado) {
  const estadoDelTrabajo = texto(trabajo.estado);

  if (estadoDelTrabajo === 'en_curso') {
    return (
      'Este trabajo se está haciendo ahora mismo. Quitarlo de la lista no lo pararía: solo dejaría ' +
      'de haber dónde apuntar cómo acaba.'
    );
  }

  if (trabajo.tipo === 'montaje' && texto(trabajo.operacion) && texto(trabajo.estado) !== 'hecho') {
    return (
      'Este montaje ya está lanzado en la nube y puede llevar media hora de ffmpeg hecha. Este ' +
      'trabajo es lo único que va a recoger el resultado, así que quitarlo dejaría el vídeo montado ' +
      'sin que nadie lo apunte. Espera a que termine.'
    );
  }

  if (trabajo.tipo === 'clip-consultar') {
    const args = trabajo.args && typeof trabajo.args === 'object' ? trabajo.args : {};
    const clave = `${texto(args.pieza)}/${texto(args.id)}`;
    const tomas = estado && typeof estado.tomas === 'object' && estado.tomas ? estado.tomas : {};
    const entrada = tomas[clave];
    if (entrada && entrada.operacion_en_curso) {
      return (
        `La toma ${texto(args.id)} todavía tiene una operación de Veo apuntada: Google está ` +
        'generando ese clip y ya está pagado. Esta consulta es lo único que va a recogerlo, así ' +
        'que quitarla dejaría el vídeo en el bucket sin que nadie lo apunte. Espera a que termine.'
      );
    }
  }

  return null;
}

/**
 * Vuelve a poner unos trabajos en la cola, con una sola escritura del estado.
 * @param {object[]} unos
 * @param {object} ctx
 */
function volverAPedir(unos, ctx) {
  try {
    encolarVarios(unos.map((trabajo) => ({ tipo: trabajo.tipo, args: trabajo.args || {} })));
    queja = null;
  } catch (fallo) {
    queja = comoErrorDeCara(fallo);
  }
  ctx.repintar();
}

/**
 * Saca unos trabajos de la cola. No borra nada de lo generado: lo que hay en el
 * bucket sigue donde estaba.
 * @param {object[]} unos
 * @param {object} ctx
 */
function quitarDeLaCola(unos, ctx) {
  const fuera = new Set(unos.map((trabajo) => trabajo.id));

  cambiar((vivo) => {
    if (!Array.isArray(vivo.cola)) return;
    vivo.cola = vivo.cola.filter((trabajo) => !(trabajo && fuera.has(trabajo.id)));
  })
    .then(() => {
      queja = null;
    })
    .catch((fallo) => {
      queja = comoErrorDeCara(fallo);
    })
    .finally(() => {
      ctx.repintar();
    });
}

// ---------------------------------------------------------------------------
// Menudencias
// ---------------------------------------------------------------------------

/** Un mapa de niveles con los tres puestos, aunque el estado traiga menos. */
function porNiveles(rama) {
  const salida = { calidad: 0, medio: 0, economico: 0 };
  if (!rama || typeof rama !== 'object') return salida;
  for (const nivel of Object.keys(rama)) {
    const cuanto = Number(rama[nivel]);
    if (!Number.isFinite(cuanto)) continue;
    salida[nivel] = (salida[nivel] || 0) + cuanto;
  }
  return salida;
}

/** La suma de un mapa de niveles. */
function sumar(niveles) {
  return Object.values(niveles).reduce((total, cuanto) => total + (Number(cuanto) || 0), 0);
}

/** Los euros de un mapa de niveles con su tabla de precios. */
function eurosDeNiveles(niveles, precios) {
  let total = 0;
  for (const nivel of Object.keys(niveles)) {
    total += (Number(niveles[nivel]) || 0) * (Number(precios[nivel]) || 0);
  }
  return total;
}

/** El nombre de un nivel como se escribe en español. */
function nombreDeNivel(nivel) {
  if (nivel === 'economico') return 'económico';
  return String(nivel);
}

/** Euros con coma decimal, como se escriben aquí: «18,40 €». */
function enEuros(cantidad) {
  const numero = Number(cantidad);
  if (!Number.isFinite(numero) || numero < 0) return 'sin calcular';
  const [entera, decimal] = numero.toFixed(2).split('.');
  const conPunto = entera.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${conPunto},${decimal} €`;
}

/** Cuánto lleva algo desde una hora ISO, dicho en español. */
function cuantoLleva(iso) {
  const cuando = Date.parse(iso);
  if (!Number.isFinite(cuando)) return 'sin apuntar desde cuándo';
  return `lleva ${enSegundos(Math.max(0, (Date.now() - cuando) / 1000))}`;
}

/** La hora de ahora, como se guarda. */
function ahoraIso() {
  return new Date().toISOString();
}

/** Un texto limpio, o cadena vacía. Vale para null, números y basura. */
function texto(valor) {
  return typeof valor === 'string' ? valor.trim() : valor == null ? '' : String(valor).trim();
}

/** Lo que dijo un fallo del navegador, literal, para el detalle. */
function mensajeDe(fallo) {
  if (!fallo) return null;
  if (typeof fallo === 'string') return fallo;
  if (fallo.message) return String(fallo.message);
  return String(fallo);
}

/**
 * Cualquier cosa que se haya lanzado, convertida en el error que se enseña.
 * @param {*} fallo
 * @returns {ErrorDeCara}
 */
function comoErrorDeCara(fallo) {
  if (fallo instanceof ErrorDeCara) return fallo;
  return new ErrorDeCara(
    'El estudio se ha roto por dentro pintando la cola. No es un problema de tu cuenta ni de la ' +
      'nube: es un fallo del propio código. Debajo está lo que dijo el navegador, tal cual.',
    { detalle: mensajeDe(fallo), reintentable: false, http: 500 }
  );
}
