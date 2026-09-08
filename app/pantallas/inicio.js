// Inicio — una lectura breve del proyecto antes de entrar en las herramientas.
// No guarda nada ni duplica lógica de producción: resume el estado que ya usan
// las demás pantallas y enlaza con el lugar donde se hace cada trabajo.

import { actual, alCambiar, cambiar } from '../estado.js';
import { h, pantalla, seccion, vaciar } from '../ui.js';
import { plural, segundos } from '../formato.js';

let promesaDeDatos = null;

export default {
  id: 'inicio',
  titulo: 'Inicio',
  icono: 'home',

  async montar(raiz) {
    let vivo = true;
    let datos;

    try {
      datos = await cargarDatos();
    } catch {
      datos = { serie: {}, guiones: { guiones: [] } };
    }

    const pintar = () => {
      if (!vivo) return;
      vaciar(raiz).appendChild(construir(datos));
    };

    pintar();
    const desuscribir = alCambiar(pintar);

    return () => {
      vivo = false;
      if (typeof desuscribir === 'function') desuscribir();
    };
  },
};

async function cargarDatos() {
  if (!promesaDeDatos) {
    promesaDeDatos = Promise.all([
      fetch(new URL('../../datos/serie.json', import.meta.url), { cache: 'no-store' }).then(respuestaJson),
      fetch(new URL('../../datos/guiones.json', import.meta.url), { cache: 'no-store' }).then(respuestaJson),
    ]).then(([serie, guiones]) => ({ serie, guiones }));
  }
  return promesaDeDatos;
}

function respuestaJson(respuesta) {
  if (!respuesta.ok) throw new Error(`Los datos han contestado ${respuesta.status}`);
  return respuesta.json();
}

function construir({ serie, guiones }) {
  const estado = leerEstado();
  const pieza = piezaActiva(serie, estado);
  const resumenPieza = contarPieza(pieza, estado);
  const preparacion = contarPreparacion(serie, estado);
  const desglose = contarDesglose(guiones, estado);
  const cola = contarCola(estado);

  const hero = h('article', { clase: ['inicio-hero', 'tarjeta'] },
    h('p', { clase: 'inicio-eyebrow' }, 'PIEZA ACTIVA'),
    h('h2', { clase: 'inicio-pieza' }, pieza.titulo),
    h('div', { clase: 'inicio-metricas' },
      h('div', {
        clase: ['inicio-porcentaje', resumenPieza.porcentaje === 100 && 'completo'],
        role: 'progressbar',
        'aria-label': 'Progreso de la pieza',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(resumenPieza.porcentaje),
      },
        h('strong', null, `${resumenPieza.porcentaje} %`),
      ),
      h('div', { clase: 'inicio-metrica' },
        h('strong', null, `${resumenPieza.hechos} de ${resumenPieza.total} planos`),
        h('small', null, resumenPieza.hechos === resumenPieza.total ? 'completo' : 'terminados'),
      ),
      h('div', { clase: 'inicio-metrica inicio-metrica-tiempo' },
        h('span', { clase: 'material-symbols-rounded', 'aria-hidden': 'true' }, 'schedule'),
        h('span', null,
          h('strong', null, segundos(pieza.duracionS)),
          h('small', null, 'de pieza'),
        ),
      ),
    ),
    h('a', { clase: ['boton', 'boton-principal', 'inicio-cta'], href: '#tomas' },
      h('span', { clase: 'material-symbols-rounded', 'aria-hidden': 'true' }, 'play_arrow'),
      'Ver Tomas',
    ),
  );

  const estadoProyecto = seccion('Estado del proyecto',
    filaEstado({
      icono: preparacion.listo ? 'check_circle' : 'pending',
      tono: preparacion.listo ? 'listo' : 'en-curso',
      titulo: 'Preparación',
      detalle: `Voces ${preparacion.vocesHechas}/${preparacion.vocesTotal} · Banco ${preparacion.bancoHecho}/${preparacion.bancoTotal}`,
      estado: preparacion.listo ? 'Listo' : 'En curso',
      href: '#voces',
    }),
    filaEstado({
      icono: 'demography',
      tono: desglose.hechas === desglose.total ? 'listo' : 'en-curso',
      titulo: 'Desglose',
      detalle: `${desglose.hechas} de ${desglose.total} escenas`,
      estado: desglose.hechas === desglose.total ? 'Listo' : 'En curso',
      href: '#desglose',
    }),
    filaEstado({
      icono: 'format_list_bulleted',
      tono: cola.fallidas ? 'fallido' : cola.enCurso ? 'en-curso' : 'listo',
      titulo: 'Cola de trabajo',
      detalle: `${cola.enCurso} en curso · ${cola.pendientes} en espera · ${cola.fallidas} fallidos`,
      estado: cola.enCurso || cola.pendientes ? 'Trabajando' : 'En calma',
      href: '#cola',
    }),
  );

  const siguiente = cola.fallidas
    ? seccion('Siguiente paso', h('article', { clase: ['tarjeta', 'inicio-siguiente', 'con-fallo'] },
        h('span', { clase: 'material-symbols-rounded', 'aria-hidden': 'true' }, 'error'),
        h('div', { clase: 'inicio-siguiente-texto' },
          h('h3', null, `Revisar ${plural(cola.fallidas, 'trabajo fallido', 'trabajos fallidos')}`),
          h('p', { clase: 'suave' }, `La cola está al ${cola.porcentaje} %`),
        ),
        h('a', { class: 'boton boton-suave', href: '#cola' }, 'Abrir Cola'),
      ))
    : seccion('Siguiente paso', h('article', { clase: ['tarjeta', 'inicio-siguiente'] },
        h('span', { clase: 'material-symbols-rounded', 'aria-hidden': 'true' }, 'movie'),
        h('div', { clase: 'inicio-siguiente-texto' },
          h('h3', null, resumenPieza.hechos === resumenPieza.total ? 'Revisar el montaje' : 'Continuar en Tomas'),
          h('p', { clase: 'suave' }, `${resumenPieza.hechos} de ${resumenPieza.total} planos terminados`),
        ),
        h('a', { class: 'boton boton-suave', href: resumenPieza.hechos === resumenPieza.total ? '#montaje' : '#tomas' }, 'Abrir'),
      ));

  return pantalla(
    'Inicio',
    h('p', { clase: 'marca-proyecto' }, 'LA MIRADA QUE EL MUNDO TEMERÁ'),
    selectorDePieza(serie, pieza.id),
    hero,
    estadoProyecto,
    siguiente,
  );
}

function selectorDePieza(serie, elegida) {
  const piezas = serie && serie.piezas && typeof serie.piezas === 'object' ? serie.piezas : {};
  const opciones = Object.entries(piezas).filter(([, datos]) => datos && Array.isArray(datos.tomas));
  if (opciones.length < 2) return null;

  const selector = h('select', {
    'aria-label': 'Pieza activa',
    alCambio: async (evento) => {
      const id = String(evento.currentTarget.value || '');
      await cambiar((estado) => { estado.pieza_activa = id; });
    },
  }, opciones.map(([id, datos]) => h('option', { value: id }, String(datos.titulo || id))));
  selector.value = elegida;

  return h('label', { clase: 'inicio-selector' },
    h('span', { clase: 'oculto' }, 'Pieza activa'),
    selector,
    h('span', { clase: 'material-symbols-rounded', 'aria-hidden': 'true' }, 'expand_more'),
  );
}

function filaEstado({ icono, tono, titulo, detalle, estado, href }) {
  return h('a', { clase: ['inicio-fila', `inicio-fila-${tono}`], href },
    h('span', { clase: 'material-symbols-rounded inicio-fila-icono', 'aria-hidden': 'true' }, icono),
    h('span', { clase: 'inicio-fila-texto' },
      h('strong', null, titulo),
      h('small', null, detalle),
    ),
    h('span', { clase: 'inicio-fila-estado' }, estado),
    h('span', { clase: 'material-symbols-rounded inicio-fila-flecha', 'aria-hidden': 'true' }, 'chevron_right'),
  );
}

function leerEstado() {
  try {
    return actual();
  } catch {
    return { tomas: {}, voces: {}, banco: {}, escenarios: {}, desglose: {}, cola: [] };
  }
}

function piezaActiva(serie, estado) {
  const piezasBase = serie && serie.piezas && typeof serie.piezas === 'object' ? serie.piezas : {};
  const piezasEstado = estado && estado.piezas && typeof estado.piezas === 'object' ? estado.piezas : {};
  const id = String(estado.pieza_activa || 'teaser');
  const datos = piezasEstado[id] || piezasBase[id] || piezasBase.teaser || Object.values(piezasBase)[0] || {};
  return {
    id: piezasEstado[id] || piezasBase[id] ? id : 'teaser',
    titulo: String(datos.titulo || 'Teaser Temporada 1'),
    duracionS: Number(datos.duracion_s) || 0,
    tomas: Array.isArray(datos.tomas) ? datos.tomas : [],
  };
}

function contarPieza(pieza, estado) {
  const tomas = estado && estado.tomas && typeof estado.tomas === 'object' ? estado.tomas : {};
  const total = pieza.tomas.length;
  let hechos = 0;
  for (const toma of pieza.tomas) {
    const guardada = tomas[`${pieza.id}/${toma.id}`];
    if (guardada && guardada.clip_elegido) hechos += 1;
  }
  return { total, hechos, porcentaje: total ? Math.round((hechos / total) * 100) : 0 };
}

function contarPreparacion(serie, estado) {
  const reparto = serie && serie.voces && Array.isArray(serie.voces.reparto) ? serie.voces.reparto : [];
  const voces = estado && estado.voces && typeof estado.voces === 'object' ? estado.voces : {};
  const vocesHechas = reparto.filter((persona) => {
    const id = persona && (persona.personaje || persona.id);
    return id && voces[id] && voces[id].voz_id;
  }).length;
  const placas = serie && serie.banco && Array.isArray(serie.banco.placas) ? serie.banco.placas : [];
  const escenarios = serie && serie.escenarios && Array.isArray(serie.escenarios.placas) ? serie.escenarios.placas : [];
  const bancoEstado = estado && estado.banco && typeof estado.banco === 'object' ? estado.banco : {};
  const escenariosEstado = estado && estado.escenarios && typeof estado.escenarios === 'object' ? estado.escenarios : {};
  const bancoHecho = placas.filter((una) => bancoEstado[una.id] && bancoEstado[una.id].aprobada).length
    + escenarios.filter((una) => escenariosEstado[una.id] && escenariosEstado[una.id].aprobada).length;
  const bancoTotal = placas.length + escenarios.length;
  return {
    vocesHechas,
    vocesTotal: reparto.length,
    bancoHecho,
    bancoTotal,
    listo: vocesHechas === reparto.length && bancoHecho === bancoTotal && bancoTotal > 0,
  };
}

function contarDesglose(guiones, estado) {
  const episodios = guiones && Array.isArray(guiones.guiones) ? guiones.guiones : [];
  const total = episodios.reduce((suma, episodio) => suma + (Array.isArray(episodio.escenas) ? episodio.escenas.length : 0), 0);
  const guardado = estado && estado.desglose && typeof estado.desglose === 'object' ? estado.desglose : {};
  const hechas = Object.values(guardado).filter((una) => una && typeof una === 'object' && una.ruta).length;
  return { total, hechas };
}

function contarCola(estado) {
  if (estado && estado.preview_resumen && typeof estado.preview_resumen === 'object') {
    const previo = estado.preview_resumen;
    return {
      pendientes: Number(previo.pendientes) || 0,
      enCurso: Number(previo.enCurso) || 0,
      hechas: Number(previo.hechas) || 0,
      fallidas: Number(previo.fallidas) || 0,
      porcentaje: Number(previo.porcentaje) || 0,
    };
  }
  const trabajos = estado && Array.isArray(estado.cola) ? estado.cola : [];
  const cuenta = { pendientes: 0, enCurso: 0, hechas: 0, fallidas: 0 };
  for (const trabajo of trabajos) {
    if (!trabajo || typeof trabajo !== 'object') continue;
    const suEstado = String(trabajo.estado || '').replace(/-/g, '_');
    if (suEstado === 'pendiente') cuenta.pendientes += 1;
    else if (suEstado === 'en_curso') cuenta.enCurso += 1;
    else if (suEstado === 'hecho') cuenta.hechas += 1;
    else if (suEstado === 'fallido') cuenta.fallidas += 1;
  }
  const total = cuenta.pendientes + cuenta.enCurso + cuenta.hechas + cuenta.fallidas;
  return { ...cuenta, porcentaje: total ? Math.round((cuenta.hechas / total) * 100) : 100 };
}
