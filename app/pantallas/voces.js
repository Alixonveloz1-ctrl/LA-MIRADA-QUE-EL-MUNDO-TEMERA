// Voces — el reparto de la serie, ordenado por volumen de diálogo, y la voz de
// cada personaje elegida ESCUCHÁNDOLA.
//
// Es la única pantalla donde se decide algo que después no se vuelve a tocar en
// toda la temporada: el timbre de cada personaje. Por eso está construida
// alrededor de tres reglas que no son estéticas.
//
//   1. LOS IDS DE VOZ NO SE INVENTAN. Se listan desde la API, tal como los
//      devuelve Google, con su género. Aquí no hay ni una voz escrita en el
//      código, ni una lista «recomendada», ni un orden que sugiera nada.
//
//   2. NUNCA UN SALUDO NEUTRO. Cada candidata dice la frase MÁS DIFÍCIL de ese
//      personaje en toda la serie, con su intención puesta. Una voz que suena
//      bien diciendo «hola» no dice nada: lo que hay que oír es si aguanta el
//      grito de la madre o la amabilidad horrible del celebrante. La frase y su
//      intención salen de datos/serie.json y la compone la función, no el
//      navegador: aquí solo se manda el id del personaje y el de la voz.
//
//      Y todas las candidatas dicen EXACTAMENTE la misma frase: la traducción al
//      japonés se hace una vez por personaje y se guarda en el estado. Si cada
//      una dijera un japonés distinto, no se podrían comparar, que es justo para
//      lo que existe esta pantalla.
//
//   3. NO HAY BOTÓN DE ELEGIR SIN HABER OÍDO. Cada candidata es una tarjeta con
//      su reproductor de verdad; hasta que no hay audio, el botón de elegir está
//      apagado y dice por qué. Elegir de una lista, por el nombre de la voz, es
//      exactamente el error que esta pantalla existe para impedir.
//
// POR QUÉ SEIS PERSONAJES VAN MARCADOS. Seis se llevan el grueso del diálogo de
// la serie y los otros veintitrés se reparten el resto. Cada muestra es una
// llamada de voz que se paga, y el tiempo de escuchar también cuenta: saber
// dónde merece la pena gastarlo es la mitad del trabajo de esta pantalla. El
// reparto ya viene ordenado por volumen de diálogo en datos/serie.json y aquí no
// se reordena: se enseña como está y se marcan los seis primeros.
//
// POR QUÉ ALGUIEN PUEDE QUEDARSE SIN MUESTRA. La frase de muestra vive en
// `voces.reparto[].muestra` y hay figurantes que no la tienen escrita. Para esos
// se busca en datos/guiones.json su línea más difícil disponible y se enseña
// tal cual, diciendo de qué episodio y escena sale y por qué es esa. Lo que no
// se hace jamás es inventar una frase: si no hay ninguna, se dice «sin frase de
// muestra» y ahí se queda.

import { llamar } from '../api.js';
import { actual, alCambiar, cambiar } from '../estado.js';
import {
  h, pantalla, seccion, tarjeta, boton, aviso, barra, filtro, espera, confirmar, vaciar,
} from '../ui.js';
import { segundos, plural, porcentaje } from '../formato.js';

// ---------------------------------------------------------------------------
// Constantes de la pantalla
// ---------------------------------------------------------------------------

/**
 * Cuántos personajes van marcados como «donde merece la pena gastar tiempo».
 * Son los seis primeros del reparto, que ya viene ordenado por volumen de
 * diálogo; el porcentaje exacto que suman se calcula con los datos y se escribe
 * en pantalla, no se da por sabido.
 */
const CUANTOS_MANDAN = 6;

/** Cuántas rutas caben en una sola petición de firmas (docs/contrato.md §2). */
const RUTAS_POR_FIRMA = 200;

// ---------------------------------------------------------------------------
// La pantalla
// ---------------------------------------------------------------------------

export default {
  id: 'voces',
  titulo: 'Voces',
  icono: '\u{1F399}',

  /**
   * Pinta el reparto y devuelve cómo desmontarlo.
   * @param {HTMLElement} raiz
   * @returns {Promise<() => void>}
   */
  async montar(raiz) {
    let vivo = true;

    /** `datos/serie.json`, de donde sale el reparto entero. */
    let serie = null;
    /** `datos/guiones.json`, que llega después y solo hace falta para dos cosas. */
    let guiones = null;
    /** Las voces reales de la API. Sin esto no se puede elegir nada. */
    let candidatas = [];
    /** Por qué no hay lista de voces, si no la hay. */
    let porQueNoHayVoces = null;

    /** Ruta lógica → URL firmada, para poder oír lo ya generado sin repetirlo. */
    const urls = new Map();
    /** Qué personajes tienen el panel de candidatas abierto. */
    const abiertos = new Set();
    /** Qué muestras se están generando ahora mismo: «personaje|voz». */
    const generando = new Set();
    /** El género por el que filtra cada personaje su lista de candidatas. */
    const generoElegido = new Map();
    /** Lo último que hay que decirle al usuario en cada tarjeta. */
    const recados = new Map();
    /** El japonés de cada personaje cuando acaba de llegar y el estado aún no. */
    const japonesReciente = new Map();
    /** La duración de cada muestra recién generada, para el pie del reproductor. */
    const duraciones = new Map();
    /** Personaje → su tarjeta puesta, para repintar solo la que cambia. */
    const nodos = new Map();
    /** Personaje → firma de lo suyo en el estado, para saber si hay que repintar. */
    const firmas = new Map();
    /** Personaje → muestras generadas en esta sesión, antes de recargar el estado. */
    const muestrasRecientes = new Map();
    /** Personaje → cómo lo llama el guion, calculado una sola vez. */
    const etiquetas = new Map();

    /** Si ya se están pidiendo firmas, para no pedirlas dos veces a la vez. */
    let pidiendoFirmas = false;

    const intro = h('div', { clase: 'rejilla' });
    const huecoSeis = h('div', { clase: 'rejilla' });
    const huecoResto = h('div', { clase: 'rejilla' });

    const cuerpo = pantalla(
      'Reparto de voces',
      intro,
      seccion('Los seis que se llevan el grueso del diálogo', huecoSeis),
      seccion('El resto del reparto', huecoResto),
    );
    raiz.appendChild(cuerpo);

    intro.appendChild(espera('Trayendo el reparto y la lista de voces…'));

    const desuscribir = alCambiar(() => {
      if (vivo) repintarLoQueHayaCambiado();
    });

    arrancar().catch((fallo) => {
      if (!vivo) return;
      vaciar(intro);
      intro.appendChild(avisoDeFallo(fallo));
    });

    return () => {
      vivo = false;
      desuscribir();
    };

    // -----------------------------------------------------------------------
    // Arranque
    // -----------------------------------------------------------------------

    /**
     * Trae el reparto y la lista de voces, pinta, y después va completando: las
     * URL firmadas de lo ya generado y los guiones, que solo hacen falta para
     * los figurantes sin frase de muestra y para llamar a cada uno como lo llama
     * el guion.
     * @returns {Promise<void>}
     */
    async function arrancar() {
      const [deLaSerie, deLasVoces] = await Promise.allSettled([
        bajarLaSerie(),
        llamar('voces'),
      ]);

      if (!vivo) return;

      if (deLaSerie.status !== 'fulfilled') throw deLaSerie.reason;
      serie = deLaSerie.value;

      if (deLasVoces.status === 'fulfilled') {
        candidatas = Array.isArray(deLasVoces.value.voces) ? deLasVoces.value.voces : [];
        porQueNoHayVoces = candidatas.length
          ? null
          : 'Google no ha devuelto ninguna voz para el idioma de la serie. Sin lista no se puede ' +
            'elegir, y los ids de voz no se inventan. Casi siempre es que falta habilitar la API ' +
            'de síntesis de voz en el proyecto: la pantalla de Salud lo dice con el error de ' +
            'Google delante.';
      } else {
        candidatas = [];
        porQueNoHayVoces = deLasVoces.reason && deLasVoces.reason.mensaje
          ? deLasVoces.reason.mensaje
          : 'No se ha podido traer la lista de voces de Google.';
      }

      pintarTodo();

      // Lo de después, sin bloquear: la pantalla ya se puede usar.
      asegurarUrls().catch(() => {
        // Si las firmas fallan, cada tarjeta lo dirá cuando toque; no es motivo
        // para tumbar la pantalla entera.
      });

      bajarLosGuiones()
        .then((traidos) => {
          if (!vivo) return;
          guiones = traidos;
          // Los guiones cambian el nombre con el que se llama a cada personaje y
          // rellenan la línea de los que no tienen frase de muestra, así que se
          // repinta la lista entera. Llega a los pocos segundos de entrar, mucho
          // antes de que pueda haber nada sonando.
          pintarTodo();
        })
        .catch((fallo) => {
          if (!vivo) return;
          guiones = { fallo };
          pintarTodo();
        });
    }

    // -----------------------------------------------------------------------
    // Pintar
    // -----------------------------------------------------------------------

    /** Repinta la cabecera y las dos listas enteras. */
    function pintarTodo() {
      const fichas = repartoDeLaSerie();
      const mandan = fichas.slice(0, CUANTOS_MANDAN);
      const resto = fichas.slice(CUANTOS_MANDAN);

      vaciar(intro);
      vaciar(huecoSeis);
      vaciar(huecoResto);
      nodos.clear();

      intro.appendChild(pintarCabecera(fichas, mandan));

      if (porQueNoHayVoces) {
        intro.appendChild(aviso(porQueNoHayVoces, { tono: 'error' }));
      }

      if (guiones && guiones.fallo) {
        intro.appendChild(aviso(
          'No se han podido leer los guiones, así que a cada personaje se le llama aquí por su id ' +
          'y los que no tienen frase de muestra escrita no pueden enseñar su línea más difícil. ' +
          'Todo lo demás funciona igual.',
          { tono: 'nota', detalle: guiones.fallo.mensaje || String(guiones.fallo) }));
      }

      if (!fichas.length) {
        huecoSeis.appendChild(aviso(
          'No hay reparto de voces escrito en datos/serie.json (voces.reparto). Sin él no hay a ' +
          'quién ponerle voz: ese archivo va dentro del repositorio, así que si falta es que el ' +
          'despliegue no ha subido entero.',
          { tono: 'error' }));
        return;
      }

      for (const ficha of mandan) huecoSeis.appendChild(pintarPersonaje(ficha, true));

      if (!resto.length) {
        huecoResto.appendChild(h('p', { clase: 'tenue' }, 'No hay nadie más en el reparto.'));
        return;
      }
      for (const ficha of resto) huecoResto.appendChild(pintarPersonaje(ficha, false));
    }

    /**
     * Lo de arriba: cuánto se lleva cada grupo y cuántas voces quedan por elegir.
     * @param {object[]} fichas
     * @param {object[]} mandan
     * @returns {HTMLElement}
     */
    function pintarCabecera(fichas, mandan) {
      const lineasTotales = fichas.reduce((suma, f) => suma + (Number(f.lineas) || 0), 0);
      const lineasDeLosSeis = mandan.reduce((suma, f) => suma + (Number(f.lineas) || 0), 0);
      const elegidas = fichas.filter((f) => vozElegidaDe(f.personaje)).length;

      return h('div', null,
        h('p', { clase: 'suave' },
          `${plural(fichas.length, 'personaje habla', 'personajes hablan')} en la serie, ` +
          `${plural(lineasTotales, 'línea', 'líneas')} en total. Los ` +
          `${CUANTOS_MANDAN} primeros se llevan ${porcentaje(lineasDeLosSeis, lineasTotales)} del ` +
          'diálogo: son en los que merece la pena gastar tiempo escuchando candidatas. El orden ' +
          'es el del reparto de datos/serie.json, que ya viene por volumen de diálogo.'),
        barra(elegidas, fichas.length, { etiqueta: 'Voces elegidas' }),
        h('p', { clase: 'tenue' },
          'La voz elegida se guarda en el estado, en el bucket, y es la que dirá todas las líneas ' +
          'de ese personaje. El timbre no deriva entre llamadas: es la voz elegida. Lo que sí ' +
          'cambia de una llamada a otra es la entrega, y contra eso lo que se hace es generar cada ' +
          'escena de una sola vez, no línea a línea.'));
    }

    /**
     * La tarjeta de un personaje: sus líneas, su porcentaje, sus episodios, su
     * frase de muestra, y sus candidatas cuando el panel está abierto.
     *
     * @param {object} ficha la entrada de `voces.reparto`
     * @param {boolean} deLosSeis si es de los que se llevan el grueso del diálogo
     * @returns {HTMLElement}
     */
    function pintarPersonaje(ficha, deLosSeis) {
      const id = String(ficha.personaje);
      const elegida = vozElegidaDe(id);
      const muestra = muestraDe(ficha);
      const recado = recados.get(id) || null;

      const acciones = [];

      if (elegida) {
        acciones.push(boton('Cambiar la voz elegida', () => cambiarLaVoz(id), { tono: 'suave' }));
      } else if (!muestra.sePuedeOir) {
        // Sin frase de muestra ESCRITA EN LOS DATOS no hay nada que oír: la
        // compone la función desde `voces.reparto[].muestra`, así que un botón
        // aquí solo serviría para gastar una llamada y volver con un error. Se
        // apaga diciendo qué falta y dónde se escribe.
        acciones.push(boton('Probar voces', () => {}, {
          desactivado: muestra.porQueNoSePuede,
        }));
      } else if (!candidatas.length) {
        acciones.push(boton('Probar voces', () => {}, {
          desactivado: 'No hay lista de voces de Google, y los ids no se inventan. Mira la ' +
            'pantalla de Salud: casi siempre falta habilitar la API de síntesis de voz.',
        }));
      } else {
        acciones.push(boton(
          abiertos.has(id) ? 'Cerrar las candidatas' : `Oír las ${candidatas.length} candidatas`,
          () => {
            if (abiertos.has(id)) abiertos.delete(id);
            else abiertos.add(id);
            refrescar(id);
          },
          { tono: deLosSeis ? 'principal' : 'suave' },
        ));
      }

      const tarjetaDelPersonaje = tarjeta({
        titulo: nombreEnPantalla(id),
        estado: elegida
          ? { tipo: 'elegido', texto: 'Voz elegida' }
          : { tipo: 'pendiente', texto: 'Sin voz' },
        pie: h('div', null,
          deLosSeis
            ? h('p', {
                estilo: { margin: '0 0 8px', color: 'var(--acento)', 'font-size': '13px' },
              }, 'Uno de los seis que se llevan el grueso del diálogo.')
            : null,
          h('p', { clase: 'suave', estilo: { margin: '0' } },
            `${plural(Number(ficha.lineas) || 0, 'línea', 'líneas')} · `,
            `${escribirPorcentaje(ficha.porcentaje)} del diálogo · `,
            episodiosEnTexto(ficha.episodios)),
          h('p', { clase: 'tenue mono', estilo: { margin: '2px 0 0', 'font-size': '12px' } }, id),
          elegida ? pintarLaElegida(id, elegida) : null,
          pintarLaMuestra(id, muestra),
          recado ? aviso(recado.mensaje, { tono: recado.tono, detalle: recado.detalle }) : null,
          abiertos.has(id) && !elegida ? pintarCandidatas(ficha) : null),
        acciones,
      });

      if (deLosSeis) {
        // La marca de los seis, además de la sección y de la línea de arriba: en
        // un teléfono se llega a una tarjeta desplazando, y para entonces el
        // título de la sección hace rato que no se ve.
        tarjetaDelPersonaje.style.setProperty('border-left', '3px solid var(--acento)');
      }

      nodos.set(id, tarjetaDelPersonaje);
      firmas.set(id, firmaDe(id));
      return tarjetaDelPersonaje;
    }

    /**
     * Lo que se está oyendo: la frase de muestra en español, su intención y su
     * traducción al japonés, que es lo que dicen de verdad las candidatas.
     *
     * @param {string} id
     * @param {{texto:string|null, intencion:string|null, de:string|null, porque:string|null, prestada:boolean, sePuedeOir:boolean, porQueNoSePuede:string|null}} muestra
     * @returns {HTMLElement}
     */
    function pintarLaMuestra(id, muestra) {
      if (!muestra.texto) {
        return h('div', { estilo: { 'margin-top': '10px' } },
          h('p', { estilo: { margin: '0' } }, 'Sin frase de muestra.'),
          h('p', { clase: 'tenue', estilo: { margin: '4px 0 0', 'font-size': '13px' } },
            muestra.porQueNoSePuede));
      }

      const ja = japonesDe(id);

      return h('div', {
        estilo: {
          'margin-top': '10px',
          padding: '10px 12px',
          background: 'var(--fondo-hundido)',
          border: '1px solid var(--borde)',
          'border-radius': 'var(--radio-chico)',
        },
      },
        h('p', { clase: 'tenue', estilo: { margin: '0 0 4px', 'font-size': '12px' } },
          muestra.prestada
            ? 'Su línea más difícil disponible, sacada del guion'
            : 'Su frase más difícil de toda la serie'),
        h('p', { estilo: { margin: '0' } }, `«${muestra.texto}»`),
        muestra.intencion
          ? h('p', { clase: 'suave', estilo: { margin: '4px 0 0', 'font-size': '13px' } },
              `Se dice así: ${muestra.intencion}.`)
          : null,
        muestra.de
          ? h('p', { clase: 'tenue', estilo: { margin: '4px 0 0', 'font-size': '12px' } }, muestra.de)
          : null,
        muestra.porque
          ? h('p', { clase: 'tenue', estilo: { margin: '2px 0 0', 'font-size': '12px' } }, muestra.porque)
          : null,
        ja
          ? h('p', { clase: 'tenue', estilo: { margin: '6px 0 0', 'font-size': '12px' } },
              'Lo que se oye, en japonés: ', h('span', { clase: 'mono' }, ja),
              ' — la serie se dobla en japonés y se subtitula en español; este texto no aparece ' +
              'en pantalla en ningún momento del vídeo.')
          : null,
        muestra.prestada ? pintarComoEscribirla(id, muestra) : null);
    }

    /**
     * Para los que no tienen frase de muestra escrita: el trozo de JSON, listo
     * para copiar, que hay que pegar en datos/serie.json para que se les pueda
     * elegir voz. No se manda desde aquí porque la muestra la compone la función
     * desde los datos, no el navegador.
     *
     * @param {string} id
     * @param {object} muestra
     * @returns {HTMLElement}
     */
    function pintarComoEscribirla(id, muestra) {
      const trozo = JSON.stringify({
        muestra: {
          ep: muestra.ep ?? null,
          escena: muestra.escena ?? null,
          texto: muestra.texto,
          intencion: muestra.intencion || '',
        },
      }, null, 2);

      const caja = h('pre', {
        clase: 'mono',
        estilo: {
          margin: '8px 0 0',
          padding: '8px 10px',
          background: 'var(--fondo-alto-2)',
          'border-radius': 'var(--radio-chico)',
          'white-space': 'pre-wrap',
          'font-size': '12px',
        },
      }, trozo);

      const elBoton = boton('Copiar la muestra para serie.json', () => copiar(trozo, elBoton, caja));

      return h('div', null,
        h('p', { clase: 'tenue', estilo: { margin: '8px 0 0', 'font-size': '12px' } },
          'Esta línea está en el guion pero no en «voces.reparto» de datos/serie.json, y la muestra ' +
          `la compone la función desde ahí. Pégala en la entrada de «${id}» y podrá oírse:`),
        caja,
        h('div', { clase: 'tarjeta-acciones' }, elBoton));
    }

    /**
     * La voz ya elegida, con su muestra al lado si está guardada: fijada quiere
     * decir fijada, pero poder volver a oírla no cuesta nada y evita la duda.
     * @param {string} id
     * @param {string} vozId
     * @returns {HTMLElement}
     */
    function pintarLaElegida(id, vozId) {
      const oible = muestraOible(id, vozId);
      const nota = h('p', { clase: 'tenue', estilo: { margin: '4px 0 0', 'font-size': '12px' } });

      return h('div', { estilo: { 'margin-top': '10px' } },
        h('p', { estilo: { margin: '0' } },
          'Voz elegida: ', h('span', { clase: 'mono' }, nombreCortoDeVoz(vozId))),
        h('p', { clase: 'tenue mono', estilo: { margin: '2px 0 0', 'font-size': '12px' } }, vozId),
        oible
          ? h('div', { estilo: { 'margin-top': '8px' } },
              reproductor(
                oible,
                `Muestra de ${nombreEnPantalla(id)} con ${nombreCortoDeVoz(vozId)}`,
                nota,
              ),
              nota)
          : null,
        h('p', { clase: 'tenue', estilo: { margin: '6px 0 0', 'font-size': '12px' } },
          'Dirá todas sus líneas en toda la serie. Cambiarla ahora no rehace lo ya grabado: los ' +
          'bloques de voz que ya existan seguirían con la voz anterior hasta que se rehagan en la ' +
          'pantalla de Audio.'));
    }

    /**
     * El panel de candidatas: una tarjeta por voz, con su reproductor cuando ya
     * se ha oído y con el botón de elegir apagado mientras no lo haya.
     *
     * @param {object} ficha
     * @returns {HTMLElement}
     */
    function pintarCandidatas(ficha) {
      const id = String(ficha.personaje);
      const generos = generosDisponibles();

      // POR DEFECTO, SOLO LAS DE SU GÉNERO. Un personaje masculino no enseña
      // voces femeninas: escuchar treinta candidatas cuando la mitad no se van a
      // elegir es tiempo perdido, y con seis personajes que se llevan el 75% del
      // diálogo ese tiempo es real. El género sale de datos/serie.json, donde el
      // parche lo deduce de la propia identidad del personaje.
      //
      // Se puede quitar el filtro a mano: la pastilla «todas» sigue ahí, porque
      // una voz de otro género puede ser justo la que quede bien y esconderla
      // sería peor que enseñarla.
      const suyo = generoDelPersonaje(serie, id);
      const puesto = generoElegido.get(id) || (suyo && generos.includes(suyo) ? suyo : 'todos');
      const lista = puesto === 'todos'
        ? candidatas
        : candidatas.filter((v) => generoDe(v) === puesto);

      const panel = h('div', { estilo: { 'margin-top': '12px' } },
        h('p', { clase: 'tenue', estilo: { margin: '0 0 8px', 'font-size': '13px' } },
          `Cada muestra es una llamada de voz que dice esa misma frase con esa misma intención. ` +
          'Genera las que quieras comparar, escúchalas seguidas y elige. Lo generado se guarda: ' +
          'volver a entrar aquí no lo paga otra vez.'),
        generos.length > 1
          ? filtro(
              [{ id: 'todos', texto: 'Todas', cuenta: candidatas.length }].concat(
                generos.map((g) => ({
                  id: g,
                  texto: primeraMayuscula(g),
                  cuenta: candidatas.filter((v) => generoDe(v) === g).length,
                })),
              ),
              puesto,
              (valor) => {
                generoElegido.set(id, valor);
                refrescar(id);
              },
            )
          : null);

      if (!lista.length) {
        panel.appendChild(h('p', { clase: 'tenue' },
          'Ninguna voz de la lista tiene ese género declarado. Quita el filtro para verlas todas.'));
        return panel;
      }

      const rejilla = h('div', { clase: 'rejilla', estilo: { 'margin-top': '10px' } });
      for (const voz of lista) rejilla.appendChild(pintarCandidata(ficha, voz));
      panel.appendChild(rejilla);
      return panel;
    }

    /**
     * Una candidata: su tarjeta, su reproductor de verdad y sus dos botones.
     * @param {object} ficha
     * @param {{id:string, genero:string}} voz
     * @returns {HTMLElement}
     */
    function pintarCandidata(ficha, voz) {
      const id = String(ficha.personaje);
      const clave = `${id}|${voz.id}`;
      const oible = muestraOible(id, voz.id);
      const trabajando = generando.has(clave);
      const dura = duraciones.get(clave);
      const nota = h('p', { clase: 'tenue', estilo: { margin: '4px 0 0', 'font-size': '12px' } });

      const acciones = [];

      if (trabajando) {
        acciones.push(boton('Generando…', () => {}, {
          desactivado: 'Ya se está generando esta muestra. Se paga una vez.',
        }));
      } else {
        acciones.push(boton(
          oible ? 'Volver a generarla' : 'Oír esta voz',
          () => generarMuestra(ficha, voz),
          { tono: oible ? 'suave' : 'principal' },
        ));
      }

      acciones.push(boton('Elegir esta voz', () => elegirLaVoz(id, voz.id), {
        tono: 'principal',
        desactivado: oible
          ? false
          : 'Todavía no la has oído. Elegir una voz por su nombre, sin escucharla, es justo lo que ' +
            'esta pantalla existe para evitar: genera antes su muestra.',
      }));

      return tarjeta({
        titulo: nombreCortoDeVoz(voz.id),
        // El `<audio>` va como media de la tarjeta, y va suelto —sin envolverlo—
        // porque es así como la hoja de estilo sabe que esta tarjeta no lleva
        // marco de 16:9 sino una fila de reproductor.
        media: oible
          ? reproductor(
              oible,
              `Muestra de ${nombreEnPantalla(id)} con ${nombreCortoDeVoz(voz.id)}`,
              nota,
            )
          : null,
        estado: oible ? { tipo: 'listo', texto: 'Oída' } : { tipo: 'pendiente', texto: 'Sin oír' },
        pie: h('div', null,
          nota,
          h('p', { clase: 'tenue mono', estilo: { margin: '0', 'font-size': '12px' } }, voz.id),
          h('p', { clase: 'suave', estilo: { margin: '2px 0 0', 'font-size': '13px' } },
            `Género: ${generoDe(voz)}`,
            dura ? ` · dura ${segundos(dura)}` : ''),
          trabajando ? espera('Diciendo la frase con esta voz…') : null),
        acciones,
      });
    }

    // -----------------------------------------------------------------------
    // Acciones
    // -----------------------------------------------------------------------

    /**
     * Genera la muestra de un personaje con una voz candidata. La frase, la
     * intención y la traducción las pone la función: desde aquí solo van dos ids.
     *
     * @param {object} ficha
     * @param {{id:string}} voz
     * @returns {Promise<void>}
     */
    async function generarMuestra(ficha, voz) {
      const id = String(ficha.personaje);
      const clave = `${id}|${voz.id}`;
      if (generando.has(clave)) return;

      generando.add(clave);
      recados.delete(id);
      refrescar(id);

      try {
        const datos = await llamar('voz-muestra', { personaje: id, voz_id: voz.id });
        if (!vivo) return;

        if (datos.ruta && datos.url) urls.set(datos.ruta, datos.url);
        if (datos.ja) japonesReciente.set(id, String(datos.ja));
        if (datos.dur_s != null) duraciones.set(clave, Number(datos.dur_s));

        // La función ya lo ha apuntado en el estado del bucket. La copia de este
        // navegador se enterará en la próxima escritura; mientras tanto, lo que
        // se acaba de generar se recuerda aquí para poder oírlo sin repetirlo.
        recordarMuestra(id, voz.id, datos.ruta);
      } catch (fallo) {
        if (!vivo) return;
        recados.set(id, {
          tono: 'error',
          mensaje: fallo && fallo.mensaje ? fallo.mensaje : 'No se ha podido generar la muestra.',
          detalle: fallo && fallo.detalle ? fallo.detalle : null,
        });
      } finally {
        generando.delete(clave);
        if (vivo) refrescar(id);
      }
    }

    /**
     * Fija la voz de un personaje. Se pregunta antes porque es la decisión que
     * no se vuelve a tocar.
     * @param {string} id
     * @param {string} vozId
     * @returns {Promise<void>}
     */
    async function elegirLaVoz(id, vozId) {
      const seguro = await confirmar(
        `¿Fijar ${nombreCortoDeVoz(vozId)} como la voz de ${nombreEnPantalla(id)}? Dirá todas sus ` +
        'líneas en toda la serie.',
      );
      if (!seguro || !vivo) return;

      recados.delete(id);
      // Se cierra el panel ANTES de escribir: `cambiar()` avisa a la pantalla en
      // cuanto guarda, y para entonces la tarjeta ya tiene que saber que esto
      // está decidido.
      abiertos.delete(id);

      try {
        await cambiar((estado) => {
          entradaDeVoz(estado, id).voz_id = vozId;
        });
      } catch (fallo) {
        if (!vivo) return;
        abiertos.add(id);
        recados.set(id, {
          tono: 'error',
          mensaje: fallo && fallo.mensaje
            ? fallo.mensaje
            : 'No se ha podido guardar la voz elegida en el estado.',
          detalle: fallo && fallo.detalle ? fallo.detalle : null,
        });
        refrescar(id);
      }
    }

    /**
     * Suelta la voz elegida para poder volver a escuchar y elegir otra. La regla
     * es que no se vuelve a tocar, y por eso se pregunta y se dice qué implica;
     * pero no poder corregir una elección desde el teléfono sería un callejón.
     * @param {string} id
     * @returns {Promise<void>}
     */
    async function cambiarLaVoz(id) {
      const seguro = await confirmar(
        `¿Cambiar la voz de ${nombreEnPantalla(id)}? Lo que ya esté grabado con la voz de antes no ` +
        'se rehace solo: habría que volver a generar esos bloques en la pantalla de Audio.',
      );
      if (!seguro || !vivo) return;

      recados.delete(id);

      try {
        await cambiar((estado) => {
          entradaDeVoz(estado, id).voz_id = null;
        });
        if (!vivo) return;
        abiertos.add(id);
        refrescar(id);
      } catch (fallo) {
        if (!vivo) return;
        recados.set(id, {
          tono: 'error',
          mensaje: fallo && fallo.mensaje
            ? fallo.mensaje
            : 'No se ha podido soltar la voz elegida en el estado.',
          detalle: fallo && fallo.detalle ? fallo.detalle : null,
        });
        refrescar(id);
      }
    }

    // -----------------------------------------------------------------------
    // Estado y repintado
    // -----------------------------------------------------------------------

    /** El estado, o un objeto vacío si todavía no ha llegado del bucket. */
    function elEstado() {
      try {
        return actual() || {};
      } catch {
        return {};
      }
    }

    /** La entrada de un personaje en el estado, creándola si venía corta. */
    function entradaDeVoz(estado, id) {
      if (!estado.voces || typeof estado.voces !== 'object') estado.voces = {};
      const dentro = estado.voces[id];
      if (!dentro || typeof dentro !== 'object') {
        estado.voces[id] = { voz_id: null, ja: null, muestras: {} };
      } else if (!dentro.muestras || typeof dentro.muestras !== 'object') {
        dentro.muestras = {};
      }
      return estado.voces[id];
    }

    /** Lo que el estado sabe de un personaje, sin crear nada. */
    function loGuardadoDe(id) {
      const voces = elEstado().voces;
      const dentro = voces && typeof voces === 'object' ? voces[id] : null;
      return dentro && typeof dentro === 'object' ? dentro : {};
    }

    /** La voz ya elegida de un personaje, o null. */
    function vozElegidaDe(id) {
      const dicho = loGuardadoDe(id).voz_id;
      return typeof dicho === 'string' && dicho.trim() ? dicho.trim() : null;
    }

    /** El japonés de la frase de muestra: el del estado o el recién llegado. */
    function japonesDe(id) {
      const guardado = loGuardadoDe(id).ja;
      if (typeof guardado === 'string' && guardado.trim()) return guardado.trim();
      return japonesReciente.get(id) || null;
    }

    /** Las muestras guardadas de un personaje: voz → ruta. */
    function muestrasDe(id) {
      const dentro = loGuardadoDe(id).muestras;
      const salida = new Map();
      if (dentro && typeof dentro === 'object') {
        for (const voz of Object.keys(dentro)) {
          const ruta = dentro[voz];
          if (typeof ruta === 'string' && ruta) salida.set(voz, ruta);
        }
      }
      const recientes = muestrasRecientes.get(id);
      if (recientes) {
        for (const [voz, ruta] of recientes) salida.set(voz, ruta);
      }
      return salida;
    }

    /**
     * La URL con la que se puede oír una muestra, si la hay. Sin URL no se pinta
     * reproductor: un `<audio>` sin fuente es peor que ninguno.
     * @param {string} id
     * @param {string} vozId
     * @returns {string|null}
     */
    function muestraOible(id, vozId) {
      const ruta = muestrasDe(id).get(vozId);
      if (!ruta) return null;
      return urls.get(ruta) || null;
    }

    /** Recuerda una muestra recién generada hasta que el estado se ponga al día. */
    function recordarMuestra(id, vozId, ruta) {
      if (!ruta) return;
      if (!muestrasRecientes.has(id)) muestrasRecientes.set(id, new Map());
      muestrasRecientes.get(id).set(vozId, ruta);
    }

    /**
     * Pide las URL firmadas de todo lo que se puede oír y todavía no tiene
     * enlace. Una sola petición para toda la pantalla: no pueden ser una por
     * muestra.
     * @returns {Promise<string[]>} los personajes cuyas tarjetas hay que repintar
     */
    async function asegurarUrls() {
      if (pidiendoFirmas) return [];

      const faltan = [];
      const tocados = new Set();
      for (const ficha of repartoDeLaSerie()) {
        const id = String(ficha.personaje);
        for (const ruta of muestrasDe(id).values()) {
          if (urls.has(ruta) || faltan.includes(ruta)) continue;
          faltan.push(ruta);
          tocados.add(id);
        }
      }
      if (!faltan.length) return [];

      pidiendoFirmas = true;
      try {
        for (let desde = 0; desde < faltan.length; desde += RUTAS_POR_FIRMA) {
          const trozo = faltan.slice(desde, desde + RUTAS_POR_FIRMA);
          const datos = await llamar('firmar', { rutas: trozo });
          const dadas = datos && datos.urls && typeof datos.urls === 'object' ? datos.urls : {};
          for (const ruta of Object.keys(dadas)) {
            if (dadas[ruta]) urls.set(ruta, String(dadas[ruta]));
          }
        }
      } finally {
        pidiendoFirmas = false;
      }

      if (!vivo) return [];
      const lista = [...tocados];
      for (const id of lista) refrescar(id);
      return lista;
    }

    /**
     * La firma de lo que esta pantalla enseña de un personaje. Si no cambia, su
     * tarjeta no se toca: repintarla pararía el audio que estuviera sonando.
     * @param {string} id
     * @returns {string}
     */
    function firmaDe(id) {
      const guardado = loGuardadoDe(id);
      const muestras = [...muestrasDe(id).entries()]
        .map(([voz, ruta]) => `${voz}=${urls.has(ruta) ? '1' : '0'}`)
        .sort()
        .join(',');
      return [
        guardado.voz_id || '',
        japonesDe(id) || '',
        muestras,
        abiertos.has(id) ? 'abierto' : '',
        generoElegido.get(id) || '',
        recados.has(id) ? 'recado' : '',
      ].join('|');
    }

    /** Repinta la tarjeta de un personaje, esté donde esté. */
    function refrescar(id) {
      const antes = nodos.get(id);
      if (!antes || !antes.isConnected) return;

      const fichas = repartoDeLaSerie();
      const posicion = fichas.findIndex((f) => String(f.personaje) === id);
      if (posicion < 0) return;

      const nuevo = pintarPersonaje(fichas[posicion], posicion < CUANTOS_MANDAN);
      antes.replaceWith(nuevo);
    }

    /**
     * Alguien ha escrito el estado —esta pantalla o la cola—: se repinta solo lo
     * que de verdad haya cambiado, y se piden las firmas de lo que haya
     * aparecido nuevo.
     */
    function repintarLoQueHayaCambiado() {
      for (const ficha of repartoDeLaSerie()) {
        const id = String(ficha.personaje);
        if (!nodos.has(id)) continue;
        if (firmas.get(id) !== firmaDe(id)) refrescar(id);
      }
      asegurarUrls().catch(() => {
        // Sin enlace no se puede oír lo viejo, pero se puede volver a generar y
        // la tarjeta lo dice sola: no hace falta un aviso encima.
      });
    }

    // -----------------------------------------------------------------------
    // Los datos de la serie y del guion
    // -----------------------------------------------------------------------

    /** El reparto tal como está escrito: ya viene ordenado por volumen. */
    function repartoDeLaSerie() {
      const voces = serie && serie.voces ? serie.voces : null;
      const reparto = voces && Array.isArray(voces.reparto) ? voces.reparto : [];
      return reparto.filter((f) => f && typeof f === 'object' && f.personaje);
    }

    /**
     * La frase que van a decir las candidatas, y de dónde sale.
     *
     * Tres casos, en este orden y sin inventar nunca nada:
     *   · la que está escrita en `voces.reparto[].muestra`, que es la única que
     *     se puede oír: la muestra la compone la función desde ahí;
     *   · si no la hay, su línea más difícil disponible en los guiones, que se
     *     enseña como contexto y dice qué hay que escribir para poder oírla;
     *   · y si tampoco hay ninguna, «sin frase de muestra», y ahí se queda.
     *
     * `sePuedeOir` es lo que separa el primer caso de los otros dos, y es lo que
     * decide si el botón de probar voces existe o está apagado con su motivo.
     *
     * @param {object} ficha
     * @returns {object}
     */
    function muestraDe(ficha) {
      const escrita = ficha.muestra && typeof ficha.muestra === 'object' ? ficha.muestra : null;
      const texto = escrita && typeof escrita.texto === 'string' ? escrita.texto.trim() : '';

      if (texto) {
        return {
          texto,
          intencion: typeof escrita.intencion === 'string' ? escrita.intencion.trim() : null,
          de: escrita.ep != null && escrita.escena != null
            ? `Episodio ${escrita.ep}, escena ${escrita.escena}.`
            : null,
          porque: null,
          prestada: false,
          sePuedeOir: true,
          ep: escrita.ep ?? null,
          escena: escrita.escena ?? null,
          porQueNoSePuede: null,
        };
      }

      const delGuion = lineaMasDificil(String(ficha.personaje));

      if (delGuion) {
        return {
          texto: delGuion.texto,
          intencion: delGuion.intencion,
          de: `Episodio ${delGuion.ep}, escena ${delGuion.escena}.`,
          porque: delGuion.porque,
          prestada: true,
          sePuedeOir: false,
          ep: delGuion.ep,
          escena: delGuion.escena,
          porQueNoSePuede:
            'No tiene frase de muestra escrita en datos/serie.json, y la muestra la compone la ' +
            'función desde ahí: el navegador manda un id, no un texto. Copia la línea de abajo a ' +
            'su entrada de «voces.reparto» y podrá elegírsele voz.',
        };
      }

      if (!guiones || guiones.fallo) {
        return {
          texto: null,
          intencion: null,
          de: null,
          porque: null,
          prestada: false,
          sePuedeOir: false,
          porQueNoSePuede: guiones
            ? 'No tiene frase de muestra escrita en datos/serie.json y los guiones no se han podido ' +
              'leer, así que no hay de dónde sacar una. Nunca se inventa.'
            : 'No tiene frase de muestra escrita en datos/serie.json. Se está buscando su línea más ' +
              'difícil en los guiones…',
        };
      }

      return {
        texto: null,
        intencion: null,
        de: null,
        porque: null,
        prestada: false,
        sePuedeOir: false,
        porQueNoSePuede:
          'Sin frase de muestra: no la tiene escrita en datos/serie.json y en los guiones no habla ' +
          'ni una vez. No se le puede elegir voz escuchando, y una frase inventada no sirve para ' +
          'juzgar nada. Si de verdad tiene que hablar, se le escribe la suya en «voces.reparto».',
      };
    }

    /**
     * La línea más difícil que tiene un personaje en los guiones, con el criterio
     * dicho en pantalla para que se pueda discutir:
     *
     *   1. la que el guion marca de riesgo alto, que son las diez que ningún TTS
     *      lleva bien y por tanto las que más hay que oír antes de decidir;
     *   2. si no hay ninguna, la que lleva la intención más detallada, que es la
     *      que más le pide a la voz;
     *   3. a igualdad, la más larga.
     *
     * @param {string} id
     * @returns {{texto:string, intencion:string|null, ep:number|string, escena:string, porque:string}|null}
     */
    function lineaMasDificil(id) {
      if (!guiones || guiones.fallo || !Array.isArray(guiones.guiones)) return null;

      let mejor = null;
      let mejorNota = -1;
      let cuantas = 0;
      let deRiesgo = 0;

      for (const episodio of guiones.guiones) {
        if (!episodio || !Array.isArray(episodio.escenas)) continue;
        for (const escena of episodio.escenas) {
          if (!escena || !Array.isArray(escena.dialogo)) continue;
          for (const linea of escena.dialogo) {
            if (!linea || linea.quien !== id) continue;
            const texto = typeof linea.texto === 'string' ? linea.texto.trim() : '';
            if (!texto) continue;

            cuantas += 1;
            const riesgo = String(linea.riesgo || '').trim().toLowerCase() === 'alto';
            if (riesgo) deRiesgo += 1;

            const intencion = typeof linea.intencion === 'string' ? linea.intencion.trim() : '';
            const nota = (riesgo ? 100000 : 0) + intencion.length * 100 + texto.length;

            if (nota > mejorNota) {
              mejorNota = nota;
              mejor = {
                texto,
                intencion: intencion || null,
                ep: episodio.episodio,
                escena: String(escena.escena),
                riesgo,
              };
            }
          }
        }
      }

      if (!mejor) return null;

      mejor.porque = mejor.riesgo
        ? (deRiesgo === 1
            ? 'Elegida por ser su única línea marcada de riesgo alto en el guion.'
            : `Elegida por ser una de sus ${deRiesgo} líneas marcadas de riesgo alto en el guion.`)
        : `Elegida por ser, de sus ${cuantas === 1 ? 'única línea' : `${cuantas} líneas`}, la que ` +
          'lleva la intención más detallada.';
      return mejor;
    }

    /** Cómo se llama a un personaje en pantalla: como lo llama el guion. */
    function nombreEnPantalla(id) {
      const delGuion = etiquetaDelGuion(id);
      if (delGuion) return delGuion;
      return primeraMayuscula(String(id).replace(/-/g, ' '));
    }

    /**
     * La etiqueta con la que el guion nombra a un personaje, que es su nombre de
     * verdad («LORD IVEN», «MUJER MAYOR»). Se coge la que más veces aparece: hay
     * personajes que en algún momento se llaman de otra forma —«SAHARIS (NIÑO)»—
     * y esa no es su etiqueta, es un momento suyo.
     * @param {string} id
     * @returns {string|null}
     */
    function etiquetaDelGuion(id) {
      if (etiquetas.size) return etiquetas.get(id) || null;
      if (!guiones || guiones.fallo || !Array.isArray(guiones.guiones)) return null;

      const cuenta = new Map();
      for (const episodio of guiones.guiones) {
        if (!episodio || !Array.isArray(episodio.escenas)) continue;
        for (const escena of episodio.escenas) {
          if (!escena || !Array.isArray(escena.dialogo)) continue;
          for (const linea of escena.dialogo) {
            if (!linea || !linea.quien || typeof linea.etiqueta !== 'string') continue;
            const quien = String(linea.quien);
            if (!cuenta.has(quien)) cuenta.set(quien, new Map());
            const suyas = cuenta.get(quien);
            suyas.set(linea.etiqueta, (suyas.get(linea.etiqueta) || 0) + 1);
          }
        }
      }

      for (const [quien, suyas] of cuenta) {
        let nombre = null;
        let veces = -1;
        for (const [etiqueta, cuantas] of suyas) {
          if (cuantas > veces) {
            veces = cuantas;
            nombre = etiqueta;
          }
        }
        // El guion las escribe en mayúsculas —«LORD IVEN»— porque así se escriben
        // los guiones, pero un renglón entero en mayúsculas en un teléfono no se
        // lee: se pasa a capitalizado y ya.
        if (nombre) etiquetas.set(quien, titular(nombre.toLowerCase()));
      }

      return etiquetas.get(id) || null;
    }

    /** Los géneros que trae la lista de voces, para el filtro. */
    function generosDisponibles() {
      const vistos = [];
      for (const voz of candidatas) {
        const genero = generoDe(voz);
        if (!vistos.includes(genero)) vistos.push(genero);
      }
      return vistos;
    }

    /** Un aviso a partir de un fallo cualquiera. */
    function avisoDeFallo(fallo) {
      return aviso(
        fallo && fallo.mensaje ? fallo.mensaje : 'No se ha podido abrir el reparto de voces.',
        { tono: 'error', detalle: fallo && fallo.detalle ? fallo.detalle : loQueDijo(fallo) },
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Los dos archivos de datos, del lado del navegador
// ---------------------------------------------------------------------------

// El reparto, las frases de muestra y los guiones son datos de la serie, no
// credenciales ni ids de modelo: van en el repositorio y se sirven tal cual, así
// que se bajan directamente en vez de gastar una llamada a la función.
//
// FALTA EN EL CONTRATO: docs/contrato.md §12 no da ningún módulo de datos para el
// navegador, y `app/cola.js` ya baja datos/serie.json por su cuenta con este
// mismo apaño. Lo suyo sería un `app/datos.js` compartido; se deja dicho aquí
// para que se revise y no se multiplique por tercera vez.

/**
 * Baja `datos/serie.json`.
 * @returns {Promise<object>}
 */
function bajarLaSerie() {
  // Sin caché: después de desglosar un episodio, serie.json trae piezas nuevas.
  return bajarJson('../../datos/serie.json', 'no-cache',
    'datos/serie.json, que es donde está escrito el reparto de voces y la frase de muestra de cada ' +
    'personaje');
}

/**
 * Baja `datos/guiones.json`. Solo hace falta para dos cosas: llamar a cada
 * personaje como lo llama el guion y encontrar la línea más difícil de quien no
 * tiene frase de muestra escrita.
 * @returns {Promise<object>}
 */
function bajarLosGuiones() {
  // Con caché: los guiones son material humano y no cambian mientras se trabaja,
  // y son el archivo más grande de los dos.
  return bajarJson('../../datos/guiones.json', 'default',
    'datos/guiones.json, que es donde están los diálogos de la serie');
}

/**
 * @param {string} relativa
 * @param {RequestCache} cache
 * @param {string} queEs cómo se nombra el archivo en los mensajes de fallo
 * @returns {Promise<object>}
 */
async function bajarJson(relativa, cache, queEs) {
  const direccion = new URL(relativa, import.meta.url).href;

  let respuesta;
  try {
    respuesta = await fetch(direccion, { cache });
  } catch (fallo) {
    throw hecho(
      `No se ha podido leer ${queEs}. Comprueba la conexión del teléfono; si tienes cobertura, es ` +
      'que el despliegue está a medias.',
      loQueDijo(fallo),
    );
  }

  if (!respuesta.ok) {
    throw hecho(
      `No se ha podido leer ${queEs}: el servidor ha contestado con un ${respuesta.status}. Ese ` +
      'archivo va dentro del repositorio, así que si no está es que el despliegue no ha subido ' +
      'entero.',
      `HTTP ${respuesta.status}`,
    );
  }

  try {
    return await respuesta.json();
  } catch (fallo) {
    throw hecho(
      `Se ha bajado ${queEs} pero no se entiende: no es un JSON válido. Es un fallo del propio ` +
      'estudio, no de tu cuenta.',
      loQueDijo(fallo),
    );
  }
}

/**
 * Un fallo con la misma forma que los de `app/api.js`: mensaje en español listo
 * para pintarse y el detalle debajo.
 * @param {string} mensaje
 * @param {string|null} detalle
 * @returns {Error & {mensaje:string, detalle:string|null}}
 */
function hecho(mensaje, detalle) {
  const fallo = new Error(mensaje);
  fallo.mensaje = mensaje;
  fallo.detalle = detalle || null;
  return fallo;
}

// ---------------------------------------------------------------------------
// Piezas sueltas
// ---------------------------------------------------------------------------

/**
 * El `<audio controls>` de una muestra. Va suelto, sin envolver, para que la
 * tarjeta lo reconozca como audio y no le ponga el marco de 16:9 de las
 * imágenes.
 *
 * `preload` va en «none» a propósito: en un teléfono, treinta candidatas
 * pidiendo cabecera a la vez es lo que hace que la pantalla parezca colgada. Y
 * si el enlace ha caducado —seis horas— se dice en la nota que se le pasa, con
 * palabras y sin alarmar: lo generado sigue guardado y no hay que pagarlo otra
 * vez.
 *
 * @param {string} url
 * @param {string} queEs
 * @param {HTMLElement} nota dónde escribir si el enlace ya no sirve
 * @returns {HTMLElement}
 */
function reproductor(url, queEs, nota) {
  return h('audio', {
    controls: true,
    preload: 'none',
    src: url,
    'aria-label': queEs,
    estilo: { width: '100%' },
    alError: () => {
      nota.textContent =
        'Este enlace ya no sirve: las URL firmadas caducan a las seis horas. Sal de la pantalla y ' +
        'vuelve a entrar para pedir enlaces nuevos; la muestra sigue guardada, no hay que pagarla ' +
        'otra vez.';
    },
  });
}

/**
 * El nombre corto de una voz: el último tramo de su id, que es como la llama
 * Google —«idioma-familia-Nombre» → «Nombre»—. Se recorta solo cuando ese
 * último tramo tiene forma de nombre; si no, se enseña el id entero, porque
 * inventarse el nombre de una voz sería peor que enseñar un id largo.
 * @param {string} vozId
 * @returns {string}
 */
function nombreCortoDeVoz(vozId) {
  const id = String(vozId ?? '').trim();
  const partes = id.split('-');
  const ultima = partes[partes.length - 1];
  return partes.length > 2 && ultima && ultima.length >= 3 ? ultima : (id || 'sin id');
}

/** El género tal como lo dice la API, o que no lo dice. */
function generoDe(voz) {
  const dicho = voz && typeof voz.genero === 'string' ? voz.genero.trim() : '';
  return dicho || 'sin especificar';
}

/**
 * El porcentaje de diálogo, tal como está escrito en el reparto y con la coma
 * decimal del español: 37.7 → «37,7 %». No se recalcula: es el dato, y el espacio
 * antes del signo es duro, como en app/formato.js, para que no se parta al final
 * de una línea.
 * @param {number} valor
 * @returns {string}
 */
function escribirPorcentaje(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return 'sin porcentaje';
  const fijado = numero.toFixed(1).replace(/\.0$/, '').replace('.', ',');
  return `${fijado} %`;
}

/**
 * Los episodios en los que habla, agrupando los seguidos: [1,2,3,7] → «episodios
 * 1 a 3 y 7». Con doce episodios y veintinueve personajes, la lista suelta ocupa
 * más que todo lo demás de la tarjeta.
 *
 * @param {number[]} lista
 * @returns {string}
 */
function episodiosEnTexto(lista) {
  const numeros = (Array.isArray(lista) ? lista : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (!numeros.length) return 'sin episodios apuntados';

  const tramos = [];
  let desde = numeros[0];
  let hasta = numeros[0];

  for (let i = 1; i < numeros.length; i += 1) {
    if (numeros[i] === hasta + 1) {
      hasta = numeros[i];
      continue;
    }
    tramos.push(desde === hasta ? String(desde) : `${desde} a ${hasta}`);
    desde = numeros[i];
    hasta = numeros[i];
  }
  tramos.push(desde === hasta ? String(desde) : `${desde} a ${hasta}`);

  const cuerpo = tramos.length === 1
    ? tramos[0]
    : `${tramos.slice(0, -1).join(', ')} y ${tramos[tramos.length - 1]}`;

  return numeros.length === 1 ? `episodio ${cuerpo}` : `episodios ${cuerpo}`;
}

/**
 * Copia al portapapeles y lo dice en el propio botón. Si el navegador no deja,
 * se marca el texto para poder copiarlo con el dedo.
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
    try {
      const rango = document.createRange();
      rango.selectNodeContents(caja);
      const seleccion = window.getSelection();
      seleccion.removeAllRanges();
      seleccion.addRange(rango);
    } catch {
      // Si tampoco se puede marcar, el texto sigue ahí para copiarlo a mano.
    }
    elBoton.textContent = 'Ya está marcado: cópialo tú';
  }
  setTimeout(() => {
    elBoton.textContent = antes;
  }, 2500);
}

/** Primera letra en mayúscula, el resto tal cual. */
function primeraMayuscula(texto) {
  const t = String(texto || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

/** Cada palabra con su inicial en mayúscula: «lord iven» → «Lord Iven». */
function titular(texto) {
  return String(texto || '')
    .trim()
    .split(/\s+/)
    .map((palabra) => primeraMayuscula(palabra))
    .join(' ');
}

/** Lo que dijo un fallo del navegador, literal, para el detalle. */
function loQueDijo(fallo) {
  if (!fallo) return null;
  if (typeof fallo === 'string') return fallo;
  if (fallo.message) return String(fallo.message);
  return String(fallo);
}

/**
 * El género de un personaje, de datos/serie.json.
 *
 * El parche de datos lo deduce de la primera línea de su identidad —«young
 * woman», «man of fifty», «girl of twelve»— porque es donde está el sujeto. Un
 * figurante que no esté en la ficha no filtra nada: más vale enseñar de más que
 * esconder la voz buena.
 */
function generoDelPersonaje(serie, id) {
  const fichas = serie && typeof serie.personajes === 'object' ? serie.personajes : null;
  const ficha = fichas ? fichas[id] : null;
  const genero = ficha && typeof ficha.genero === 'string' ? ficha.genero.trim() : '';
  return genero && genero !== 'sin decidir' ? genero : null;
}
