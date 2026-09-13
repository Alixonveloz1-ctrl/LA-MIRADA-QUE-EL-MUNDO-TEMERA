// Compartido por navegador y servidor; sin red ni escritura.
import { VERSION_CONTINUIDAD } from '../datos/continuidad.js';
import { guiaDeEscena, guiaDePlano } from '../datos/escenas.js';

export function necesitaDireccion(pieza, toma) {
  return Boolean(/^ep(?:0[1-9]|1[0-2])$/.test(pieza?.id || '') &&
    toma?.continuidad?.version !== VERSION_CONTINUIDAD);
}

export function firmaDeToma(toma) {
  // Cadena canónica sin colisiones de hash: los campos de tiempo también cuentan.
  return JSON.stringify([toma?.id, toma?.segmento, toma?.imagen, toma?.video, toma?.escenario, toma?.luz,
    toma?.refs || [], toma?.referencia_anterior ?? null, toma?.direccion || null, toma?.continuidad || null,
    toma?.inicio, toma?.veo, toma?.revision_direccion, toma?.dur, toma?.dur_gen, toma?.recorte, toma?.encadena_con, toma?.boca_visible, toma?.de_archivo]);
}

export function conservaMontaje(antes, despues) {
  const campos=['id','dur','dur_gen','recorte','veo','boca_visible','encadena_con'];
  return antes.length === despues.length && despues.every((p,i) =>
    campos.every(c => JSON.stringify(p[c] ?? null) === JSON.stringify(antes[i]?.[c] ?? null)));
}

/** Resuelve también planes ya guardados. Es una lectura: no modifica imágenes,
 * interruptores, revisiones ni aprobaciones. La placa por sí sola no decide. */
function identidadDeSecuencia(pieza,toma) {
  const c=toma?.continuidad, ep=Number(/^ep(\d+)$/.exec(pieza?.id || '')?.[1]);
  const guia=guiaDePlano(ep,toma.escena,toma.segmento);
  if (!guia) return null;
  if (guia.escenario!==toma.escenario) return null;
  // Las divisiones explícitas añadidas a un plan se conservan; solo se adapta
  // el formato de secuencia generado por esta aplicación.
  if (c?.secuencia && !/^ep\d+\//.test(c.secuencia)) return `${toma.escenario}/${c.secuencia}/${c.subespacio || ''}`;
  if (c?.subespacio && c.subespacio!==guia.lugar) return `${guia.secuencia}/${guia.espacio}/${c.subespacio}`;
  return `${guia.secuencia}/${guia.espacio}/${guia.flashback?'pasado':'presente'}`;
}

function motivoDeReferenciaPendiente(pieza,toma,estado) {
  if ((estado.cola || []).some(t=>t.tipo==='keyframe' && t.args?.pieza===pieza.id &&
    t.args?.id===toma.id && ['pendiente','en_curso'].includes(t.estado))) {
    return `La imagen ${toma.id} se está generando. Espera y revísala antes de continuar.`;
  }
  const e=estado.tomas?.[`${pieza.id}/${toma.id}`];
  const ultima=e?.intentos_keyframe?.at(-1);
  if (necesitaDireccion(pieza,toma) || !materialVigente(e,'keyframe') ||
      (ultima && ultima!==e.keyframe_aprobado) ||
      (e.revision_aprobada ?? null)!==(toma.revision_direccion ?? null)) {
    return `Revisa y aprueba la imagen ${toma.id}${pieza.id ? ` del capítulo ${Number(pieza.id.slice(2))}`:''} antes de continuar.`;
  }
  return null;
}

// Una sola búsqueda compartida: ni los figurantes ni el plano anterior pueden
// saltar a otro lugar, otro momento del relato o una imagen futura.
function anterioresDeSecuencia(pieza,toma,estado) {
  const indice=pieza?.tomas?.findIndex(t=>t.id===toma.id) ?? -1;
  const identidad=identidadDeSecuencia(pieza,toma);
  if (indice<0 || !identidad || toma.de_archivo) return [];
  const ep=Number(pieza.id.slice(2));
  const anteriores=Object.entries(estado.piezas || {}).filter(([id])=>/^ep\d+$/.test(id) && Number(id.slice(2))<ep)
    .sort(([a],[b])=>Number(a.slice(2))-Number(b.slice(2)))
    .flatMap(([id,p])=>(p.tomas || []).map(t=>({pieza:{...p,id},toma:t})));
  return [...anteriores,...pieza.tomas.slice(0,indice).map(t=>({pieza,toma:t}))].reverse()
    .filter(c=>!c.toma.de_archivo &&
      !(c.toma.archivo_original && !c.toma.direccion?.visibles?.length) &&
      identidadDeSecuencia(c.pieza,c.toma)===identidad);
}

function referenciaDeCandidata(c,pieza,estado) {
  const referencia={id:c.toma.id,ruta:estado.tomas[`${c.pieza.id}/${c.toma.id}`].keyframe_aprobado};
  if (c.pieza.id!==pieza.id) referencia.pieza=c.pieza.id;
  return referencia;
}

function etiquetaDeCandidata(c,pieza) {
  const orden=c.pieza.tomas.filter(t=>String(t.escena)===String(c.toma.escena)).findIndex(t=>t.id===c.toma.id)+1;
  return `${c.pieza.id!==pieza.id?`Capítulo ${Number(c.pieza.id.slice(2))} · `:''}Escena ${c.toma.escena} · Toma ${orden}`;
}

/** La revisión humana es obligatoria entre tomas de una misma escena. */
export function pasoDeEscena(pieza, toma, estado) {
  if (!/^ep\d+$/.test(pieza?.id || '') || toma.de_archivo) return {anterior:null,bloqueo:null};
  const indice=pieza.tomas.findIndex(t=>t.id===toma.id);
  const secuencia=identidadDeSecuencia(pieza,toma);
  if (!secuencia) return {anterior:null,bloqueo:null};
  for (let i=indice-1;i>=0;i--) {
    const anterior=pieza.tomas[i];
    if (String(anterior.escena)!==String(toma.escena) || anterior.escenario!==toma.escenario ||
        identidadDeSecuencia(pieza,anterior)!==secuencia ||
        anterior.segmento!==toma.segmento) break;
    // Los detalles del banco no sustituyen la última imagen narrativa.
    if (anterior.de_archivo) continue;
    return {anterior, bloqueo:motivoDeReferenciaPendiente(pieza,anterior,estado)};
  }
  return {anterior:null,bloqueo:null};
}

/** Disponibilidad y explicación usan exactamente la misma búsqueda del servidor.
 * Nunca se salta la última toma pendiente para recuperar una versión más vieja. */
export function estadoDeReferencia(pieza,toma,estado) {
  if (necesitaDireccion(pieza,toma)) return {referencia:null,motivo:'Primero actualiza la continuidad de esta escena.'};
  const paso=pasoDeEscena(pieza,toma,estado);
  if (paso.bloqueo) return {referencia:null,motivo:paso.bloqueo};
  const indice=pieza?.tomas?.findIndex(t=>t.id===toma.id) ?? -1;
  const identidad=identidadDeSecuencia(pieza,toma);
  if (indice<0 || !identidad || toma.de_archivo) return {referencia:null,motivo:'Esta toma no tiene una referencia anterior disponible.'};
  for (const c of anterioresDeSecuencia(pieza,toma,estado)) {
    const candidata=c.toma;
    const motivo=motivoDeReferenciaPendiente(c.pieza,candidata,estado);
    if (motivo) return {referencia:null,motivo};
    return {referencia:referenciaDeCandidata(c,pieza,estado),motivo:'',etiqueta:etiquetaDeCandidata(c,pieza)};
  }
  const guia=guiaDeEscena(Number(pieza.id.slice(2)),toma.escena);
  return {referencia:null,motivo:guia?.enlace ?
    `Esta escena continúa una anterior. Todavía falta una imagen aprobada de esa parte de la historia para usarla como referencia.` :
    'Todavía no hay una imagen anterior aprobada que pueda usarse aquí. Se usarán los personajes y el escenario del banco.'};
}

/** Una vista general aprobada conserva la disposición completa aunque un
 * detalle intermedio no la muestre o se apague el apoyo de la toma anterior.
 * Solo se busca dentro del mismo lugar y momento narrativo. */
export function estadoDeBaseEscena(pieza,toma,estado) {
  if (necesitaDireccion(pieza,toma)) return {referencia:null,motivo:''};
  for (const c of anterioresDeSecuencia(pieza,toma,estado)) {
    const camara=String(c.toma.direccion?.camara || '');
    const general=/\b(establishing|wide shot|wide view|whole (?:room|hall|space|gathering)|entire (?:room|hall|space|table|gathering)|full (?:room|hall|gathering)|length of (?:the |a )?(?:long )?table|plano general|vista general)\b/i.test(camara);
    if (!general || /\b(close[ -]?up|close detail|macro|medium|medio|primer plano|detalle)\b/i.test(camara)) continue;
    // No usar una versión antigua cuando ese general está siendo reemplazado.
    const motivo=motivoDeReferenciaPendiente(c.pieza,c.toma,estado);
    if (motivo) return {referencia:null,motivo};
    return {referencia:referenciaDeCandidata(c,pieza,estado),motivo:'',etiqueta:etiquetaDeCandidata(c,pieza)};
  }
  return {referencia:null,motivo:''};
}

/** El interruptor decide si se envía la referencia compatible, nunca el banco. */
export function referenciaDeSecuencia(pieza,toma,estado) {
  if (toma.referencia_anterior===false) return null;
  return estadoDeReferencia(pieza,toma,estado).referencia;
}

export function placaDePersonaje(placa,personaje) {
  return placa.personaje===personaje || placa.personaje.startsWith(personaje+'-');
}

/** El banco sigue siendo obligatorio aunque haya una imagen de continuidad.
 * No elegimos una edad o un vestuario por nuestra cuenta si el plan los omitió. */
export function personajesSinReferencia(toma,placas) {
  if (toma.de_archivo) return [];
  return (toma.direccion?.visibles || []).filter(p=>
    placas.some(r=>placaDePersonaje(r,p)) &&
    !placas.some(r=>placaDePersonaje(r,p) && (toma.refs || []).includes(r.id)));
}

/** Un general que muestra la reunión completa no puede sustituir a los
 * personajes físicos del guion por figurantes. No se aplica a planos cerrados
 * ni deduce presencia a partir de nombres mencionados en el diálogo. */
export function personajesOmitidosEnGeneral(toma,placas) {
  if (toma.de_archivo || !toma.continuidad || !toma.direccion) return [];
  const camara=String(toma.direccion.camara || '');
  const general=/\b(establishing|whole (?:room|hall|space|gathering)|entire (?:room|hall|space|table|gathering)|full (?:room|hall|gathering)|length of (?:the |a )?(?:long )?table)\b/i.test(camara);
  if (!general || /\b(close[ -]?up|close detail|macro)\b/i.test(camara)) return [];
  // El reparto de toda la escena también puede incluir a quien llega después.
  // Solo exigir a quienes el desglose sitúa físicamente presentes AHORA.
  return (toma.direccion.presentes || []).filter(p=>placas.some(r=>placaDePersonaje(r,p)) && !toma.direccion.visibles.includes(p));
}

/** Conserva el aspecto de acompañantes sin ficha propia cuando un primer plano
 * intermedio deja de mostrarlos. Solo usa su última aparición aprobada en esta
 * secuencia, nunca una versión vieja de una aparición pendiente de revisión. */
export function referenciasDeReparto(pieza,toma,estado,placas) {
  if (!referenciaDeSecuencia(pieza,toma,estado)) return [];
  const sinFicha=(toma.direccion?.visibles || []).filter(p=>!placas.some(r=>placaDePersonaje(r,p)));
  const buscadas=new Set(sinFicha), resultado=[];
  for (const c of anterioresDeSecuencia(pieza,toma,estado)) {
    const visibles=[...buscadas].filter(p=>(c.toma.direccion?.visibles || []).includes(p));
    if (!visibles.length) continue;
    for (const p of visibles) buscadas.delete(p);
    if (motivoDeReferenciaPendiente(c.pieza,c.toma,estado)) continue;
    resultado.push({...referenciaDeCandidata(c,pieza,estado),personajes:visibles,etiqueta:etiquetaDeCandidata(c,pieza)});
    if (!buscadas.size) break;
  }
  return resultado;
}

export function normalizarDireccion(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const texto=v=>typeof v === 'string' ? v.trim() : '';
  return { ...(Array.isArray(d.presentes) ? {presentes:d.presentes.map(texto)} : {}),
    visibles: Array.isArray(d.visibles) ? d.visibles.map(texto) : [],
    fuera_de_campo: Array.isArray(d.fuera_de_campo) ? d.fuera_de_campo.map(texto) : [],
    posiciones: texto(d.posiciones), miradas: texto(d.miradas),
    camara: texto(d.camara), estado_inicial: texto(d.estado_inicial),
    estado_final: texto(d.estado_final) };
}

export function revisarDireccion(toma, marco) {
  if (toma.de_archivo) return [];
  const d=toma.direccion, errores=[];
  if (!d) return ['Falta la dirección de la toma.'];
  for (const campo of ['posiciones','miradas','camara','estado_inicial','estado_final']) {
    if (!d[campo]?.trim()) errores.push(`Falta dirección.${campo}.`);
  }
  const elenco = new Set(marco.personajes || []);
  if (Array.isArray(d.presentes)) {
    for(const p of d.presentes) if(!elenco.has(p)) errores.push(`«${p}» no pertenece al reparto físico de esta escena.`);
    for(const p of d.visibles) if(!d.presentes.includes(p)) errores.push(`«${p}» está visible pero no figura presente en este momento.`);
  }
  for (const p of elenco) {
    if (!d.visibles.includes(p) && !d.fuera_de_campo.includes(p)) errores.push(`Falta situar a «${p}» en cuadro o fuera de campo.`);
  }
  for (const p of [...d.visibles,...d.fuera_de_campo]) {
    if (!elenco.has(p)) errores.push(`«${p}» no pertenece al reparto físico de esta escena.`);
  }
  if (d.visibles.some(p => d.fuera_de_campo.includes(p))) errores.push('Un personaje no puede estar visible y fuera de campo a la vez.');
  const texto = `${toma.imagen} ${toma.video} ${d.miradas}`;
  const afirmaciones=texto.split(/[.!?\n;]/).filter(s=>! /\b(no|not|never|without|avoid|absent)\b/i.test(s)).join(' ');
  if (/\b(?:looks?|looking|stares?|staring|gazes?|gazing)\s+(?:\w+\s+){0,3}(?:into|at|towards?)\s+(?:the\s+)?(?:camera|lens|viewer|audience)\b/i.test(afirmaciones)) {
    errores.push('La mirada debe dirigirse a la historia, no al espectador.');
  }
  // Las prohibiciones en negativos no cuentan como fenómenos pedidos.
  if (marco.interior === true && /\b(rainfall|raining|rain haze|falling rain|raindrops falling)\b/i.test(afirmaciones)) errores.push('Se ha pedido lluvia en una escena interior.');
  const movimiento=String(toma.video || '').split(/[.!?\n;]/).filter(s=>! /\b(no|not|never|without|avoid)\b/i.test(s)).join(' ');
  if (/\b(cut to|cuts to|dissolve to|crossfade|split.screen|montage of|scene changes to)\b/i.test(movimiento)) errores.push('Cada vídeo debe ser una toma continua. Los cambios de plano se hacen en el montaje.');
  return errores;
}

export function invalidarMontajes(estado, pieza) {
  for (const montaje of estado.montajes || []) {
    if (montaje.id === pieza || String(montaje.id || '').startsWith(pieza+'/')) montaje.revision_pendiente = true;
  }
}

export function materialVigente(entrada, tipo) {
  const ruta = tipo === 'keyframe' ? entrada?.keyframe_aprobado : entrada?.clip_elegido;
  if (!ruta) return false;
  if (tipo === 'keyframe') return !entrada.revision_pendiente;
  if (entrada.revision_pendiente || entrada.clip_revision_pendiente) return false;
  const origen=entrada.origenes_clip?.[ruta];
  return !origen || origen.keyframe === entrada.keyframe_aprobado;
}

export function marcarCambio(entrada, antes, despues) {
  if (firmaDeToma(antes) === firmaDeToma(despues)) return;
  if (entrada.keyframe_aprobado || entrada.intentos_keyframe?.length) entrada.revision_pendiente = true;
  if (entrada.clip_elegido || entrada.intentos_clip?.length) entrada.clip_revision_pendiente = true;
}
