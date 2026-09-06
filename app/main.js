// El arranque del estudio y el reparto de las nueve pantallas.
//
// Este módulo es lo único que index.html carga. Hace cuatro cosas, en este orden
// y contándolas en pantalla mientras las hace (docs/contrato.md §12, app/main.js):
//
//   1. Traer del bucket el estado de la producción — `cargar()`.
//   2. Consultar las operaciones de Veo que quedaron a medias —
//      `recuperarOperaciones()`— ANTES de lanzar nada nuevo.
//   3. Arrancar la cola — `arrancar()`.
//   4. Pintar las nueve pestañas y montar la pantalla que diga `location.hash`.
//
// POR QUÉ EL ORDEN NO SE PUEDE CAMBIAR. El paso 2 va antes que el 3 porque una
// operación de Veo lanzada y olvidada es un euro tirado y una toma que se queda
// «generando» para siempre (docs/contrato.md §8). Si la cola arrancara primero,
// empezaría a lanzar clips nuevos encima de otros que ya estaban corriendo sin
// saberlo. Y los dos van después del 1 porque la cola vive dentro del estado: sin
// el estado no hay cola que reanudar.
//
// POR QUÉ EL ARRANQUE SE CUENTA EN PANTALLA. Traer el estado, consultar cuatro
// operaciones de vídeo y arrancar la cola son varios segundos de nada en un
// teléfono con mala cobertura. Una pantalla en blanco durante esos segundos se lee
// como «se ha roto», y lo siguiente es recargar a mitad de una escritura. Así que
// se enseña la bitácora: qué se está haciendo, qué ya está hecho y qué ha fallado,
// con palabras.
//
// POR QUÉ LAS PANTALLAS SE PIDEN CON `import()` Y NO ARRIBA. Son nueve archivos
// separados. Con un `import` estático, un solo fallo en cualquiera de ellos —una
// coma de más, un archivo que no llegó a desplegarse— deja el navegador en blanco
// y sin manera de contarlo: ni siquiera llega a instalarse el recogedor de fallos
// de este módulo. Pidiéndolas de una en una, la que se rompa se queda con su
// pestaña puesta y su explicación dentro, y las otras ocho funcionan.
//
// POR QUÉ SE DESMONTA LA PANTALLA ANTERIOR. Cada pantalla se suscribe a
// `alCambiar()` para repintarse cuando cambia el estado. Si al cambiar de pestaña
// no se desapunta, a las diez idas y venidas hay diez pantallas repintándose a la
// vez sobre nodos que ya no están en el documento, y el móvil se arrastra.
//
// Este módulo no sabe nada de la serie: no conoce un id de modelo, ni una placa,
// ni un plano. Solo el armazón.

import { ErrorDeCara, EVENTO_CLAVE_NECESARIA, guardarClave, olvidarClave } from './api.js';
import { actual, alCambiar, cargar } from './estado.js';
import { aviso, boton, espera, EVENTO_FALLO_SUELTO, h, pantalla, seccion, vaciar } from './ui.js';

// ---------------------------------------------------------------------------
// Las nueve pantallas
// ---------------------------------------------------------------------------

/**
 * Las nueve, en el orden en el que salen en la barra de abajo — docs/contrato.md §9.
 *
 * El `titulo` y el `icono` de aquí son solo el respaldo: mandan los que traiga
 * cada módulo en su `export default`. Están escritos igualmente porque una
 * pantalla que no llegue a cargar necesita su pestaña puesta de todas formas,
 * para poder entrar en ella y leer por qué no ha cargado.
 */
const PESTANAS = [
  { id: 'salud',    titulo: 'Salud',    icono: '\u{1FA7A}', archivo: './pantallas/salud.js' },
  { id: 'voces',    titulo: 'Voces',    icono: '\u{1F399}', archivo: './pantallas/voces.js' },
  { id: 'banco',    titulo: 'Banco',    icono: '\u{1F5C2}', archivo: './pantallas/banco.js' },
  { id: 'desglose', titulo: 'Desglose', icono: '\u{1F4D0}', archivo: './pantallas/desglose.js' },
  { id: 'tomas',    titulo: 'Tomas',    icono: '\u{1F3AC}', archivo: './pantallas/tomas.js' },
  { id: 'audio',    titulo: 'Audio',    icono: '\u{1F3A7}', archivo: './pantallas/audio.js' },
  { id: 'cola',     titulo: 'Cola',     icono: '\u{23F3}',  archivo: './pantallas/cola.js' },
  { id: 'montaje',  titulo: 'Montaje',  icono: '\u{1F39E}', archivo: './pantallas/montaje.js' },
  { id: 'difusion', titulo: 'Difusión', icono: '\u{1F4E3}', archivo: './pantallas/difusion.js' },
];

/** Los pasos del arranque, tal como se leen en pantalla. */
const PASOS = [
  ['estado',      'Trayendo del bucket el estado de la producción'],
  ['operaciones', 'Consultando los vídeos que se quedaron generándose'],
  ['cola',        'Arrancando la cola de trabajos'],
  ['pantallas',   'Pintando las nueve pestañas'],
];

/** Cada cuánto se repasa el punto de la pestaña de Cola, en milisegundos. */
const LATIDO_COLA_MS = 1500;

/** Cuántos fallos sueltos se enseñan a la vez antes de tirar los viejos. */
const MAXIMO_FALLOS_SUELTOS = 4;

// ---------------------------------------------------------------------------
// Lo que se recuerda mientras la aplicación está abierta
// ---------------------------------------------------------------------------

/** El <div id="pantalla"> de index.html: dentro se pinta todo. */
let raiz = null;

/** El <nav id="pestanas"> de index.html: la barra de abajo. */
let barra = null;

/** Lo que ha pasado con cada pantalla: `id → { modulo, fallo, titulo, icono, alias }`. */
const cargadas = new Map();

/** El módulo `app/cola.js`, una vez pedido. Null mientras no haya llegado. */
let Cola = null;

/** Por qué no cargó `app/cola.js`, si es que no cargó. */
let porQueNoHayCola = null;

/** Qué pantalla está montada ahora mismo. */
let puesta = null;

/** Cómo se desmonta la que está puesta, si ella misma dijo cómo. */
let desmontarLaPuesta = null;

/** El nodo suelto donde pinta la pantalla puesta, para poder tirarlo entero. */
let huecoDeLaPuesta = null;

/** Un número que sube en cada montaje: si vuelve uno viejo, se descarta. */
let turnoDeMontaje = 0;

/** El aro que enseña el punto de la pestaña de Cola. */
let relojDeCola = null;

/** La petición de clave que está abierta, para no abrir dos encima. */
let pidiendoLaClave = null;

/** Dónde se apilan los fallos que nadie recogió. */
let bandejaDeFallos = null;

/**
 * Los fallos sueltos que hay puestos ahora mismo, por su firma, con su tarjeta y
 * cuántas veces ha pasado.
 *
 * NO es «el último», que es lo que había antes y no bastaba: eso solo evitaba
 * repetir dos seguidos, así que un fallo que se dispara con cada latido de la
 * cola —cada diez segundos— volvía a pintarse una y otra vez. Y «Entendido»
 * borraba la memoria, con lo que el siguiente latido lo traía de vuelta. Se
 * cerraba y volvía, se cerraba y volvía.
 *
 * @type {Map<string, {tarjeta: HTMLElement, veces: number, contador: HTMLElement}>}
 */
const fallosPuestos = new Map();

/**
 * Los que ya se han cerrado con «Entendido». Cerrar uno es decir «ya lo he
 * visto»: si vuelve a pasar lo mismo, no se vuelve a pintar en toda la sesión.
 * Al recargar la aplicación se empieza de cero, que es lo que se quiere.
 * @type {Set<string>}
 */
const fallosDescartados = new Set();

// ---------------------------------------------------------------------------
// El arranque
// ---------------------------------------------------------------------------

arrancarElEstudio();

/**
 * Los cuatro pasos, en orden, contándolos en pantalla.
 * @returns {Promise<void>}
 */
async function arrancarElEstudio() {
  raiz = document.getElementById('pantalla');
  barra = document.getElementById('pestanas');

  if (!raiz || !barra) {
    // No hay ni dónde pintar. Es lo único que se cuenta sin `aviso()`, porque
    // `aviso()` necesita justamente lo que falta.
    contarSinSitio();
    return;
  }

  recogerLosFallosSueltos();
  escucharLaPeticionDeClave();

  // Las nueve pantallas se piden ya, en paralelo con el bucket: son nueve archivos
  // pequeños que no dependen de nada y así no se suman las esperas.
  const pantallasPedidas = pedirLasPantallas();

  const bitacora = pintarLaBitacora();

  // 1. El estado. Sin él no hay nada: ni cola, ni aprobados, ni gasto.
  const hayEstado = await pasoDelEstado(bitacora);

  // 2. Las operaciones de Veo a medias, antes de lanzar nada nuevo.
  if (hayEstado) await pasoDeLasOperaciones(bitacora);
  else bitacora.saltar('operaciones', 'No se ha traído el estado, así que no se sabe qué vídeos había en marcha.');

  // 3. La cola.
  if (hayEstado) await pasoDeLaCola(bitacora);
  else bitacora.saltar('cola', 'La cola vive dentro del estado: sin estado no hay nada que reanudar.');

  // 4. Las pestañas y la pantalla.
  bitacora.haciendo('pantallas');
  await pantallasPedidas;
  bitacora.hecho('pantallas');

  pintarLasPestanas();
  vigilarLaCola();

  window.addEventListener('hashchange', alCambiarElHash);
  document.addEventListener('visibilitychange', alVolverAlFrente);

  const inicial = idDelHash() || (hayEstado ? laDeSiempre() : 'salud');
  ponerElHash(inicial);
  await montarPantalla(inicial);
}

// ---------------------------------------------------------------------------
// Paso 1: el estado
// ---------------------------------------------------------------------------

/**
 * Trae el estado del bucket, insistiendo hasta que entre o hasta que el usuario
 * decida seguir sin él para poder mirar la pantalla de Salud, que es la que
 * cuenta qué le pasa a la cuenta.
 *
 * @param {ReturnType<typeof pintarLaBitacora>} bitacora
 * @returns {Promise<boolean>} si el estado está cargado
 */
async function pasoDelEstado(bitacora) {
  for (;;) {
    bitacora.haciendo('estado');
    try {
      await cargar();
      bitacora.hecho('estado');
      return true;
    } catch (fallo) {
      const error = comoErrorDeCara(fallo, 'traer el estado de la producción');
      bitacora.fallo('estado', error.mensaje);

      // Un 401 es el pestillo de la puerta, no un fallo del bucket: se pide la
      // clave y se vuelve a intentar sin más ceremonia.
      if (error.http === 401 && (await pedirLaClave(error.mensaje))) continue;

      const decidido = await pedirDecision(bitacora.zona, error, {
        reintentar: error.http === 401 ? 'Escribir la clave de acceso' : 'Volver a intentarlo',
        seguir: 'Abrir Salud de todas formas',
        nota:
          'Salud no necesita el estado: habla con la cuenta y con el bucket por su cuenta, y es la ' +
          'pantalla que dice si falta una variable de entorno, si el bucket no se deja escribir o si ' +
          'la clave privada no vale. Lo demás sí lo necesita, así que quedará a medias hasta que el ' +
          'estado entre.',
      });

      if (decidido === 'seguir') {
        bitacora.saltar('estado', 'Se sigue sin el estado para poder mirar Salud.');
        return false;
      }
      if (error.http === 401) await pedirLaClave(error.mensaje);
    }
  }
}

// ---------------------------------------------------------------------------
// Paso 2: las operaciones de Veo que quedaron a medias
// ---------------------------------------------------------------------------

/**
 * Consulta todas las `operacion_en_curso` guardadas. Va antes de arrancar la
 * cola a propósito: una operación lanzada y no consultada es dinero gastado que
 * no llega a ninguna parte.
 *
 * @param {ReturnType<typeof pintarLaBitacora>} bitacora
 * @returns {Promise<void>}
 */
async function pasoDeLasOperaciones(bitacora) {
  for (;;) {
    bitacora.haciendo('operaciones');
    try {
      const cola = await pedirLaCola();
      await cola.recuperarOperaciones();
      bitacora.hecho('operaciones');
      return;
    } catch (fallo) {
      const error = comoErrorDeCara(fallo, 'consultar los vídeos que se quedaron generándose');
      bitacora.fallo('operaciones', error.mensaje);

      if (error.http === 401 && (await pedirLaClave(error.mensaje))) continue;

      const decidido = await pedirDecision(bitacora.zona, error, {
        reintentar: error.http === 401 ? 'Escribir la clave de acceso' : 'Volver a intentarlo',
        seguir: 'Seguir sin consultarlos',
        nota:
          'Si se sigue sin consultarlos, las tomas que tuvieran un vídeo en marcha se quedarán ' +
          'marcadas como «generando» hasta que se abra la aplicación otra vez. No se pierde el ' +
          'vídeo —Veo lo deja en el bucket igualmente—, pero la cola no lo va a recoger sola.',
      });

      if (decidido === 'seguir') {
        bitacora.saltar('operaciones', 'Se ha seguido sin consultarlos.');
        return;
      }
      if (error.http === 401) await pedirLaClave(error.mensaje);
    }
  }
}

// ---------------------------------------------------------------------------
// Paso 3: la cola
// ---------------------------------------------------------------------------

/**
 * Arranca la cola. Es idempotente, así que volver a llamarla no hace daño.
 * @param {ReturnType<typeof pintarLaBitacora>} bitacora
 * @returns {Promise<void>}
 */
async function pasoDeLaCola(bitacora) {
  // Si el archivo de la cola no llegó a cargar en el paso anterior, no va a
  // aparecer entre un paso y el siguiente. Se dice y se sigue: hacer contestar
  // dos veces al mismo fallo es una pregunta de más.
  if (porQueNoHayCola) {
    bitacora.saltar('cola', 'No hay cola que arrancar: es el mismo fallo de aquí arriba.');
    return;
  }

  for (;;) {
    bitacora.haciendo('cola');
    try {
      const cola = await pedirLaCola();

      // EL RITMO GUARDADO, ANTES DE ARRANCAR. El freno de app/api.js aprende
      // chocando contra la cuota, y lo aprendido se perdía al recargar: cada
      // sesión volvía a estrellarse una vez, y esa una vez es justo la primera
      // generación que se mira. Aquí se le devuelve lo que ya sabía, o lo que el
      // usuario haya dicho que aguanta su cuenta.
      cola.aplicarElRitmoGuardado();

      await cola.arrancar();
      bitacora.hecho('cola');
      return;
    } catch (fallo) {
      const error = comoErrorDeCara(fallo, 'arrancar la cola de trabajos');
      bitacora.fallo('cola', error.mensaje);

      if (error.http === 401 && (await pedirLaClave(error.mensaje))) continue;

      const decidido = await pedirDecision(bitacora.zona, error, {
        reintentar: error.http === 401 ? 'Escribir la clave de acceso' : 'Volver a intentarlo',
        seguir: 'Entrar sin arrancar la cola',
        nota:
          'Sin la cola en marcha nada se genera solo, pero se puede mirar todo lo que ya está hecho ' +
          'y volver a arrancarla desde la pantalla de Cola.',
      });

      if (decidido === 'seguir') {
        bitacora.saltar('cola', 'Se ha entrado sin arrancarla. Se arranca a mano desde la pantalla de Cola.');
        return;
      }
      if (error.http === 401) await pedirLaClave(error.mensaje);
    }
  }
}

/**
 * `app/cola.js`, pedido una sola vez. Se pide con `import()` por lo mismo que
 * las pantallas: si el archivo no está o está roto, se cuenta con palabras en
 * vez de dejar la aplicación en blanco.
 * @returns {Promise<object>}
 */
async function pedirLaCola() {
  if (Cola) return Cola;
  try {
    Cola = await import('./cola.js');
    porQueNoHayCola = null;
  } catch (fallo) {
    porQueNoHayCola = new ErrorDeCara(
      'No se ha podido cargar la cola de trabajos: falta el archivo o tiene algo que el navegador no ' +
        'entiende. Sin ella no se genera nada, aunque el resto de la aplicación sí se puede mirar. ' +
        'Suele ser un despliegue a medias: vuelve a desplegar y recarga la página.',
      { detalle: loQueDijo(fallo), reintentable: true, http: 0 }
    );
    throw porQueNoHayCola;
  }
  return Cola;
}

// ---------------------------------------------------------------------------
// Paso 4: las pantallas
// ---------------------------------------------------------------------------

/**
 * Pide las ocho a la vez. Ninguna puede tumbar a las demás: cada una se guarda
 * con su módulo o con su fallo, y la barra de pestañas sale igual.
 * @returns {Promise<void>}
 */
async function pedirLasPantallas() {
  await Promise.all(PESTANAS.map((ficha) => pedirUnaPantalla(ficha)));
}

/**
 * Pide una pantalla y guarda lo que salga.
 * @param {{id:string, titulo:string, icono:string, archivo:string}} ficha
 * @returns {Promise<void>}
 */
async function pedirUnaPantalla(ficha) {
  try {
    const modulo = await import(ficha.archivo);
    const dentro = modulo && modulo.default ? modulo.default : null;

    if (!dentro || typeof dentro.montar !== 'function') {
      throw new ErrorDeCara(
        `La pantalla de ${ficha.titulo} se ha cargado, pero no trae dentro la función que la pinta. ` +
          'Es un fallo del propio estudio, no de tu cuenta: ese archivo tiene que exportar por ' +
          'defecto un objeto con «montar» dentro.',
        { reintentable: false, http: 500 }
      );
    }

    cargadas.set(ficha.id, {
      modulo: dentro,
      fallo: null,
      titulo: textoO(dentro.titulo, ficha.titulo),
      icono: textoO(dentro.icono, ficha.icono),
      alias: alias(ficha.id, dentro.id),
    });
  } catch (fallo) {
    // Lo que ya viene con su frase escrita —el módulo que carga pero no trae
    // «montar» dentro— se deja tal cual. Lo demás es que el archivo no ha
    // llegado o no se entiende, y eso tiene su propia explicación.
    const error = fallo instanceof ErrorDeCara
      ? fallo
      : new ErrorDeCara(
          `No se ha podido cargar la pantalla de ${ficha.titulo}: o ese archivo no ha llegado al ` +
            'despliegue, o tiene dentro algo que el navegador no entiende. Suele ser un despliegue a ' +
            'medias: vuelve a desplegar y recarga la página. Debajo está lo que dijo el navegador, ' +
            'palabra por palabra.',
          { detalle: loQueDijo(fallo), reintentable: true, http: 0 }
        );

    cargadas.set(ficha.id, {
      modulo: null,
      fallo: error,
      titulo: ficha.titulo,
      icono: ficha.icono,
      alias: alias(ficha.id, null),
    });
  }
}

/**
 * Los nombres por los que se puede llegar a una pantalla desde el hash. El del
 * archivo siempre vale; si el módulo se llama a sí mismo de otra manera, ese
 * nombre también, para que un enlace escrito en otra pantalla no caiga en vacío.
 * @param {string} deArchivo
 * @param {*} delModulo
 * @returns {Set<string>}
 */
function alias(deArchivo, delModulo) {
  const nombres = new Set([deArchivo]);
  const suyo = textoO(delModulo, '').toLowerCase();
  if (suyo) nombres.add(suyo);
  return nombres;
}

// ---------------------------------------------------------------------------
// La bitácora del arranque
// ---------------------------------------------------------------------------

/**
 * Pinta la lista de pasos y devuelve con qué marcarlos.
 * @returns {{ zona:HTMLElement, haciendo:Function, hecho:Function, fallo:Function, saltar:Function }}
 */
function pintarLaBitacora() {
  const filas = new Map();

  const lista = h('ul', {
    clase: 'arranque',
    estilo: { 'list-style': 'none', margin: '0', padding: '0', display: 'flex', 'flex-direction': 'column', gap: '12px' },
  });

  for (const [clave, texto] of PASOS) {
    const marca = h('span', { clase: ['estado', 'estado-pendiente'] },
      h('span', { clase: 'estado-punto', 'aria-hidden': 'true' }),
      h('span', { clase: 'estado-texto' }, 'Esperando')
    );
    const frase = h('span', { clase: 'suave' }, texto);
    const fila = h('li', {
      estilo: { display: 'flex', 'align-items': 'baseline', gap: '12px', 'flex-wrap': 'wrap' },
    }, marca, frase);

    filas.set(clave, { fila, marca, frase });
    lista.appendChild(fila);
  }

  // Donde caen los errores del arranque y los botones para decidir qué hacer.
  const zona = h('div', { estilo: { display: 'flex', 'flex-direction': 'column', gap: '12px' } });

  const cuerpo = pantalla(
    'Arrancando el estudio',
    seccion(null, lista, zona)
  );

  vaciar(raiz).appendChild(cuerpo);

  /**
   * Cambia el punto y la palabra de un paso.
   * @param {string} clave
   * @param {string} familia
   * @param {string} palabra
   * @param {string} [nota]
   */
  const marcar = (clave, familia, palabra, nota) => {
    const fila = filas.get(clave);
    if (!fila) return;
    fila.marca.className = `estado estado-${familia}`;
    const texto = fila.marca.querySelector('.estado-texto');
    if (texto) texto.textContent = palabra;
    fila.marca.title = palabra;
    fila.frase.className = familia === 'pendiente' ? 'suave' : '';
    let apunte = fila.fila.querySelector('.arranque-nota');
    if (nota) {
      if (!apunte) {
        apunte = h('span', { clase: ['arranque-nota', 'tenue'], estilo: { flex: '1 1 100%', 'font-size': '14px' } });
        fila.fila.appendChild(apunte);
      }
      apunte.textContent = nota;
    } else if (apunte) {
      apunte.remove();
    }
  };

  return {
    zona,
    haciendo: (clave) => marcar(clave, 'en-curso', 'Ahora'),
    hecho: (clave) => marcar(clave, 'listo', 'Hecho'),
    fallo: (clave, porque) => marcar(clave, 'fallido', 'Ha fallado', porque),
    saltar: (clave, porque) => marcar(clave, 'detenido', 'Sin hacer', porque),
  };
}

/**
 * Enseña un error del arranque y espera a que el usuario diga qué hacer.
 *
 * @param {HTMLElement} zona dónde pintarlo
 * @param {ErrorDeCara} error
 * @param {{reintentar:string, seguir?:string|null, nota?:string}} opciones
 * @returns {Promise<'reintentar'|'seguir'>}
 */
function pedirDecision(zona, error, { reintentar, seguir = null, nota = '' } = {}) {
  return new Promise((decidir) => {
    vaciar(zona);

    zona.appendChild(aviso(error.mensaje, { tono: 'error', detalle: error.detalle }));
    if (nota) zona.appendChild(aviso(nota, { tono: 'nota' }));

    const acciones = h('div', { clase: 'tarjeta-acciones' },
      boton(reintentar, () => {
        vaciar(zona);
        decidir('reintentar');
      }, { tono: 'principal' }),
      seguir
        ? boton(seguir, () => {
            vaciar(zona);
            decidir('seguir');
          }, { tono: 'suave' })
        : null
    );

    zona.appendChild(acciones);
  });
}

// ---------------------------------------------------------------------------
// Las pestañas
// ---------------------------------------------------------------------------

/**
 * Pinta la barra de abajo entera. Se llama una vez; después solo se cambia la
 * pestaña marcada y el punto de Cola.
 * @returns {void}
 */
function pintarLasPestanas() {
  vaciar(barra);

  for (const ficha of PESTANAS) {
    const datos = cargadas.get(ficha.id) || { titulo: ficha.titulo, icono: ficha.icono, fallo: null };

    const enlace = h('a', {
      clase: 'pestana',
      href: `#${ficha.id}`,
      'data-pantalla': ficha.id,
      'aria-label': datos.titulo,
    },
      h('span', { clase: 'pestana-icono', 'aria-hidden': 'true' }, datos.icono),
      h('span', { clase: 'pestana-texto' }, datos.titulo)
    );

    barra.appendChild(enlace);

    // Una pantalla que no ha cargado sigue teniendo su pestaña: es la única
    // manera de entrar y leer por qué no ha cargado. Y lleva su aspa puesta,
    // para que se vea desde fuera que ahí dentro hay algo que contar.
    if (datos.fallo) {
      ponerPunto(ficha.id, puntoDePestana('!', 'fallo'), `${datos.titulo}: esta pantalla no ha cargado`);
    }
  }

  marcarLaPestanaPuesta();
  actualizarElPuntoDeCola();
}

/**
 * Pone, cambia o quita el punto de una pestaña, y con él lo que se lee en voz
 * alta: un punto de color a solas no dice nada.
 * @param {string} id
 * @param {HTMLElement|null} punto
 * @param {string} comoSeLee
 */
function ponerPunto(id, punto, comoSeLee) {
  if (!barra) return;
  const enlace = barra.querySelector(`.pestana[data-pantalla="${id}"]`);
  if (!enlace) return;

  const anterior = enlace.querySelector('.pestana-punto');
  if (!punto) {
    if (anterior) anterior.remove();
  } else if (anterior) {
    anterior.replaceWith(punto);
  } else {
    enlace.appendChild(punto);
  }

  enlace.setAttribute('aria-label', comoSeLee);
}

/**
 * El punto de una pestaña: un número pequeño arriba, encima del icono.
 *
 * Va con estilos escritos aquí y no con una clase de la hoja porque la hoja no
 * conoce este punto (app/estilo.css solo fija la barra, la pestaña, el icono y
 * el texto). Los colores salen igualmente de las variables de la hoja, con su
 * respaldo escrito por si algún día se sirve sin ella.
 *
 * FALTA EN EL CONTRATO: docs/contrato.md §9 pide que la barra avise de lo que
 * hay en la cola, pero no dice con qué nombre de clase. Se usa `pestana-punto`,
 * que es el nombre obvio al lado de `pestana-icono` y `pestana-texto`.
 *
 * @param {string} texto lo que se lee dentro
 * @param {'trabajo'|'fallo'} tono
 * @returns {HTMLElement}
 */
function puntoDePestana(texto, tono) {
  const fondo = tono === 'fallo' ? 'var(--fallido, #c8635a)' : 'var(--en-curso, #d3a04a)';

  return h('span', {
    clase: 'pestana-punto',
    'aria-hidden': 'true',
    estilo: {
      position: 'absolute',
      top: '4px',
      left: '50%',
      'margin-left': '6px',
      'min-width': '17px',
      height: '17px',
      padding: '0 4px',
      'border-radius': '999px',
      background: fondo,
      color: 'var(--fondo, #0b0d10)',
      'font-size': '10px',
      'font-weight': '700',
      'line-height': '17px',
      'text-align': 'center',
      'font-variant-numeric': 'tabular-nums',
      'pointer-events': 'none',
    },
  }, String(texto));
}

/** Marca cuál es la pestaña puesta, por clase y por `aria-current`. */
function marcarLaPestanaPuesta() {
  if (!barra) return;
  for (const enlace of barra.querySelectorAll('.pestana')) {
    const suyo = enlace.getAttribute('data-pantalla');
    const esta = suyo === puesta;
    enlace.classList.toggle('activa', esta);
    if (esta) enlace.setAttribute('aria-current', 'page');
    else enlace.removeAttribute('aria-current');
  }
}

// ---------------------------------------------------------------------------
// El punto de la pestaña de Cola
// ---------------------------------------------------------------------------

/**
 * Repasa el punto de Cola cuando cambia el estado y, además, cada segundo y
 * medio: lo que está en curso vive en la cola, y la cola no siempre escribe en
 * el estado por cada paso que da.
 */
function vigilarLaCola() {
  try {
    alCambiar(actualizarElPuntoDeCola);
  } catch (fallo) {
    // Si el estado no se pudo cargar, no hay a qué suscribirse. El aro de abajo
    // sigue repasando el punto igual.
    console.error('No se ha podido escuchar los cambios del estado desde la barra de pestañas', fallo);
  }

  if (relojDeCola) clearInterval(relojDeCola);
  relojDeCola = setInterval(actualizarElPuntoDeCola, LATIDO_COLA_MS);
}

/**
 * Pone o quita el punto de la pestaña de Cola: sale cuando hay trabajos en curso
 * o fallidos, con su número.
 */
function actualizarElPuntoDeCola() {
  if (!barra) return;

  const cuenta = laColaComoVa();
  const cuantos = cuenta.enCurso + cuenta.fallidas;

  if (cuantos <= 0) {
    // Sin nada que avisar, la pestaña vuelve a estar limpia — salvo que la
    // propia pantalla de Cola no haya cargado, que eso sigue siendo urgente.
    const suya = cargadas.get('cola');
    if (suya && suya.fallo) {
      ponerPunto('cola', puntoDePestana('!', 'fallo'), 'Cola: esta pantalla no ha cargado');
    } else {
      ponerPunto('cola', null, 'Cola');
    }
    return;
  }

  // El número se ve, pero también tiene que poder oírse: en la pestaña no cabe
  // la palabra y un punto de color a solas no dice nada.
  const partes = [];
  if (cuenta.enCurso > 0) partes.push(`${cuenta.enCurso} en curso`);
  if (cuenta.fallidas > 0) partes.push(`${cuenta.fallidas} ${cuenta.fallidas === 1 ? 'fallido' : 'fallidos'}`);

  ponerPunto(
    'cola',
    puntoDePestana(cuantos > 99 ? '99+' : String(cuantos), cuenta.fallidas > 0 ? 'fallo' : 'trabajo'),
    `Cola: ${partes.join(' y ')}`
  );
}

/**
 * Cómo va la cola. Lo dice `app/cola.js` si está cargada; si no, se cuenta a
 * mano sobre `estado.cola`, que es donde vive de verdad (docs/contrato.md §8).
 * @returns {{pendientes:number, enCurso:number, hechas:number, fallidas:number, detenidas:number}}
 */
function laColaComoVa() {
  const vacio = { pendientes: 0, enCurso: 0, hechas: 0, fallidas: 0, detenidas: 0 };

  if (Cola && typeof Cola.resumen === 'function') {
    try {
      const dicho = Cola.resumen();
      if (dicho && typeof dicho === 'object') {
        return {
          pendientes: Number(dicho.pendientes) || 0,
          enCurso: Number(dicho.enCurso) || 0,
          hechas: Number(dicho.hechas) || 0,
          fallidas: Number(dicho.fallidas) || 0,
          detenidas: Number(dicho.detenidas) || 0,
        };
      }
    } catch {
      // La cola se ha quejado; se cuenta a mano justo debajo.
    }
  }

  try {
    const trabajos = actual().cola;
    if (!Array.isArray(trabajos)) return vacio;
    const cuenta = { ...vacio };
    for (const trabajo of trabajos) {
      const estado = String((trabajo && trabajo.estado) || '').trim();
      if (estado === 'pendiente') cuenta.pendientes += 1;
      else if (estado === 'en_curso' || estado === 'en-curso') cuenta.enCurso += 1;
      else if (estado === 'hecho') cuenta.hechas += 1;
      else if (estado === 'fallido') cuenta.fallidas += 1;
      else if (estado === 'detenido') cuenta.detenidas += 1;
    }
    return cuenta;
  } catch {
    return vacio;
  }
}

// ---------------------------------------------------------------------------
// El encaminador: location.hash y nada más
// ---------------------------------------------------------------------------

/**
 * Qué pantalla pide la dirección. Devuelve null si no pide ninguna conocida.
 * @returns {string|null}
 */
function idDelHash() {
  const crudo = String(window.location.hash || '')
    .replace(/^#\/?/, '')
    .split(/[?&/]/)[0]
    .trim()
    .toLowerCase();

  if (!crudo) return null;

  for (const ficha of PESTANAS) {
    if (ficha.id === crudo) return ficha.id;
    const datos = cargadas.get(ficha.id);
    if (datos && datos.alias && datos.alias.has(crudo)) return ficha.id;
  }
  return null;
}

/**
 * Escribe el hash sin dejar una entrada más en el historial y sin disparar otro
 * montaje: el que llama monta él mismo.
 * @param {string} id
 */
function ponerElHash(id) {
  const quiere = `#${id}`;
  if (window.location.hash === quiere) return;
  try {
    window.history.replaceState(null, '', quiere);
  } catch {
    // Un navegador que no deja tocar el historial se conforma con el hash, que
    // dispara `hashchange` y monta por ese camino. No se pierde nada.
    window.location.hash = quiere;
  }
}

/** Cuando cambia la dirección: se monta lo que pida, o lo de siempre. */
function alCambiarElHash() {
  const id = idDelHash();
  if (!id) {
    const destino = laDeSiempre();
    ponerElHash(destino);
    montarPantalla(destino);
    return;
  }
  montarPantalla(id);
}

/**
 * La pantalla con la que se abre cuando nadie ha pedido ninguna: Salud si no hay
 * nada hecho todavía —que es cuando hay que comprobar la cuenta— y Tomas si ya
 * hay trabajo, que es donde se pasan las horas.
 * @returns {string}
 */
function laDeSiempre() {
  return hayTrabajoHecho() ? 'tomas' : 'salud';
}

/**
 * Si en el estado hay algo aprobado, elegido o grabado. Basta con una cosa: en
 * cuanto hay una placa aprobada, la pantalla útil ya no es Salud.
 * @returns {boolean}
 */
function hayTrabajoHecho() {
  let estado;
  try {
    estado = actual();
  } catch {
    return false;
  }
  if (!estado || typeof estado !== 'object') return false;

  if (algunoCon(estado.banco, (v) => v && v.aprobada)) return true;
  if (algunoCon(estado.escenarios, (v) => v && v.aprobada)) return true;
  if (algunoCon(estado.tomas, (v) => v && (v.keyframe_aprobado || v.clip_elegido || v.operacion_en_curso))) return true;
  if (estado.audio && typeof estado.audio === 'object') {
    if (algunoCon(estado.audio.musica, (v) => v && v.ruta)) return true;
    if (algunoCon(estado.audio.voz, (v) => v && v.ruta)) return true;
  }
  if (algunoCon(estado.voces, (v) => v && v.voz_id)) return true;
  if (Array.isArray(estado.montajes) && estado.montajes.length > 0) return true;
  if (Array.isArray(estado.cola) && estado.cola.length > 0) return true;

  return false;
}

/**
 * Si algún valor de un objeto cumple lo que se le pide.
 * @param {*} mapa
 * @param {(valor:*) => *} cumple
 * @returns {boolean}
 */
function algunoCon(mapa, cumple) {
  if (!mapa || typeof mapa !== 'object') return false;
  for (const clave of Object.keys(mapa)) {
    if (cumple(mapa[clave])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Montar y desmontar pantallas
// ---------------------------------------------------------------------------

/**
 * Quita la pantalla puesta y monta otra.
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
async function montarPantalla(id) {
  const ficha = PESTANAS.find((p) => p.id === id);
  if (!ficha) return;

  const turno = ++turnoDeMontaje;

  desmontarLaDeAhora();
  puesta = id;
  marcarLaPestanaPuesta();
  document.title = `${ficha.titulo} · LA MIRADA QUE EL MUNDO TEMERÁ`;

  const datos = cargadas.get(id);

  vaciar(raiz);
  window.scrollTo(0, 0);

  if (!datos || !datos.modulo) {
    pintarPantallaQueNoCargo(ficha, datos ? datos.fallo : null);
    return;
  }

  const cartel = espera(`Abriendo ${datos.titulo}…`);
  const hueco = h('div', { clase: 'pantalla-hueco' });
  raiz.appendChild(cartel);
  raiz.appendChild(hueco);
  huecoDeLaPuesta = hueco;

  let devuelto = null;
  try {
    devuelto = await datos.modulo.montar(hueco);
  } catch (fallo) {
    if (turno !== turnoDeMontaje) return;   // llegó tarde: ya hay otra puesta
    cartel.remove();
    vaciar(hueco);
    const error = comoErrorDeCara(fallo, `pintar la pantalla de ${datos.titulo}`);
    hueco.appendChild(aviso(error.mensaje, { tono: 'error', detalle: error.detalle }));
    hueco.appendChild(h('div', { clase: 'tarjeta-acciones' },
      boton('Volver a pintarla', () => montarPantalla(id), { tono: 'principal' })
    ));
    return;
  }

  if (turno !== turnoDeMontaje) {
    // Mientras esta se pintaba, el usuario tocó otra pestaña. Se desmonta lo que
    // acaba de nacer y no se toca nada más: la que manda es la otra.
    ejecutarDesmontaje(comoDesmontaje(devuelto), hueco);
    return;
  }

  cartel.remove();
  desmontarLaPuesta = comoDesmontaje(devuelto);
}

/**
 * Lo que una pantalla haya dicho para desmontarse, sea como sea que lo diga.
 *
 * FALTA EN EL CONTRATO: docs/contrato.md §12 dice que `montar(raiz)` pinta y se
 * suscribe a `alCambiar`, y el encargo dice que al cambiar de pestaña hay que
 * desuscribirse — pero el contrato no fija cómo viaja de vuelta esa
 * desuscripción. Se acepta lo obvio: que `montar()` devuelva la función de
 * desapuntarse, o un objeto con `desmontar` dentro. Y para la pantalla que no
 * devuelva nada, el desmontaje se hace igual por el otro lado: su nodo se saca
 * del documento y encima recibe un evento `desmontar` por si quisiera enterarse.
 *
 * @param {*} devuelto lo que dijo `montar()`
 * @returns {(() => void)|null}
 */
function comoDesmontaje(devuelto) {
  if (typeof devuelto === 'function') return devuelto;
  if (devuelto && typeof devuelto === 'object') {
    for (const nombre of ['desmontar', 'desapuntar', 'limpiar', 'parar']) {
      if (typeof devuelto[nombre] === 'function') return () => devuelto[nombre]();
    }
  }
  return null;
}

/** Desmonta la pantalla que esté puesta ahora mismo. */
function desmontarLaDeAhora() {
  ejecutarDesmontaje(desmontarLaPuesta, huecoDeLaPuesta);
  desmontarLaPuesta = null;
  huecoDeLaPuesta = null;
}

/**
 * El desmontaje de verdad: se avisa a la pantalla, se la deja desapuntarse y se
 * saca su nodo del documento.
 * @param {(() => void)|null} desmontar
 * @param {HTMLElement|null} hueco
 */
function ejecutarDesmontaje(desmontar, hueco) {
  if (hueco) {
    try {
      hueco.dispatchEvent(new CustomEvent('desmontar', { bubbles: false }));
    } catch {
      // Un navegador sin eventos personalizados no impide lo demás.
    }
  }

  if (typeof desmontar === 'function') {
    try {
      desmontar();
    } catch (fallo) {
      // Una pantalla que se rompe al irse no puede impedir que entre la
      // siguiente: se cuenta y se sigue.
      console.error('Una pantalla ha fallado al desmontarse', fallo);
    }
  }

  if (hueco) {
    vaciar(hueco);
    hueco.remove();
  }
}

/**
 * La pantalla de una pestaña que no llegó a cargar. Se cuenta con palabras y se
 * ofrece volver a pedirla: casi siempre es un despliegue a medias.
 * @param {{id:string, titulo:string}} ficha
 * @param {ErrorDeCara|null} error
 */
function pintarPantallaQueNoCargo(ficha, error) {
  const cuerpo = pantalla(
    ficha.titulo,
    seccion(
      null,
      aviso(
        error
          ? error.mensaje
          : `La pantalla de ${ficha.titulo} no se ha cargado y no se ha podido averiguar por qué.`,
        { tono: 'error', detalle: error ? error.detalle : null }
      ),
      aviso(
        'Las otras siete pantallas siguen funcionando: esta se pide por su cuenta justamente para que ' +
          'un archivo roto no deje la aplicación en blanco.',
        { tono: 'nota' }
      ),
      h('div', { clase: 'tarjeta-acciones' },
        boton('Volver a pedirla', async () => {
          await pedirUnaPantalla(ficha);
          pintarLasPestanas();
          await montarPantalla(ficha.id);
        }, { tono: 'principal' }),
        boton('Ir a Salud', () => {
          ponerElHash('salud');
          montarPantalla('salud');
        }, { tono: 'suave' })
      )
    )
  );

  vaciar(raiz).appendChild(cuerpo);
}

// ---------------------------------------------------------------------------
// La clave de acceso
// ---------------------------------------------------------------------------

/**
 * Se queda escuchando el aviso que lanza `app/api.js` cuando la función contesta
 * 401. Puede saltar en cualquier momento —a mitad de una tirada de la cola, no
 * solo al arrancar— así que se atiende desde aquí, que es lo único que siempre
 * está montado.
 */
function escucharLaPeticionDeClave() {
  window.addEventListener(EVENTO_CLAVE_NECESARIA, (evento) => {
    const dicho = evento && evento.detail ? evento.detail : {};
    pedirLaClave(textoO(dicho.mensaje, ''));
  });
}

/**
 * Pide la clave del pestillo y la guarda. Si ya hay una petición abierta, se
 * engancha a ella: tres generaciones a la vez darían tres 401 y no se pueden
 * abrir tres campos encima del mismo.
 *
 * @param {string} mensaje lo que dijo la función, para enseñarlo junto al campo
 * @returns {Promise<boolean>} si se ha guardado una clave
 */
function pedirLaClave(mensaje) {
  if (pidiendoLaClave) return pidiendoLaClave;

  pidiendoLaClave = new Promise((terminado) => {
    let resuelto = false;

    const campo = h('input', {
      type: 'password',
      name: 'clave-de-acceso',
      autocomplete: 'off',
      autocapitalize: 'off',
      autocorrect: 'off',
      enterkeyhint: 'done',
      'aria-label': 'Clave de acceso',
      placeholder: 'La clave de CLAVE_ACCESO',
      estilo: {
        width: '100%',
        'min-height': 'var(--toque, 48px)',
        padding: '0 12px',
        background: 'var(--fondo-hundido, #07080a)',
        border: '1px solid var(--borde-fuerte, #39424e)',
        'border-radius': 'var(--radio-chico, 8px)',
        color: 'var(--texto, #e9ecef)',
      },
      alTecla: (evento) => {
        if (evento.key === 'Enter') {
          evento.preventDefault();
          aceptar();
        }
      },
    });

    const queja = h('p', { clase: 'tenue', estilo: { 'font-size': '14px' } });

    const cerrar = (guardada) => {
      if (resuelto) return;
      resuelto = true;
      document.removeEventListener('keydown', alEscape, true);
      try {
        if (dialogo.open && typeof dialogo.close === 'function') dialogo.close();
      } catch {
        // Da igual por qué no cerró: se saca del documento de todas formas.
      }
      dialogo.remove();
      pidiendoLaClave = null;
      terminado(guardada);
    };

    const aceptar = () => {
      const escrita = String(campo.value || '').trim();
      if (!escrita) {
        queja.textContent = 'Hace falta escribir algo: la clave es la que está puesta en la variable CLAVE_ACCESO de Vercel.';
        campo.focus();
        return;
      }
      if (!guardarClave(escrita)) {
        queja.textContent =
          'Este navegador no deja guardar nada, así que la clave no se puede recordar. Suele pasar en ' +
          'navegación privada: sal de ella y vuelve a entrar.';
        return;
      }
      cerrar(true);
    };

    const renunciar = () => {
      // Sin clave guardada. Se le dice a api.js que ya no se está pidiendo, o el
      // siguiente 401 se quedaría callado.
      olvidarClave();
      cerrar(false);
    };

    const alEscape = (evento) => {
      if (evento.key === 'Escape') renunciar();
    };

    const dialogo = h('dialog', {
      clase: 'confirmar',
      'aria-label': 'Clave de acceso',
      alCancelar: (evento) => {
        evento.preventDefault();
        renunciar();
      },
      alClic: (evento) => {
        if (evento.target === dialogo) renunciar();
      },
    },
      h('div', { clase: 'confirmar-caja' },
        h('p', { clase: 'confirmar-pregunta' },
          mensaje ||
            'Esta instalación tiene puesto un pestillo: la función no atiende nada sin la clave de acceso.'
        ),
        h('p', { clase: 'suave', estilo: { 'font-size': '14px' } },
          'Es la que está en la variable CLAVE_ACCESO de Vercel. No es una cuenta ni un usuario: es un ' +
          'pestillo para que el repositorio público no deje la puerta abierta. Se guarda en este ' +
          'teléfono y no viaja a ninguna otra parte.'
        ),
        campo,
        queja,
        h('div', { clase: 'confirmar-acciones' },
          boton('Ahora no', renunciar, { tono: 'suave' }),
          boton('Guardar', aceptar, { tono: 'principal' })
        )
      )
    );

    document.body.appendChild(dialogo);
    document.addEventListener('keydown', alEscape, true);

    if (typeof dialogo.showModal === 'function') dialogo.showModal();
    else {
      dialogo.setAttribute('open', '');
      dialogo.classList.add('sin-modal');
    }

    if (typeof campo.focus === 'function') campo.focus();
  });

  return pidiendoLaClave;
}

// ---------------------------------------------------------------------------
// Los fallos que no recogió nadie
// ---------------------------------------------------------------------------

/**
 * Recoge lo que se rompa fuera de cualquier `try`: un error suelto o una promesa
 * que nadie esperaba. El usuario no lee registros de la nube y aquí tampoco va a
 * abrir la consola del navegador, así que se pinta en pantalla con palabras.
 */
function recogerLosFallosSueltos() {
  window.addEventListener('error', (evento) => {
    // Una imagen o un audio que no cargan también disparan «error», pero desde
    // su propio elemento: eso lo cuenta la pantalla que lo puso, no esto.
    if (evento && evento.target && evento.target !== window) return;

    // El objeto Error si lo hay; y si no, lo poco que traiga el evento CON SU
    // SITIO. `filename`, `lineno` y `colno` son justo lo que falta cuando el
    // mensaje es genérico, y antes se tiraban.
    if (evento && evento.error) return contarFalloSuelto(evento.error);
    contarFalloSuelto(dichoPorElNavegador(evento));
  });

  window.addEventListener('unhandledrejection', (evento) => {
    contarFalloSuelto(evento ? evento.reason : null);
  });

  // Los fallos que el propio estudio entrega en mano (app/ui.js): llegan con el
  // objeto Error entero, sin pasar por el navegador y sin que nadie los tape.
  window.addEventListener(EVENTO_FALLO_SUELTO, (evento) => {
    contarFalloSuelto(evento ? evento.detail : null);
  });
}

/**
 * Lo que dijo el navegador en un evento «error», con el archivo y la línea si
 * los hay.
 *
 * «Script error.» a secas es el navegador NEGÁNDOSE a contarlo: pasa cuando no
 * puede atribuir el error a ningún archivo servido desde aquí —una extensión
 * del navegador, un bloqueador de contenido, un script de otro sitio—. Se dice
 * tal cual en vez de disfrazarlo, porque disfrazarlo de fallo del estudio manda
 * a buscar donde no está.
 */
function dichoPorElNavegador(evento) {
  const mensaje = evento && evento.message ? String(evento.message) : '';
  const archivo = evento && evento.filename ? String(evento.filename) : '';
  if (!archivo) return mensaje || null;
  const linea = evento.lineno ? `:${evento.lineno}${evento.colno ? `:${evento.colno}` : ''}` : '';
  return `${mensaje}\n${archivo}${linea}`;
}

/** Si el navegador se ha negado a decir de dónde viene el fallo. */
function elNavegadorNoLoCuenta(fallo) {
  return typeof fallo === 'string' && /^script error\.?$/i.test(fallo.trim());
}

/**
 * Apila un fallo suelto arriba del todo, sin tocar la pantalla que esté puesta:
 * lo que se estuviera haciendo no tiene por qué perderse por esto.
 * @param {*} fallo
 */
function contarFalloSuelto(fallo) {
  console.error('Fallo sin recoger', fallo);

  // ¿ES NUESTRO O NO ES NUESTRO? De eso depende todo lo demás.
  //
  // Cuando el navegador dice «Script error.» a secas está diciendo que no puede
  // atribuirlo a ningún archivo de esta página. Un fallo de este estudio SIEMPRE
  // llega con su archivo y su línea —así se encontró el de la pantalla de Cola—,
  // así que este no lo es: es una extensión, un bloqueador o algo que el propio
  // navegador ha metido en la página.
  //
  // Y si no es nuestro, no puede tratarse como si lo fuera. Una tarjeta roja a
  // pantalla completa, tapando el plano que estabas mirando, con un botón de
  // recargar que no va a arreglar nada, sobre algo que no podemos tocar y que se
  // repite cada pocos segundos: eso no es avisar, es estorbar.
  const ajeno = elNavegadorNoLoCuenta(fallo);

  const error = fallo instanceof ErrorDeCara
    ? fallo
    : ajeno
    ? new ErrorDeCara(
        'El navegador ha dado un error que se niega a identificar («Script error.»). Eso significa ' +
          'que NO viene de este estudio: solo tapa así lo que no puede atribuir a un archivo de esta ' +
          'página, o sea una extensión, un bloqueador de contenido o algo que el propio navegador ha ' +
          'metido. El estudio sigue funcionando. Si algo se queda a medias, prueba en una ventana ' +
          'privada.',
        { detalle: 'Script error.', reintentable: false, http: 0 }
      )
    : new ErrorDeCara(
        'Algo se ha roto por dentro del estudio y nadie lo ha recogido. No es tu cuenta ni tu bucket: ' +
          'es un fallo de la propia aplicación. Lo que estuvieras haciendo puede haberse quedado a ' +
          'medias, así que compruébalo antes de seguir. Debajo está lo que dijo el navegador, palabra ' +
          'por palabra.',
        { detalle: loQueDijo(fallo), reintentable: false, http: 500 }
      );

  const firma = `${error.mensaje} · ${error.detalle || ''}`;

  // Cerrado con «Entendido» es cerrado para siempre, hasta recargar.
  if (fallosDescartados.has(firma)) return;

  // Si ya está en pantalla, no se apila otra igual: se cuenta.
  const yaPuesto = fallosPuestos.get(firma);
  if (yaPuesto) {
    yaPuesto.veces += 1;
    vaciar(yaPuesto.contador);
    yaPuesto.contador.appendChild(
      document.createTextNode(`Ha vuelto a pasar ${yaPuesto.veces} veces desde que se abrió esto.`)
    );
    return;
  }

  const contador = h('p', {
    clase: 'tenue',
    estilo: { margin: 'var(--espacio-2) 0 0', 'font-size': '12px' },
  });

  const bandeja = laBandejaDeFallos();
  const tarjeta = h('div', { estilo: { position: 'relative' } },
    // Sin `detalle` a propósito: el detalle va abajo, a la vista, en el <pre>. Si
    // se le pasa también aquí sale DOS VECES —una en el desplegable de aviso() y
    // otra en el <pre>—, que es justo lo que se vio en el teléfono.
    aviso(error.mensaje, { tono: ajeno ? 'nota' : 'error' }),

    // LO QUE DIJO EL NAVEGADOR, A LA VISTA Y SIN TENER QUE ABRIR NADA.
    //
    // Un fallo suelto no es un problema de la cuenta ni de Google: es SIEMPRE un
    // defecto de este código, y esconder detrás de un desplegable la única línea
    // que dice dónde está no ayuda a nadie. Con los errores de Google el
    // desplegable tiene sentido —son parrafadas en inglés y lo que importa está
    // arriba, traducido—; aquí lo que importa son esas cuatro palabras.
    error.detalle
      ? h('pre', {
          clase: 'mono',
          estilo: {
            margin: 'var(--espacio-2) 0 0',
            padding: '8px 10px',
            background: 'var(--fondo-alto-2)',
            'border-radius': 'var(--radio-chico)',
            'white-space': 'pre-wrap',
            'word-break': 'break-word',
            'font-size': '12px',
          },
        }, error.detalle)
      : null,
    contador,
    h('div', { clase: 'tarjeta-acciones' },
      boton('Entendido', () => {
        // Cerrarlo es decir «ya lo he visto». Se recuerda, y si el mismo fallo
        // vuelve a dispararse —y uno que salta con cada latido de la cola va a
        // volver— ya no se pinta más. Antes esto borraba la memoria y el
        // siguiente latido lo traía de vuelta: se cerraba y volvía a salir.
        fallosDescartados.add(firma);
        fallosPuestos.delete(firma);
        tarjeta.remove();
        if (!bandeja.firstChild) bandeja.remove();
      }, { tono: 'suave' }),
      // Recargar solo se ofrece cuando el fallo es NUESTRO y puede haber dejado
      // algo a medias. Con uno que el navegador ni siquiera atribuye a esta
      // página, recargar no arregla nada y sí tira lo que estuvieras mirando.
      ajeno
        ? null
        : boton('Recargar la aplicación', () => window.location.reload(), { tono: 'peligro' })
    )
  );

  fallosPuestos.set(firma, { tarjeta, veces: 1, contador });
  bandeja.appendChild(tarjeta);
  while (bandeja.childElementCount > MAXIMO_FALLOS_SUELTOS) {
    const sobra = bandeja.firstElementChild;
    for (const [clave, puesto] of fallosPuestos) {
      if (puesto.tarjeta === sobra) fallosPuestos.delete(clave);
    }
    sobra.remove();
  }
}

/**
 * Dónde se apilan. Va fija arriba y por encima de todo, y con su propio
 * desplazamiento: cuatro errores de Google seguidos no caben en un teléfono.
 * @returns {HTMLElement}
 */
function laBandejaDeFallos() {
  if (bandejaDeFallos && bandejaDeFallos.isConnected) return bandejaDeFallos;

  bandejaDeFallos = h('div', {
    clase: 'fallos-sueltos',
    role: 'alert',
    estilo: {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      'z-index': '40',
      display: 'flex',
      'flex-direction': 'column',
      gap: '8px',
      padding: '8px',
      'max-width': '900px',
      'max-height': '70vh',
      margin: '0 auto',
      'overflow-y': 'auto',
      'padding-top': 'calc(8px + env(safe-area-inset-top, 0px))',
    },
  });

  document.body.appendChild(bandejaDeFallos);
  return bandejaDeFallos;
}

/**
 * Lo único que se cuenta sin `aviso()`: index.html no trae el sitio donde pintar,
 * así que se escribe a pelo sobre el cuerpo del documento.
 */
function contarSinSitio() {
  const texto =
    'El estudio no encuentra dónde pintarse: en la página faltan el hueco de la pantalla o la barra de ' +
    'pestañas. Es un fallo del propio estudio, no de tu cuenta, y casi siempre significa que el ' +
    'despliegue subió a medias. Vuelve a desplegar y recarga la página.';

  console.error(texto);
  if (!document.body) return;

  const caja = document.createElement('div');
  caja.style.cssText =
    'margin:24px auto;max-width:640px;padding:16px;border:1px solid #39424e;border-left:4px solid ' +
    '#c8635a;border-radius:8px;background:#14171c;color:#e9ecef;font:16px/1.45 system-ui,sans-serif';
  caja.textContent = texto;
  document.body.appendChild(caja);
}

// ---------------------------------------------------------------------------
// Volver al frente
// ---------------------------------------------------------------------------

/**
 * Al volver a la aplicación después de tener el móvil bloqueado o en otra cosa,
 * se vuelve a arrancar la cola. Es idempotente: si seguía corriendo, no hace
 * nada. Y si el navegador la había dormido, se despierta sola sin tener que
 * recargar (plan §8: nada depende de que el navegador siga abierto).
 */
function alVolverAlFrente() {
  if (document.visibilityState !== 'visible') return;

  actualizarElPuntoDeCola();

  if (!Cola || typeof Cola.arrancar !== 'function') return;
  Promise.resolve()
    .then(() => Cola.arrancar())
    .catch((fallo) => {
      contarFalloSuelto(comoErrorDeCara(fallo, 'volver a arrancar la cola al abrir la aplicación'));
    });
}

// ---------------------------------------------------------------------------
// Menudencias
// ---------------------------------------------------------------------------

/**
 * Cualquier cosa que se haya roto, contada con palabras. Lo que ya viene con su
 * frase en español se deja tal cual.
 * @param {*} fallo
 * @param {string} haciendo qué se estaba haciendo, para meterlo en la frase
 * @returns {ErrorDeCara}
 */
function comoErrorDeCara(fallo, haciendo) {
  if (fallo instanceof ErrorDeCara) return fallo;

  return new ErrorDeCara(
    `Algo ha fallado al ${haciendo}, y no ha sido la nube: ha sido el propio estudio, dentro del ` +
      'navegador. Debajo está lo que dijo el navegador, palabra por palabra.',
    { detalle: loQueDijo(fallo), reintentable: true, http: 0 }
  );
}

/**
 * Lo que dijo un fallo del navegador, para el detalle plegado.
 * @param {*} fallo
 * @returns {string|null}
 */
function loQueDijo(fallo) {
  if (fallo == null) return null;
  if (typeof fallo === 'string') return fallo;
  if (fallo.message) {
    const linea = String(fallo.message);
    // La primera línea de la pila dice el archivo, que es lo que hace falta para
    // saber qué pantalla se rompió. El resto es ruido en un teléfono.
    const pila = typeof fallo.stack === 'string' ? fallo.stack.split('\n')[1] : '';
    return pila ? `${linea}\n${pila.trim()}` : linea;
  }
  try {
    return JSON.stringify(fallo);
  } catch {
    return String(fallo);
  }
}

/**
 * El texto si lo hay, y el de respaldo si no.
 * @param {*} valor
 * @param {string} respaldo
 * @returns {string}
 */
function textoO(valor, respaldo) {
  const texto = typeof valor === 'string' ? valor.trim() : '';
  return texto || respaldo;
}
