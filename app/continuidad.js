// Compartido por navegador y servidor; sin red ni escritura.
import { VERSION_CONTINUIDAD } from '../datos/continuidad.js';

export function necesitaDireccion(pieza, toma) {
  return Boolean(/^ep(?:0[1-9]|1[0-2])$/.test(pieza?.id || '') &&
    toma?.continuidad?.version !== VERSION_CONTINUIDAD);
}

export function firmaDeToma(toma) {
  // Cadena canónica sin colisiones de hash: los campos de tiempo también cuentan.
  return JSON.stringify([toma?.id, toma?.segmento, toma?.imagen, toma?.video, toma?.escenario, toma?.luz,
    toma?.refs || [], toma?.direccion || null, toma?.continuidad || null,
    toma?.inicio, toma?.veo, toma?.revision_direccion, toma?.dur, toma?.dur_gen, toma?.recorte, toma?.encadena_con, toma?.boca_visible, toma?.de_archivo]);
}

export function conservaMontaje(antes, despues) {
  const campos=['id','dur','dur_gen','recorte','veo','boca_visible','encadena_con'];
  return antes.length === despues.length && despues.every((p,i) =>
    campos.every(c => JSON.stringify(p[c] ?? null) === JSON.stringify(antes[i]?.[c] ?? null)));
}

/** Solo una imagen anterior, aprobada para su revisión y de la misma secuencia. */
export function referenciaDeSecuencia(pieza, toma, estado) {
  const indice=pieza?.tomas?.findIndex(t=>t.id===toma.id) ?? -1;
  if (indice<1 || !toma.continuidad?.secuencia) return null;
  for (const candidata of pieza.tomas.slice(0,indice).reverse()) {
    if (candidata.de_archivo || candidata.escenario!==toma.escenario ||
      candidata.continuidad?.version!==VERSION_CONTINUIDAD ||
      candidata.continuidad?.secuencia!==toma.continuidad.secuencia) continue;
    const entrada=estado.tomas?.[`${pieza.id}/${candidata.id}`];
    if (!materialVigente(entrada,'keyframe') ||
      (entrada.revision_aprobada ?? null)!==(candidata.revision_direccion ?? null)) continue;
    return { id:candidata.id, ruta:entrada.keyframe_aprobado };
  }
  return null;
}

export function normalizarDireccion(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const texto=v=>typeof v === 'string' ? v.trim() : '';
  return { visibles: Array.isArray(d.visibles) ? d.visibles.map(texto) : [],
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
