import { ErrorDeCara } from './errores.js';
import { firmaDeToma, marcarCambio, invalidarMontajes } from '../../app/continuidad.js';
import { puedeRedistribuir } from '../../datos/segmentos.js';

/** Aplica una reparación ya validada dentro de la transacción del estado. */
export function aplicarCorreccion(estado, idPieza, escena, antes, planos, metadata) {
  const viva=estado.piezas?.[idPieza];
  const actuales=viva?.tomas?.filter(t=>String(t.escena)===String(escena));
  if (JSON.stringify(actuales?.map(firmaDeToma))!==JSON.stringify(antes.map(firmaDeToma))) {
    throw new ErrorDeCara('La escena cambió durante la corrección. Se conservó la propuesta y el respaldo; no se sustituyeron tus tomas.',{http:409,reintentable:false});
  }
  if (!estado.tomas) estado.tomas={};
  const episodio=Number(viva.episodio || idPieza.replace(/^ep/,''));
  const redistribuir=puedeRedistribuir(episodio,escena);
  if (redistribuir) {
    const total=ps=>ps.reduce((s,p)=>s+Number(p.dur),0);
    if (!planos.length || Math.abs(total(antes)-total(planos))>=0.001 || planos.some(p=>!Number.isFinite(Number(p.dur)) || Number(p.dur)<=0 || p.boca_visible || p.encadena_con)) {
      throw new ErrorDeCara('La separación de planos debe conservar la duración de la escena y usar cortes.',{http:409,reintentable:false});
    }
    const primero=viva.tomas.findIndex(t=>String(t.escena)===String(escena));
    let inicio=Number(viva.tomas[primero].inicio);
    if (!Number.isFinite(inicio)) throw new ErrorDeCara('La escena no tiene un inicio válido para conservar sus tiempos.',{http:409,reintentable:false});
    const nuevas=planos.map(p=>{const t={...p,inicio};inicio+=Number(p.dur);return t;});
    for (const t of antes) marcarCambio(estado.tomas[`${idPieza}/${t.id}`] || {},t,null);
    for (const t of nuevas) {
      const clave=`${idPieza}/${t.id}`;
      if (!estado.tomas[clave]) estado.tomas[clave]={intentos_keyframe:[],intentos_clip:[]};
      marcarCambio(estado.tomas[clave],antes.find(a=>a.id===t.id),t);
    }
    viva.tomas=viva.tomas.flatMap((t,i)=>i===primero ? nuevas : String(t.escena)===String(escena) ? [] : [t]);
  } else viva.tomas=viva.tomas.map(t=>{
    const nueva=planos.find(p=>p.id===t.id);
    if (!nueva) return t;
    const clave=`${idPieza}/${t.id}`;
    const entrada=estado.tomas[clave] || (estado.tomas[clave]={intentos_keyframe:[],intentos_clip:[]});
    marcarCambio(entrada,t,nueva);
    return { ...t,...nueva,inicio:t.inicio };
  });
  invalidarMontajes(estado,idPieza);
  if (!viva.correcciones_continuidad) viva.correcciones_continuidad={};
  viva.correcciones_continuidad[escena]=metadata;
  const guardado=estado.desglose?.[`${episodio}/${escena}`];
  // Mantener cuando evita reconstruir el audio: esta revisión conserva tiempos.
  if (guardado) { guardado.ruta=metadata.ruta; guardado.revision_continuidad=metadata.revision; }
}
