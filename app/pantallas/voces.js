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
// DE DÓNDE SALE LA FRASE DE MUESTRA. De `voces.reparto[].muestra`, siempre. A
// dieciocho personajes se la escribieron a mano; a los otros once —figurantes de
// dos o tres líneas— se la saca del guion `npm run datos`, con su línea más
// difícil: la marcada de riesgo alto, y si no hay ninguna, la de intención más
// detallada. Esos llevan `del_guion: true` y su motivo, y aquí se dice en
// pantalla, porque oír una línea elegida por una regla no es lo mismo que oír la
// que alguien escogió a mano. Pero se oye igual: no hay nada que pegar en ningún
// archivo. Lo que no se hace jamás es inventar una frase: quien no habla ni una
// vez en los guiones se queda sin muestra y se dice con esas palabras.

import { llamar } from '../api.js';
import { actual, alCambiar, cambiar } from '../estado.js';
import { encolar, comoVa, cuantosPorDelante } from '../cola.js';
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
    /**
     * Las que se acaban de pulsar y la cola todavía no ha visto: «personaje|voz».
     *
     * Es solo el hueco entre pulsar el botón y que la cola tenga el trabajo
     * escrito en el bucket, medio segundo. Quien manda es la cola —esto se borra
     * en cuanto ella lo sabe— pero sin esta marca ese medio segundo es un botón
     * que no reacciona, y un botón que no reacciona se vuelve a pulsar.
     */
    const pedidas = new Set();
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
        pintarLosChoquesQueYaHay(),
        h('p', { clase: 'tenue' },
          'La voz elegida se guarda en el estado, en el bucket, y es la que dirá todas las líneas ' +
          'de ese personaje. El timbre no deriva entre llamadas: es la voz elegida. Lo que sí ' +
          'cambia de una llamada a otra es la entrega, y contra eso lo que se hace es generar cada ' +
          'escena de una sola vez, no línea a línea.'));
    }

    /**
     * Los timbres repetidos que YA están guardados y no deberían estarlo.
     *
     * POR QUÉ HACE FALTA ENSEÑARLOS. El servidor solo rechaza los cambios que
     * EMPEORAN el reparto, no los que arrastran un choque de antes; si no fuera
     * así, un choque ya guardado dejaría a la Cola, a Audio y a Montaje sin poder
     * guardar nada, y con dos no habría forma de deshacerlo desde aquí. Pero eso
     * quiere decir que un choque heredado se queda ahí, callado, hasta que se
     * monte el episodio y dos personajes suenen igual. Así que se dice arriba, la
     * primera vez que se abre la pantalla, con los nombres.
     *
     * Es un caso de verdad: hasta que se puso esta regla, esta misma pantalla
     * ofrecía a todos las treinta voces.
     *
     * @returns {HTMLElement|null}
     */
    function pintarLosChoquesQueYaHay() {
      // No se usa `duenosDeLasVoces()`: ese mapa se queda con UN personaje por
      // voz, y aquí lo que hace falta es justo lo contrario —todos los que
      // tienen cada voz—, que es donde se ven los choques.
      const estado = elEstado();
      const deCadaVoz = new Map();
      for (const [personaje, dentro] of Object.entries((estado && estado.voces) || {})) {
        if (!dentro || typeof dentro !== 'object') continue;
        const vozId = typeof dentro.voz_id === 'string' ? dentro.voz_id.trim() : '';
        if (!vozId) continue;
        if (!deCadaVoz.has(vozId)) deCadaVoz.set(vozId, []);
        deCadaVoz.get(vozId).push(personaje);
      }

      const choques = [];
      for (const [vozId, quienes] of deCadaVoz) {
        for (let i = 0; i < quienes.length; i += 1) {
          for (let j = i + 1; j < quienes.length; j += 1) {
            if (puedenCompartir(quienes[i], quienes[j])) continue;
            choques.push(
              `${nombreCortoDeVoz(vozId)}: ${nombreEnPantalla(quienes[i])} y ` +
              `${nombreEnPantalla(quienes[j])}`,
            );
          }
        }
      }

      if (!choques.length) return null;

      return aviso(
        `${choques.length === 1 ? 'Hay un timbre repetido' : `Hay ${choques.length} timbres repetidos`} ` +
        'entre personajes que no pueden compartirlo, de antes de que existiera esta regla: ' +
        `${choques.join('; ')}. Se dejan guardados a propósito —bloquearlos dejaría a la Cola y a ` +
        'Audio sin poder guardar nada— pero hay que deshacerlos antes de grabar: al montar el ' +
        'episodio esos dos van a sonar igual. En la tarjeta de uno de los dos, «Cambiar la voz ' +
        'elegida».',
        { tono: 'error' },
      );
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
          : null);
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

      // LAS QUE YA SON DE OTRO NO SE OFRECEN, salvo que compartir con ese otro
      // sea legal: los de una o dos líneas que no salen juntos en ninguna escena
      // sí pueden repetir timbre, y sin eso los números no darían —con el género
      // bien puesto hay 21 personajes masculinos y 16 voces masculinas—.
      //
      // Las que no se ofrecen no desaparecen sin más, que dejaría buscando una
      // voz que se oyó ayer: se dicen abajo, con el nombre de quien la tiene,
      // que es a donde hay que ir a recuperarla.
      //
      // El mapa se arma UNA vez para toda la tarjeta. Preguntarlo voz a voz lo
      // reconstruía treinta veces por personaje, y en un teléfono con
      // veintinueve tarjetas eso se nota al desplazar.
      const dueno = duenosDeLasVoces();
      const deOtro = (voz) => {
        const suyo = dueno.get(voz.id);
        if (!suyo || suyo === id) return null;
        return puedenCompartir(id, suyo) ? null : suyo;
      };

      /** Con quién se compartiría esta voz, cuando compartir sí está permitido. */
      const compartidaCon = (voz) => {
        const suyo = dueno.get(voz.id);
        return suyo && suyo !== id && puedenCompartir(id, suyo) ? suyo : null;
      };

      const deSuGenero = puesto === 'todos'
        ? candidatas
        : candidatas.filter((v) => generoDe(v) === puesto);
      const lista = deSuGenero.filter((v) => !deOtro(v));
      const tomadas = deSuGenero.filter((v) => deOtro(v));

      /** Cuántas quedan libres de un género, contando las de todo el catálogo. */
      const libresDe = (g) =>
        candidatas.filter((v) => (g === 'todos' || generoDe(v) === g) && !deOtro(v)).length;

      const panel = h('div', { estilo: { 'margin-top': '12px' } },
        h('p', { clase: 'tenue', estilo: { margin: '0 0 8px', 'font-size': '13px' } },
          `Cada muestra es una llamada de voz que dice esa misma frase con esa misma intención. ` +
          'Genera las que quieras comparar, escúchalas seguidas y elige. Lo generado se guarda: ' +
          'volver a entrar aquí no lo paga otra vez.'),
        generos.length > 1
          ? filtro(
              // La cuenta de cada pastilla es la de las que QUEDAN, no la del
              // catálogo: enseñar «16» cuando solo hay 4 elegibles es mentir.
              [{ id: 'todos', texto: 'Todas', cuenta: libresDe('todos') }].concat(
                generos.map((g) => ({ id: g, texto: primeraMayuscula(g), cuenta: libresDe(g) })),
              ),
              puesto,
              (valor) => {
                generoElegido.set(id, valor);
                refrescar(id);
              },
            )
          : null);

      if (!lista.length) {
        panel.appendChild(h('p', { estilo: { margin: '8px 0 0' } },
          tomadas.length
            ? 'No queda ninguna voz libre con este filtro: las ' +
              `${tomadas.length === 1 ? 'que había ya es' : `${tomadas.length} que había ya son`} ` +
              'de otros personajes. Quita el filtro para ver las del otro género, o ve a la ' +
              'tarjeta de quien tiene la que quieres y dale a «Cambiar la voz elegida».'
            : 'Ninguna voz de la lista tiene ese género declarado. Quita el filtro para verlas todas.'));
        if (tomadas.length) panel.appendChild(pintarLasTomadas(tomadas, dueno));
        return panel;
      }

      const rejilla = h('div', { clase: 'rejilla', estilo: { 'margin-top': '10px' } });
      // Las libres del todo primero y las que se repetirían después: si hay una
      // voz que no suena en ningún otro sitio, es la que hay que oír antes.
      const ordenadas = lista.slice().sort((a, b) =>
        (compartidaCon(a) ? 1 : 0) - (compartidaCon(b) ? 1 : 0));
      for (const voz of ordenadas) {
        rejilla.appendChild(pintarCandidata(ficha, voz, compartidaCon(voz)));
      }
      panel.appendChild(rejilla);

      if (tomadas.length) panel.appendChild(pintarLasTomadas(tomadas, dueno));

      // El aviso de que se está acabando el margen. Son 30 voces y 29
      // personajes: no sobra casi nada, y enterarse con la última es tarde.
      const quedan = libresDe('todos');
      if (quedan <= 3) {
        panel.appendChild(h('p', { estilo: { margin: '10px 0 0', 'font-size': '13px' } },
          `Quedan ${quedan === 1 ? 'una sola voz libre' : `${quedan} voces libres`} en todo el ` +
          'catálogo para los personajes que aún no tienen. Si hace falta una para alguien que ' +
          'habla más, se recupera con «Cambiar la voz elegida» en la tarjeta de quien la tenga.'));
      }

      return panel;
    }

    /**
     * Las voces que no se ofrecen porque ya son de otro, con el nombre de quien
     * las tiene. Es lo que convierte «esta voz ha desaparecido» en «esta voz es
     * de la Madre, y si la quieres aquí, se la quitas allí».
     *
     * @param {object[]} tomadas
     * @param {Map<string,string>} dueno voz → personaje
     * @returns {HTMLElement}
     */
    function pintarLasTomadas(tomadas, dueno) {
      const dichas = tomadas
        .map((v) => `${nombreCortoDeVoz(v.id)} (${nombreEnPantalla(dueno.get(v.id))})`)
        .join(', ');

      return h('div', { estilo: { 'margin-top': '10px' } },
        h('p', { clase: 'tenue', estilo: { margin: '0', 'font-size': '13px' } },
          `${tomadas.length === 1 ? 'Una voz no se ofrece' : `${tomadas.length} voces no se ofrecen`} ` +
          'porque ya están fijadas en otro personaje que no puede compartir timbre con este: ',
          h('span', { clase: 'mono' }, dichas), '. ' +
          'Solo repiten voz los que dicen una o dos líneas en toda la serie y además no salen ' +
          'juntos en ninguna escena; a los demás se les reconoce, y eso no se arregla después sin ' +
          'volver a grabar. Para recuperar una, ve a la tarjeta de quien la tiene y dale a ' +
          '«Cambiar la voz elegida».'));
    }

    /**
     * Una candidata: su tarjeta, su reproductor de verdad y sus dos botones.
     * @param {object} ficha
     * @param {{id:string, genero:string}} voz
     * @returns {HTMLElement}
     */
    function pintarCandidata(ficha, voz, conQuienSeComparte = null) {
      const id = String(ficha.personaje);
      const clave = `${id}|${voz.id}`;
      const oible = muestraOible(id, voz.id);
      const enLaCola = comoVaLaMuestra(id, voz.id);
      const trabajando = Boolean(enLaCola);
      const dura = duraciones.get(clave);
      const nota = h('p', { clase: 'tenue', estilo: { margin: '4px 0 0', 'font-size': '12px' } });

      const acciones = [];

      if (trabajando) {
        // Se dice si está sonando ya o si está haciendo cola, y cuántos van
        // delante. Con una generación a la vez, «esperando» es el estado normal
        // y no decir cuánto queda invita a pulsar otra vez.
        const esperando = enLaCola.estado === 'pendiente';
        const sola = esperando && enLaCola.porDelante === 0;
        acciones.push(boton(esperando ? (sola ? 'Pedida…' : 'En la cola…') : 'Generando…', () => {}, {
          desactivado: esperando
            ? (sola
                ? 'Ya está pedida y no hay nada por delante: empieza en cuanto la cola la coja. ' +
                  'Si se queda aquí más de un minuto, mira la pantalla de Cola: puede haber algo ' +
                  'atascado ocupando el único hueco.'
                : `Esperando turno: van ${enLaCola.porDelante} por delante. Se genera una cosa ` +
                  'cada vez, y esta cuenta tiene las cuotas cortas: pedir varias a la vez las ' +
                  'tumba todas.')
            : 'Ya se está generando esta muestra. Se paga una vez.',
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
          // Se dice ANTES de elegirla, no después: quien la fije tiene que saber
          // que ese timbre ya suena en otro sitio de la serie, aunque aquí esté
          // permitido porque los dos dicen dos líneas y no coinciden nunca.
          conQuienSeComparte
            ? h('p', { clase: 'tenue', estilo: { margin: '4px 0 0', 'font-size': '12px' } },
                `Ya es la voz de ${nombreEnPantalla(conQuienSeComparte)}. Se puede repetir aquí ` +
                'porque los dos dicen una o dos líneas y no salen juntos en ninguna escena, así ' +
                'que nadie los va a tener los dos en la cabeza a la vez.')
            : null,
          // Lo que se dice depende de si de verdad hay alguien delante. «Esperando
          // su turno» cuando es la primera y la única no es un matiz: es mentira,
          // y deja mirando una pantalla que parece colgada.
          trabajando
            ? espera(
                enLaCola.estado !== 'pendiente'
                  ? 'Diciendo la frase con esta voz…'
                  : enLaCola.porDelante === 0
                    ? 'Pedida. Empieza en cuanto la cola la coja…'
                    : `Esperando turno: ${enLaCola.porDelante} por delante…`,
              )
            : null),
        acciones,
      });
    }

    // -----------------------------------------------------------------------
    // Acciones
    // -----------------------------------------------------------------------

    /**
     * PIDE la muestra de un personaje con una voz candidata: la mete en la cola
     * y vuelve. La frase, la intención y la traducción las pone la función; desde
     * aquí solo van dos ids.
     *
     * POR QUÉ POR LA COLA Y NO DIRECTA. Antes esto llamaba a `voz-muestra` en el
     * acto. Pulsar «Oír esta voz» en tres candidatas disparaba tres llamadas a la
     * vez, y cada una lleva dentro una traducción al japonés, que es otra llamada
     * más: seis peticiones a Vertex en el mismo segundo. Lo que volvía era un 429
     * de cuota que en pantalla se lee como falta de acceso al modelo. Con la cola
     * se pide una, y hasta que no termina no empieza la siguiente.
     *
     * @param {object} ficha
     * @param {{id:string}} voz
     * @returns {void}
     */
    function generarMuestra(ficha, voz) {
      const id = String(ficha.personaje);
      recados.delete(id);

      // SE MARCA ANTES DE ENCOLAR, no después. Encolar escribe en el bucket y
      // eso tarda medio segundo; hasta que no termina, la cola todavía no sabe
      // nada de este trabajo y la tarjeta se repintaría igual que estaba. Medio
      // segundo de botón que no reacciona es medio segundo pulsándolo otra vez,
      // y cada pulsación de más es una muestra de más pagada.
      pedidas.add(`${id}|${voz.id}`);

      try {
        encolar('muestra', { personaje: id, voz_id: voz.id });
      } catch (fallo) {
        pedidas.delete(`${id}|${voz.id}`);
        recados.set(id, {
          tono: 'error',
          mensaje: fallo && fallo.mensaje ? fallo.mensaje : 'No se ha podido pedir la muestra.',
          detalle: fallo && fallo.detalle ? fallo.detalle : null,
        });
      }

      if (vivo) refrescar(id);
    }

    /**
     * Cómo va la muestra de esta voz para este personaje: si está esperando su
     * turno, si se está generando ahora mismo, o si falló.
     *
     * Se pregunta a la cola y no a una variable de esta pantalla, porque la cola
     * vive en el bucket: al recargar la página, o al abrirla en otro sitio, se
     * sigue viendo lo mismo.
     *
     * @param {string} id
     * @param {string} vozId
     * @returns {{estado:string, porDelante:number}|null}
     */
    function comoVaLaMuestra(id, vozId) {
      const args = { personaje: id, voz_id: vozId };
      const estado = comoVa('muestra', args);

      if (estado === 'pendiente' || estado === 'en_curso') {
        // Ya la conoce la cola: manda ella, y se puede soltar la marca local.
        pedidas.delete(`${id}|${vozId}`);
        return { estado, porDelante: cuantosPorDelante('muestra', args) };
      }

      // La cola todavía no la ha visto —se está escribiendo en el bucket— pero
      // el botón ya se pulsó. Se dice, para que la tarjeta reaccione en el acto.
      if (pedidas.has(`${id}|${vozId}`)) {
        // Salvo que ya esté terminada: entonces la marca sobra y estorba.
        if (estado === 'hecho' || estado === 'fallido') {
          pedidas.delete(`${id}|${vozId}`);
          return null;
        }
        return { estado: 'pendiente', porDelante: 0 };
      }

      return null;
    }

    /**
     * Fija la voz de un personaje. Se pregunta antes porque es la decisión que
     * no se vuelve a tocar.
     * @param {string} id
     * @param {string} vozId
     * @returns {Promise<void>}
     */
    async function elegirLaVoz(id, vozId) {
      try {
        await elegirLaVozDeVerdad(id, vozId);
      } catch (fallo) {
        // Hasta la confirmación puede fallar, y estaba fuera del try: cualquier
        // fallo de aquí se escapaba como promesa sin recoger y salía como «algo
        // se ha roto y nadie lo ha recogido», sin decir dónde.
        recados.set(id, {
          tono: 'error',
          mensaje: fallo && fallo.mensaje ? fallo.mensaje : 'No se ha podido fijar la voz.',
          detalle: fallo && fallo.detalle ? fallo.detalle : null,
        });
        if (vivo) refrescar(id);
      }
    }

    async function elegirLaVozDeVerdad(id, vozId) {
      const seguro = await confirmar(
        `¿Fijar ${nombreCortoDeVoz(vozId)} como la voz de ${nombreEnPantalla(id)}? Dirá todas sus ` +
        'líneas en toda la serie.',
      );
      if (!seguro || !vivo) return;

      // Se vuelve a mirar DESPUÉS de confirmar. Entre que se abrió el panel y se
      // dijo que sí puede haber pasado un rato, y en otra pestaña —o en otro
      // móvil— puede haberse fijado esta misma voz. El panel de al lado no se
      // entera solo.
      const otro = yaEsDeOtro(vozId, id);
      if (otro && !puedenCompartir(id, otro)) {
        recados.set(id, {
          tono: 'error',
          mensaje:
            `${nombreCortoDeVoz(vozId)} ya es la voz de ${nombreEnPantalla(otro)}. Se ha fijado ` +
            'mientras este panel estaba abierto, y esos dos no pueden compartir timbre: elige ' +
            `otra, o ve a la tarjeta de ${nombreEnPantalla(otro)} y dale a «Cambiar la voz ` +
            'elegida».',
          detalle: null,
        });
        refrescar(id);
        return;
      }

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
      try {
        await cambiarLaVozDeVerdad(id);
      } catch (fallo) {
        recados.set(id, {
          tono: 'error',
          mensaje: fallo && fallo.mensaje ? fallo.mensaje : 'No se ha podido cambiar la voz.',
          detalle: fallo && fallo.detalle ? fallo.detalle : null,
        });
        if (vivo) refrescar(id);
      }
    }

    async function cambiarLaVozDeVerdad(id) {
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

    /**
     * De quién es ya cada voz: `voz_id → personaje`. Una voz por personaje y un
     * personaje por voz.
     *
     * POR QUÉ NO SE COMPARTE UNA VOZ. Dos personajes con el mismo timbre son el
     * mismo personaje para el oído, por mucho que el guion los llame distinto. En
     * una serie de doce capítulos eso no se arregla después: habría que rehacer
     * todo lo grabado del segundo. Así que en cuanto una voz queda fijada, deja
     * de ofrecerse a los demás.
     *
     * @returns {Map<string, string>}
     */
    function duenosDeLasVoces() {
      const voces = elEstado().voces;
      const salida = new Map();
      if (!voces || typeof voces !== 'object') return salida;
      for (const [personaje, dentro] of Object.entries(voces)) {
        if (!dentro || typeof dentro !== 'object') continue;
        const vozId = typeof dentro.voz_id === 'string' ? dentro.voz_id.trim() : '';
        if (vozId) salida.set(vozId, personaje);
      }
      return salida;
    }

    /**
     * Quién tiene ya esta voz, si no es el propio personaje que pregunta.
     * @param {string} vozId
     * @param {string} salvo el personaje que está eligiendo
     * @returns {string|null} el id del que la tiene, o null si está libre
     */
    function yaEsDeOtro(vozId, salvo) {
      const dueno = duenosDeLasVoces().get(String(vozId ?? '').trim());
      return dueno && dueno !== salvo ? dueno : null;
    }

    /**
     * ¿Pueden dos personajes decir sus líneas con el mismo timbre?
     *
     * Solo si los dos dicen una o dos líneas en toda la serie Y no salen juntos
     * en ninguna escena. Las dos condiciones hacen falta: a quien se oye lo
     * suficiente se le reconoce el timbre aunque nunca coincida con el otro, y
     * dos que coinciden se delatan aunque digan una línea cada uno, porque se
     * oyen seguidos y suena a la misma persona hablando sola.
     *
     * `comparte` y `con` los calcula `npm run datos` desde el guion. Aquí no se
     * cuenta nada: se lee. Y es la MISMA regla que aplica el servidor, así que
     * la pantalla no ofrece nada que después vaya a rechazarse.
     *
     * @param {string} unId
     * @param {string} otroId
     * @returns {boolean}
     */
    function puedenCompartir(unId, otroId) {
      const uno = delReparto(unId);
      const otro = delReparto(otroId);

      // Quien no está en el reparto no comparte: no se sabe cuánto habla ni con
      // quién sale, y ante esa duda manda la regla estricta.
      if (!uno || !otro) return false;
      if (uno.comparte !== true || otro.comparte !== true) return false;

      const conUno = Array.isArray(uno.con) ? uno.con : [];
      const conOtro = Array.isArray(otro.con) ? otro.con : [];
      return !conUno.includes(otroId) && !conOtro.includes(unId);
    }

    /** La entrada del reparto de un personaje, o null. */
    function delReparto(id) {
      const reparto = (serie && serie.voces && serie.voces.reparto) || [];
      return reparto.find((r) => r && r.personaje === id) || null;
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
        // LO QUE ESTÁ EN LA COLA, que faltaba y era el fallo. Sin esto la tarjeta
        // solo se repintaba cuando la muestra ya estaba HECHA y guardada, así que
        // entre pulsar «oír esta voz» y oírla no pasaba nada visible: ni
        // «pedida», ni «generándose», nada. Y una tarjeta que no reacciona
        // invita a volver a pulsar, que es pagar la misma muestra otra vez.
        enLaColaDe(id),
        [...pedidas].filter((clave) => clave.startsWith(`${id}|`)).sort().join(','),
      ].join('|');
    }

    /**
     * Cómo están en la cola las muestras de este personaje, en una cadena corta
     * que cambia en cuanto cambia cualquiera de ellas.
     *
     * Se lee de la cola del bucket y no de una variable de esta pantalla, para
     * que valga igual al recargar la página o con la aplicación abierta en otro
     * sitio.
     *
     * @param {string} id
     * @returns {string}
     */
    function enLaColaDe(id) {
      const estado = elEstado();
      const cola = estado && Array.isArray(estado.cola) ? estado.cola : [];
      const suyas = [];
      for (const trabajo of cola) {
        if (!trabajo || trabajo.tipo !== 'muestra') continue;
        const args = trabajo.args || {};
        if (args.personaje !== id) continue;
        suyas.push(`${args.voz_id}:${trabajo.estado}`);
      }
      return suyas.sort().join(',');
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
        // `del_guion` lo pone el parche cuando la frase no estaba escrita a mano
        // y hubo que sacarla de los guiones. Se dice en pantalla, con el motivo:
        // oír una línea elegida por una regla no es lo mismo que oír la que
        // alguien escogió a mano, y quien elige la voz tiene derecho a saberlo.
        // Pero se oye igual: no hay nada que pegar en ningún archivo.
        const delGuion = escrita.del_guion === true;
        return {
          texto,
          intencion: typeof escrita.intencion === 'string' ? escrita.intencion.trim() : null,
          de: escrita.ep != null && escrita.escena != null
            ? `Episodio ${escrita.ep}, escena ${escrita.escena}.`
            : null,
          porque: delGuion && typeof escrita.porque === 'string' ? escrita.porque : null,
          prestada: delGuion,
          sePuedeOir: true,
          ep: escrita.ep ?? null,
          escena: escrita.escena ?? null,
          porQueNoSePuede: null,
        };
      }

      // RED DE SEGURIDAD, no camino normal. El parche escribe la frase de todo el
      // que habla en los guiones, así que aquí no debería llegar nadie. Si llega
      // —alguien editó serie.json a mano, o el parche no se pasó— se enseña la
      // línea igual, para que al menos se vea cuál es, y se dice qué falta.
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
            'Esta línea está en el guion pero no en «voces.reparto» de datos/serie.json, y la ' +
            'muestra la compone la función desde ahí. Normalmente la escribe solo ' +
            '«npm run datos»: si falta, es que serie.json se ha editado a mano o que el ' +
            'despliegue lleva datos viejos. Vuelve a desplegar y se arregla sin tocar nada.',
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
  // Del REPARTO, no de serie.personajes. Once de los que hablan son figurantes y
  // no tienen ficha de personaje —no necesitan identidad visual, les basta un
  // ancla genérica— pero sí tienen voz, así que su género vive donde vive su
  // voz. Lo pone ahí «npm run datos» para todos, con ficha y sin ella.
  const reparto = (serie && serie.voces && serie.voces.reparto) || [];
  const ficha = reparto.find((f) => f && f.personaje === id);
  const genero = ficha && typeof ficha.genero === 'string' ? ficha.genero.trim() : '';
  return genero && genero !== 'sin decidir' ? genero : null;
}
