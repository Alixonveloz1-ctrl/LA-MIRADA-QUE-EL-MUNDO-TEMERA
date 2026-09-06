// Las piezas con las que se pintan las ocho pantallas — docs/contrato.md §9.
//
// Sin framework, sin paso de compilación y sin CDN: el navegador carga este
// módulo tal cual y `h()` crea elementos con document.createElement y ya. Lo
// que aquí no esté, no se pinta en ninguna pantalla.
//
// Todo está pensado para lo único que hay: un teléfono, un pulgar, una mano y
// luz mala. De ahí salen las decisiones que parecen manías y no lo son:
//
//   · Nada que se pulse baja de 48 px de alto (var --toque en estilo.css).
//   · Un botón apagado no se apaga a secas: dice POR QUÉ, con palabras, en el
//     title y en el aria-label, y al tocarlo lo repite en un anuncio abajo, al
//     alcance del pulgar. Un botón gris sin explicación es un callejón.
//   · Los errores de Google son larguísimos: primero la frase en español, y el
//     detalle plegado dentro de un <details> para quien quiera abrirlo.
//   · Nada de window.confirm ni window.alert: diálogos propios, en español y
//     con botones del tamaño de un dedo.
//   · La tarjeta es la unidad de toda la aplicación, y lleva su media dentro
//     porque el usuario solo decide sobre cosas que se ven o se oyen.
//
// Este módulo no sabe nada de la serie, del bucket ni de los modos: recibe
// texto y nodos, y devuelve nodos.

import { porcentaje } from './formato.js';

// ---------------------------------------------------------------------------
// Los fallos que no recogió nadie
// ---------------------------------------------------------------------------

/**
 * El nombre del evento con el que un fallo suelto llega a quien lo pinta.
 *
 * POR QUÉ UN EVENTO Y NO UNA LLAMADA. Quien pinta es `app/main.js`, y main.js ya
 * importa este módulo: importarlo de vuelta sería un círculo. Es el mismo camino
 * que usa `EVENTO_CLAVE_NECESARIA` en `app/api.js` por la misma razón.
 *
 * Y POR QUÉ NO RELANZARLO A SECAS, que es lo que se hacía. Un error lanzado
 * fuera de la pila —desde un microtask o desde un temporizador— no tiene ningún
 * archivo al que el navegador pueda atribuirlo, y Safari entonces lo tapa: lo
 * entrega como «Script error.», sin mensaje, sin archivo y sin línea. Por el
 * evento viaja el objeto Error entero, con su texto y su pila, y no depende de
 * que el navegador quiera contarlo.
 */
export const EVENTO_FALLO_SUELTO = 'fallo-suelto';

/**
 * Entrega un fallo que nadie recogió a quien sepa pintarlo.
 * @param {*} fallo
 */
export function contarFalloSuelto(fallo) {
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_FALLO_SUELTO, { detail: fallo }));
  } catch {
    // Si ni siquiera se puede lanzar el evento, al menos que quede en la consola.
    console.error('Fallo sin recoger, y sin poder avisar', fallo);
  }
}

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------

/**
 * Los nombres en español de los eventos del navegador. Cualquier propiedad que
 * empiece por «al» y siga con mayúscula es un oyente; si no está en la tabla,
 * se usa el resto del nombre en minúsculas (alScroll → «scroll»).
 */
const EVENTOS = {
  alClic: 'click',
  alDobleClic: 'dblclick',
  alCambio: 'change',
  alEscribir: 'input',
  alEnviar: 'submit',
  alFoco: 'focus',
  alDesenfocar: 'blur',
  alTecla: 'keydown',
  alSoltarTecla: 'keyup',
  alTocar: 'pointerdown',
  alCargar: 'load',
  alError: 'error',
  alReproducir: 'play',
  alPausar: 'pause',
  alTerminar: 'ended',
  alDesplazar: 'scroll',
  alCerrar: 'close',
  alCancelar: 'cancel',
  alDesplegar: 'toggle',
};

/**
 * Los estados que se pintan como punto de color, y la familia visual de cada
 * uno. Vienen de dos sitios: los de la cola (docs/contrato.md §8: pendiente,
 * en_curso, hecho, fallido, detenido) y los del material (aprobada o no).
 *
 * Se normaliza el guion bajo a guion medio para que «en_curso» y «en-curso»
 * sean lo mismo, que es lo que va a pasar en cuanto haya dos pantallas.
 */
const ESTADOS = {
  'pendiente':    { familia: 'pendiente', texto: 'Pendiente' },
  'sin-empezar':  { familia: 'pendiente', texto: 'Sin empezar' },
  'sin-keyframe': { familia: 'pendiente', texto: 'Sin keyframe' },
  'por-aprobar':  { familia: 'pendiente', texto: 'Por aprobar' },
  'en-curso':     { familia: 'en-curso',  texto: 'En curso' },
  'generando':    { familia: 'en-curso',  texto: 'Generando' },
  'hecho':        { familia: 'listo',     texto: 'Listo' },
  'listo':        { familia: 'listo',     texto: 'Listo' },
  'aprobada':     { familia: 'listo',     texto: 'Aprobada' },
  'aprobado':     { familia: 'listo',     texto: 'Aprobado' },
  'elegido':      { familia: 'listo',     texto: 'Elegido' },
  'fallido':      { familia: 'fallido',   texto: 'Fallido' },
  'fallida':      { familia: 'fallido',   texto: 'Fallida' },
  'error':        { familia: 'fallido',   texto: 'Ha fallado' },
  'detenido':     { familia: 'detenido',  texto: 'Detenido' },
  'detenida':     { familia: 'detenido',  texto: 'Detenida' },
};

/** La palabra que marca cada aviso, para que no dependa solo del color. */
const MARCAS_DE_AVISO = {
  error: 'Error',
  nota: 'Nota',
  bien: 'Bien',
};

/** Cuánto se queda en pantalla un anuncio antes de irse solo. */
const DURACION_ANUNCIO_MS = 5000;

// ---------------------------------------------------------------------------
// h() — el único constructor de elementos
// ---------------------------------------------------------------------------

/**
 * Crea un elemento.
 *
 *   h('p', { clase: 'nota' }, 'Hola')
 *   h('button', { clase: ['boton', activa && 'activa'], alClic: pulsar }, 'Ir')
 *   h('div', { estilo: { width: '50%' } }, hijo, [otros, mas], null)
 *   h('p', 'Sin props también vale')
 *
 * Propiedades con nombre propio:
 *   · `clase`  — cadena, array (los falsos se caen) u objeto { clase: bool }.
 *   · `estilo` — objeto de estilos; las claves con guion van por setProperty,
 *                así que las variables CSS («--relleno») funcionan.
 *   · `texto`  — el contenido de texto, antes de los hijos.
 *   · `al…`    — un oyente de evento (ver la tabla EVENTOS).
 * Lo demás se pone como propiedad si el elemento la tiene (value, disabled,
 * src…) y como atributo si no (aria-label, data-…, role en navegadores viejos).
 *
 * Los hijos pueden venir anidados en arrays y pueden ser null, false o '' — se
 * saltan— para que un `condicion && h(...)` se escriba sin ceremonia. Nunca se
 * inyecta HTML: `innerHTML` está bloqueado a propósito, todo entra como texto.
 */
export function h(etiqueta, props, ...hijos) {
  const nodo = document.createElement(etiqueta);

  // El segundo argumento puede ser ya un hijo: h('p', 'Hola').
  let ajustes = props;
  if (esHijo(props)) {
    hijos.unshift(props);
    ajustes = null;
  }

  if (ajustes && typeof ajustes === 'object') {
    for (const clave of Object.keys(ajustes)) {
      aplicar(nodo, clave, ajustes[clave]);
    }
  }

  agregarHijos(nodo, hijos);
  return nodo;
}

/** ¿Esto que me han pasado en el sitio de las props es en realidad un hijo? */
function esHijo(valor) {
  if (valor == null) return false;                 // h('div', null, …): sin props
  if (typeof valor === 'string' || typeof valor === 'number') return true;
  if (valor === false || valor === true) return true;
  if (Array.isArray(valor)) return true;
  return typeof Node !== 'undefined' && valor instanceof Node;
}

function aplicar(nodo, clave, valor) {
  // Un atributo con null, undefined o false sencillamente no se pone.
  if (valor == null || valor === false) return;

  if (clave === 'clase') {
    const clases = clasesDe(valor);
    if (clases) nodo.className = clases;
    return;
  }

  if (clave === 'estilo') {
    aplicarEstilo(nodo, valor);
    return;
  }

  if (clave === 'texto') {
    nodo.textContent = String(valor);
    return;
  }

  // Nada de HTML en cadena: es la única forma de que no se cuele nunca.
  if (clave === 'innerHTML' || clave === 'outerHTML' || clave === 'html') return;

  const evento = eventoDe(clave);
  if (evento) {
    if (typeof valor === 'function') nodo.addEventListener(evento, valor);
    return;
  }

  if (valor === true) {
    // Atributos booleanos escritos como booleanos: { hidden: true }.
    if (clave in nodo) nodo[clave] = true;
    else nodo.setAttribute(clave, '');
    return;
  }

  if (clave in nodo) {
    try {
      nodo[clave] = valor;
      return;
    } catch {
      // Alguna propiedad es de solo lectura; se cae al atributo.
    }
  }
  nodo.setAttribute(clave, String(valor));
}

/** «alClic» → «click». Devuelve null si la clave no es un oyente. */
function eventoDe(clave) {
  if (!/^al[A-Z]/.test(clave)) return null;
  return EVENTOS[clave] || clave.slice(2).toLowerCase();
}

/** Cadena, array u objeto → la cadena de clases, sin huecos ni falsos. */
function clasesDe(valor) {
  if (typeof valor === 'string') return valor.trim();
  if (Array.isArray(valor)) {
    return valor.filter(Boolean).map((c) => String(c).trim()).filter(Boolean).join(' ');
  }
  if (valor && typeof valor === 'object') {
    return Object.keys(valor).filter((c) => valor[c]).join(' ');
  }
  return '';
}

function aplicarEstilo(nodo, valor) {
  if (typeof valor === 'string') {
    nodo.style.cssText = valor;
    return;
  }
  if (!valor || typeof valor !== 'object') return;
  for (const propiedad of Object.keys(valor)) {
    const dato = valor[propiedad];
    if (dato == null || dato === false) continue;
    if (propiedad.includes('-')) nodo.style.setProperty(propiedad, String(dato));
    else nodo.style[propiedad] = String(dato);
  }
}

function agregarHijos(nodo, hijos) {
  for (const hijo of hijos) {
    if (hijo == null || hijo === false || hijo === true || hijo === '') continue;
    if (Array.isArray(hijo)) {
      agregarHijos(nodo, hijo);
      continue;
    }
    if (typeof Node !== 'undefined' && hijo instanceof Node) {
      nodo.appendChild(hijo);
      continue;
    }
    nodo.appendChild(document.createTextNode(String(hijo)));
  }
}

// ---------------------------------------------------------------------------
// Estructura: pantalla y sección
// ---------------------------------------------------------------------------

/**
 * El envoltorio de una pantalla entera: su título y sus secciones.
 * El título va dentro del contenido y no en una barra fija arriba, porque en un
 * teléfono la altura es lo que falta y el título se puede ir con el desplazamiento.
 */
export function pantalla(titulo, ...secciones) {
  return h('div', { clase: 'pantalla' },
    titulo ? h('h1', { clase: 'pantalla-titulo' }, titulo) : null,
    secciones,
  );
}

/**
 * Un bloque con su encabezado. El cuerpo es la rejilla de tarjetas: una columna
 * en vertical y dos en horizontal, y todo lo que no sea tarjeta (un aviso, una
 * barra de progreso, un filtro) ocupa el ancho entero. Eso lo hace estilo.css.
 */
export function seccion(titulo, ...hijos) {
  return h('section', { clase: 'seccion' },
    titulo ? h('h2', { clase: 'seccion-titulo' }, titulo) : null,
    h('div', { clase: 'seccion-cuerpo' }, hijos),
  );
}

// ---------------------------------------------------------------------------
// La tarjeta
// ---------------------------------------------------------------------------

/**
 * La unidad de toda la aplicación: un título, lo que se mira o se escucha, un
 * pie con los datos y los botones debajo.
 *
 *   tarjeta({
 *     titulo: 'A4 · el patio',
 *     media: h('img', { src: url, alt: 'Keyframe de la toma A4' }),
 *     pie: `${segundos(4)} · ${bytes(peso)}`,
 *     estado: 'por-aprobar',
 *     acciones: [boton('Aprobar', aprobar, { tono: 'principal' })],
 *   })
 *
 * `media` es el <img>, el <audio> o el <video> ya construido: la tarjeta no lo
 * fabrica, solo le da su marco 16:9 con fondo negro (o su fila de reproductor,
 * si es audio, que no tiene forma). Va antes que las acciones a propósito: la
 * regla del contrato dice que no hay botón de aprobar sin la imagen al lado.
 *
 * `estado` pinta el punto de color con su etiqueta legible; acepta una cadena
 * («en_curso») o un objeto { tipo, texto } cuando la etiqueta de la tabla no
 * dice bastante en esa pantalla.
 */
export function tarjeta({ titulo, media, pie, acciones, estado } = {}) {
  const marca = estado ? puntoDeEstado(estado) : null;

  const cabecera = (titulo || marca)
    ? h('header', { clase: 'tarjeta-cabecera' },
        titulo != null && titulo !== ''
          ? (typeof titulo === 'string' || typeof titulo === 'number'
              ? h('h3', { clase: 'tarjeta-titulo' }, String(titulo))
              : titulo)
          : null,
        marca,
      )
    : null;

  return h('article', { clase: 'tarjeta' },
    cabecera,
    media ? h('div', { clase: ['tarjeta-media', claseDeMedia(media)] }, media) : null,
    pie != null && pie !== ''
      ? h('div', { clase: 'tarjeta-pie' },
          typeof pie === 'string' || typeof pie === 'number'
            ? h('p', { clase: 'tarjeta-texto' }, String(pie))
            : pie)
      : null,
    acciones && (!Array.isArray(acciones) || acciones.length)
      ? h('div', { clase: 'tarjeta-acciones' }, acciones)
      : null,
  );
}

/**
 * El audio no es 16:9: es una fila de controles. Se distingue aquí, en el
 * navegador, y no con un selector `:has()` en la hoja, para que funcione
 * también en los Safari que no lo traen.
 */
function claseDeMedia(media) {
  const etiqueta = media && media.tagName ? String(media.tagName).toLowerCase() : '';
  return etiqueta === 'audio' ? 'media-audio' : 'media-visual';
}

/**
 * El punto de color con su palabra al lado. El color nunca va solo: cada
 * familia tiene además su forma (aro hueco, disco, disco que late, cuadrado,
 * barra) y siempre lleva su texto escrito, que es lo que de verdad se lee.
 */
function puntoDeEstado(estado) {
  const crudo = typeof estado === 'string' || typeof estado === 'number'
    ? { tipo: String(estado) }
    : (estado || {});

  const tipo = String(crudo.tipo ?? '').trim().toLowerCase().replace(/_/g, '-');
  const conocido = ESTADOS[tipo];
  const familia = conocido ? conocido.familia : 'otro';
  const texto = crudo.texto != null && crudo.texto !== ''
    ? String(crudo.texto)
    : (conocido ? conocido.texto : primeraMayuscula(tipo.replace(/-/g, ' ')) || 'Sin estado');

  return h('span', { clase: ['estado', `estado-${familia}`], title: texto },
    h('span', { clase: 'estado-punto', 'aria-hidden': 'true' }),
    h('span', { clase: 'estado-texto' }, texto),
  );
}

// ---------------------------------------------------------------------------
// Botones
// ---------------------------------------------------------------------------

/**
 * Un botón de 48 px de alto como mínimo, que es lo que ocupa un pulgar.
 *
 *   boton('Generar', generar, { tono: 'principal' })
 *   boton('Generar clip', lanzar, { desactivado: 'Falta aprobar el keyframe. Un clip cuesta un euro y un keyframe céntimos.' })
 *
 * `tono`: «principal» (lleno), «peligro» (perfilado en rojo: borra o gasta),
 * «suave» (el de siempre). Sin tono, se pinta como «suave».
 *
 * FALTA EN EL CONTRATO: el contrato fija `{ tono, desactivado }` pero no dice
 * dónde viaja el motivo, y un botón apagado sin motivo es un callejón sin
 * salida en una pantalla de teléfono. Se resuelve sin añadir opciones nuevas:
 * `desactivado` acepta la frase misma («desactivado: 'Falta el ancla'»), o
 * `{ porque: '…' }`, además del `true` de siempre. Si llega un `true` pelado se
 * pone una frase genérica, que es peor que la buena pero mejor que el silencio.
 */
export function boton(texto, alAccionar, { tono, desactivado } = {}) {
  const motivo = motivoDeDesactivado(desactivado);
  const apagado = Boolean(desactivado);
  const nombre = String(texto ?? '');

  const elemento = h('button', {
    type: 'button',
    clase: ['boton', tono ? `boton-${tono}` : 'boton-suave', apagado && 'boton-desactivado'],
    // No se usa el `disabled` del navegador a propósito: un botón deshabilitado
    // de verdad no recibe el toque, y aquí el toque es justo lo que tiene que
    // contar por qué no se puede. Los lectores de pantalla se enteran igual con
    // aria-disabled, y el aria-label lleva el motivo pegado.
    'aria-disabled': apagado ? 'true' : 'false',
    'aria-label': apagado ? `${nombre}. ${motivo}` : null,
    title: apagado ? motivo : null,
    alClic: (evento) => {
      if (apagado) {
        evento.preventDefault();
        anunciar(motivo);
        return;
      }
      if (typeof alAccionar !== 'function') return;

      // LO QUE DEVUELVE EL MANEJADOR NO SE TIRA, y esto no es celo: la mitad de
      // los manejadores de esta aplicación son `async` —elegir una voz, cambiarla,
      // montar, aprobar—, así que devuelven una promesa. Al tirarla, cualquier
      // fallo dentro de ellos se convertía en un «unhandledrejection»: el aviso
      // de arriba del todo que dice «algo se ha roto y nadie lo ha recogido», sin
      // decir qué botón ni qué pantalla. Un fallo sin sitio es un fallo que
      // cuesta el triple de encontrar.
      //
      // No se traga: se le pega el nombre del botón y se ENTREGA EN MANO a quien
      // pinta los fallos sueltos, con un evento.
      //
      // Antes se relanzaba con `queueMicrotask(() => { throw ... })` para que
      // saliera por el camino de siempre. Era peor el remedio: un error lanzado
      // desde un microtask no tiene ningún archivo al que Safari pueda
      // atribuirlo, así que Safari lo tapa y lo entrega como «Script error.»,
      // sin mensaje, sin archivo y sin línea. Es decir, el intento de decir de
      // dónde venía el fallo era justo lo que borraba de dónde venía. Con un
      // evento el objeto Error llega entero y no pasa por el navegador.
      const devuelto = alAccionar(evento);
      if (devuelto && typeof devuelto.then === 'function') {
        devuelto.catch((fallo) => {
          const dicho = fallo && fallo.mensaje ? fallo.mensaje
            : fallo && fallo.message ? fallo.message
            : String(fallo);
          const conSitio = new Error(`Al pulsar «${nombre}»: ${dicho}`);
          conSitio.stack = fallo && fallo.stack ? fallo.stack : conSitio.stack;
          contarFalloSuelto(conSitio);
        });
      }
    },
  }, nombre);

  return elemento;
}

function motivoDeDesactivado(desactivado) {
  if (typeof desactivado === 'string' && desactivado.trim()) return desactivado.trim();
  if (desactivado && typeof desactivado === 'object') {
    const porque = desactivado.porque ?? desactivado.motivo ?? desactivado.texto;
    if (typeof porque === 'string' && porque.trim()) return porque.trim();
  }
  return 'Todavía no se puede: falta un paso antes de este.';
}

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------

/**
 * Una frase en español, y debajo, plegado, lo que dijo Google.
 *
 *   aviso(err.mensaje, { tono: 'error', detalle: err.detalle })
 *
 * El detalle va dentro de un <details> cerrado porque el error de Google es
 * larguísimo y empuja fuera de la pantalla lo único que hace falta leer para
 * saber qué pasa. Quien quiera el original lo abre de un toque.
 *
 * El tono se ve por el color, pero también por la palabra que lo marca
 * («Error», «Nota», «Bien») y por el borde: nunca solo por el color.
 */
export function aviso(mensaje, { tono = 'nota', detalle } = {}) {
  const clase = String(tono || 'nota');
  const marca = MARCAS_DE_AVISO[clase] || 'Nota';

  return h('div', {
    clase: ['aviso', `aviso-${clase}`],
    role: clase === 'error' ? 'alert' : 'status',
  },
    h('p', { clase: 'aviso-frase' },
      h('span', { clase: 'aviso-marca' }, marca),
      h('span', { clase: 'aviso-texto' }, String(mensaje ?? '')),
    ),
    detalle
      ? h('details', { clase: 'aviso-detalle' },
          h('summary', { clase: 'aviso-resumen' }, 'Ver lo que ha contestado, palabra por palabra'),
          typeof detalle === 'string' || typeof detalle === 'number'
            ? h('pre', { clase: 'aviso-crudo' }, String(detalle))
            : detalle,
        )
      : null,
  );
}

// ---------------------------------------------------------------------------
// Progreso
// ---------------------------------------------------------------------------

/**
 * Barra de progreso con número Y fracción, no solo con porcentaje.
 *
 *   barra(12, 24, { etiqueta: 'Keyframes del teaser' })   →  «12 de 24 · 50 %»
 *
 * Con 400 planos el porcentaje solo no dice nada: «49 %» no deja saber si
 * quedan diez o doscientos. La cuenta sí.
 */
export function barra(hechas, total, { etiqueta } = {}) {
  const tope = Math.max(0, Math.floor(Number(total)) || 0);
  const parte = Math.min(tope, Math.max(0, Math.floor(Number(hechas)) || 0));
  const proporcion = tope > 0 ? (parte / tope) * 100 : 0;
  const fraccion = `${parte} de ${tope}`;

  return h('div', {
    clase: 'barra',
    role: 'progressbar',
    'aria-valuemin': '0',
    'aria-valuemax': String(tope),
    'aria-valuenow': String(parte),
    'aria-label': etiqueta ? `${etiqueta}: ${fraccion}` : fraccion,
  },
    h('div', { clase: 'barra-linea' },
      h('span', {
        clase: 'barra-relleno',
        estilo: { width: `${proporcion.toFixed(1)}%` },
      }),
    ),
    h('p', { clase: 'barra-pie' },
      etiqueta ? h('span', { clase: 'barra-etiqueta' }, String(etiqueta)) : null,
      h('span', { clase: 'barra-cuenta' }, fraccion),
      h('span', { clase: 'barra-porcentaje' }, porcentaje(parte, tope)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Filtro
// ---------------------------------------------------------------------------

/**
 * Pastillas en una fila que se arrastra de lado, nunca un <select>.
 *
 *   filtro([{ id: 'todo', texto: 'Todo', cuenta: 24 },
 *           { id: 'sin-keyframe', texto: 'Sin keyframe', cuenta: 9 }],
 *          activo, (id) => repintar(id))
 *
 * Un <select> en un teléfono abre una rueda que tapa la pantalla y esconde
 * cuántas cosas hay en cada estado justo cuando se está eligiendo. Las
 * pastillas se ven todas de un vistazo, con su cuenta al lado, y se pulsan con
 * el pulgar sin abrir nada.
 *
 * FALTA EN EL CONTRATO: la forma de cada opción. Se acepta lo obvio: una
 * cadena («todo»), o un objeto { id, texto, cuenta }. También vale `etiqueta`
 * en lugar de `texto`, porque es como se llama en las pantallas.
 */
export function filtro(opciones, valor, alCambiar) {
  const contenedor = h('div', { clase: 'filtro', role: 'group', 'aria-label': 'Filtrar por estado' });
  const lista = normalizarOpciones(opciones);
  let activa = null;

  for (const opcion of lista) {
    const puesta = String(opcion.id) === String(valor ?? '');
    const pastilla = h('button', {
      type: 'button',
      clase: ['pastilla', puesta && 'activa'],
      'aria-pressed': puesta ? 'true' : 'false',
      alClic: () => {
        for (const otra of contenedor.querySelectorAll('.pastilla')) {
          otra.classList.remove('activa');
          otra.setAttribute('aria-pressed', 'false');
        }
        pastilla.classList.add('activa');
        pastilla.setAttribute('aria-pressed', 'true');
        if (typeof alCambiar === 'function') alCambiar(opcion.id);
      },
    },
      h('span', { clase: 'pastilla-texto' }, opcion.texto),
      opcion.cuenta != null
        ? h('span', { clase: 'pastilla-cuenta' }, String(opcion.cuenta))
        : null,
    );

    if (puesta) activa = pastilla;
    contenedor.appendChild(pastilla);
  }

  // Si la pastilla puesta cae fuera de lo que se ve, se acerca. Solo de lado:
  // mover la página entera por un filtro sería peor que no verlo.
  if (activa && typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => {
      if (!activa.offsetParent) return;
      const centro = activa.offsetLeft - (contenedor.clientWidth / 2) + (activa.offsetWidth / 2);
      contenedor.scrollLeft = Math.max(0, centro);
    });
  }

  return contenedor;
}

function normalizarOpciones(opciones) {
  const lista = Array.isArray(opciones) ? opciones : [];
  const salida = [];
  for (const opcion of lista) {
    if (opcion == null) continue;
    if (typeof opcion === 'string' || typeof opcion === 'number') {
      salida.push({ id: String(opcion), texto: String(opcion), cuenta: null });
      continue;
    }
    const id = String(opcion.id ?? opcion.valor ?? '');
    const texto = String(opcion.texto ?? opcion.etiqueta ?? id);
    const cuenta = opcion.cuenta ?? opcion.n ?? null;
    salida.push({ id, texto, cuenta: cuenta == null ? null : cuenta });
  }
  return salida;
}

// ---------------------------------------------------------------------------
// Espera
// ---------------------------------------------------------------------------

/**
 * «Se está haciendo algo», con su rueda pequeña y su frase. Se pinta con
 * aria-live para que también se anuncie sin mirar.
 */
export function espera(texto = 'Trabajando…') {
  return h('p', { clase: 'espera', role: 'status', 'aria-live': 'polite' },
    h('span', { clase: 'espera-rueda', 'aria-hidden': 'true' }),
    h('span', { clase: 'espera-texto' }, String(texto)),
  );
}

// ---------------------------------------------------------------------------
// Confirmar
// ---------------------------------------------------------------------------

/**
 * Diálogo propio con <dialog>. Nunca window.confirm: sale en el idioma del
 * navegador, con botones diminutos y sin ningún control sobre cómo se lee.
 *
 *   if (await confirmar('¿Cambiar el ancla de Saharis? Sus 11 placas quedarán por aprobar.')) …
 *
 * Se cierra con «No» al tocar fuera y con la tecla de escape, que es lo que
 * espera cualquiera: lo que no se entiende no se acepta.
 */
export function confirmar(pregunta) {
  return new Promise((resolver) => {
    let resuelto = false;

    const terminar = (respuesta) => {
      if (resuelto) return;
      resuelto = true;
      document.removeEventListener('keydown', alEscape, true);
      try {
        if (dialogo.open && typeof dialogo.close === 'function') dialogo.close();
      } catch {
        // Da igual por qué no cerró: se quita del documento de todas formas.
      }
      dialogo.remove();
      resolver(respuesta);
    };

    const alEscape = (evento) => {
      if (evento.key === 'Escape') terminar(false);
    };

    const no = boton('No', () => terminar(false), { tono: 'suave' });
    const si = boton('Sí', () => terminar(true), { tono: 'principal' });

    const dialogo = h('dialog', {
      clase: 'confirmar',
      'aria-label': 'Confirmar',
      alCancelar: (evento) => {
        evento.preventDefault();
        terminar(false);
      },
      alClic: (evento) => {
        // Un toque en el fondo oscuro llega al propio <dialog>.
        if (evento.target === dialogo) terminar(false);
      },
    },
      h('div', { clase: 'confirmar-caja' },
        h('p', { clase: 'confirmar-pregunta' }, String(pregunta ?? '¿Seguro?')),
        h('div', { clase: 'confirmar-acciones' }, no, si),
      ),
    );

    document.body.appendChild(dialogo);
    document.addEventListener('keydown', alEscape, true);

    if (typeof dialogo.showModal === 'function') {
      dialogo.showModal();
    } else {
      // Navegador sin <dialog> modal: se abre igual y la hoja le pone el fondo.
      dialogo.setAttribute('open', '');
      dialogo.classList.add('sin-modal');
    }

    if (typeof no.focus === 'function') no.focus();
  });
}

// ---------------------------------------------------------------------------
// Anuncios
// ---------------------------------------------------------------------------

let anuncioNodo = null;
let anuncioReloj = null;

/**
 * Una frase corta abajo, encima de las pestañas, donde llega el pulgar. Es
 * donde aparece el motivo de un botón apagado cuando se toca. No es un error
 * con su tarjeta: eso es `aviso()`. Esto solo dice, de paso, por qué no.
 *
 * No se exporta: fuera de este módulo, lo que hay para hablar es `aviso()`.
 */
function anunciar(texto) {
  if (typeof document === 'undefined' || !document.body) return;

  if (!anuncioNodo || !anuncioNodo.isConnected) {
    anuncioNodo = h('div', { clase: 'anuncio', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(anuncioNodo);
  }

  anuncioNodo.textContent = String(texto ?? '');
  anuncioNodo.classList.add('visible');

  if (anuncioReloj) clearTimeout(anuncioReloj);
  anuncioReloj = setTimeout(() => {
    if (anuncioNodo) anuncioNodo.classList.remove('visible');
    anuncioReloj = null;
  }, DURACION_ANUNCIO_MS);
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Deja un nodo sin hijos. Devuelve el mismo nodo, para encadenar. */
export function vaciar(nodo) {
  if (!nodo) return nodo;
  while (nodo.firstChild) nodo.removeChild(nodo.firstChild);
  return nodo;
}

function primeraMayuscula(texto) {
  const t = String(texto || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}
