import { createHash } from 'node:crypto';
import { ErrorDeCara } from './errores.js';

const LIMITE_PENDIENTE_MS = 360_000;
const fallo = mensaje => new ErrorDeCara(mensaje, { http: 409, reintentable: false });

/** Un clic conserva su identidad tras desconexiones, recargas y otras pestañas.
 * El recibo se crea con ifGenerationMatch=0 ANTES de llamar al modelo.
 * Nunca se vuelve a generar una solicitud cuyo resultado es incierto. */
export async function imagenUnaVez(cuerpo, { estado, leer, escribir, generar, firmar, ahora = Date.now }) {
  const trabajo = (estado.cola || []).find(t => cuerpo.trabajo_id ? t.id === cuerpo.trabajo_id :
    t.tipo === cuerpo.tipo && t.args?.id === cuerpo.id &&
    (cuerpo.tipo !== 'keyframe' || t.args?.pieza === cuerpo.pieza));
  if (trabajo?.detencion_solicitada || trabajo?.estado === 'detenido') {
    throw fallo('La generación está detenida. Se conserva el material que ya se guardó.');
  }
  const solicitud = cuerpo.solicitud_id;
  if (trabajo && (!solicitud || !trabajo.solicitud_id)) {
    throw fallo('Actualiza la página antes de generar. Se han detenido los reintentos de la versión anterior.');
  }
  if (trabajo && trabajo.solicitud_id !== solicitud) throw fallo('Este encargo ya cambió. No se generará otra imagen.');
  if (cuerpo.trabajo_id && (!trabajo || trabajo.solicitud_id !== solicitud ||
      trabajo.tipo !== cuerpo.tipo || trabajo.args?.id !== cuerpo.id ||
      (cuerpo.tipo === 'keyframe' && trabajo.args?.pieza !== cuerpo.pieza))) {
    throw fallo('Este encargo ya cambió o se retiró. No se generará otra imagen.');
  }
  if (solicitud && trabajo?.resultado_imagen?.solicitud_id === solicitud) {
    const { solicitud_id, ...resultado } = trabajo.resultado_imagen;
    return { ...resultado, url: await firmar(resultado.ruta), recuperada: true };
  }
  // Las llamadas directas sin una entrada de cola siguen siendo compatibles.
  if (!solicitud) { const resultado = await generar(); return { ...resultado, url: await firmar(resultado.ruta) }; }
  if (typeof solicitud !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(solicitud)) throw fallo('El encargo no tiene una identificación válida.');
  const ruta = `solicitudes/imagen/${solicitud}.json`;
  const identidad = createHash('sha256').update(JSON.stringify([
    cuerpo.tipo, cuerpo.id, cuerpo.pieza || null, cuerpo.proporcion || null
  ])).digest('hex');
  const leerRecibo = async () => { const r = await leer(ruta); return r ? { ...JSON.parse(r.texto), generacion: r.generacion } : null; };
  let recibo = await leerRecibo();
  if (recibo && recibo.identidad !== identidad) throw fallo('Este encargo pertenece a otra imagen. No se volverá a generar.');
  if (!recibo || recibo.estado === 'rechazada') {
    const nuevo = { identidad, estado: 'en_curso', inicio: ahora() };
    try {
      await escribir(ruta, JSON.stringify(nuevo), { tipo: 'application/json', generacion: recibo?.generacion || '0' });
      recibo = null;
    } catch (error) {
      if (error.http !== 409) throw error;
      recibo = await leerRecibo();
      if (!recibo) throw fallo('No se pudo comprobar el encargo. No se volverá a generar automáticamente.');
    }
    if (!recibo) {
      // Si generar o guardar el resultado falla, el recibo permanece reservado.
      // Una respuesta perdida NO autoriza un segundo cobro.
      let resultado;
      try { resultado = await generar(); }
      catch (error) {
        // Un 429 confirma que Google rechazó la petición: permite la espera de
        // cuota habitual. Una desconexión o 5xx no confirma nada y no se repite.
        const registro = { ...nuevo, estado: error.http === 429 ? 'rechazada' : 'fallida',
          mensaje: error.mensaje || error.message || 'No se pudo confirmar la imagen.' };
        await escribir(ruta, JSON.stringify(registro), { tipo: 'application/json' });
        throw error;
      }
      await escribir(ruta, JSON.stringify({ ...nuevo, estado: 'hecho', resultado }), { tipo: 'application/json' });
      return { ...resultado, url: await firmar(resultado.ruta) };
    }
  }
  if (recibo.identidad !== identidad) throw fallo('Este encargo pertenece a otra imagen. No se volverá a generar.');
  if (recibo.estado === 'hecho') return { ...recibo.resultado, url: await firmar(recibo.resultado.ruta), recuperada: true };
  if (recibo.estado === 'fallida') throw fallo(recibo.mensaje + ' No se volverá a generar automáticamente.');
  if (ahora() - recibo.inicio >= LIMITE_PENDIENTE_MS) {
    throw fallo('No se pudo confirmar el resultado. Se detuvieron los reintentos para evitar pagar otra imagen. Revisa la toma antes de pedir una nueva.');
  }
  return { pendiente: true, mensaje: 'Comprobando la imagen que ya se pidió. No se está generando otra.' };
}

/** Una pestaña antigua no puede reactivar un encargo detenido. */
export function protegerDetenciones(propuesta, anterior) {
  for (const antes of anterior.cola || []) {
    if (!antes.detencion_solicitada) continue;
    const despues = (propuesta.cola || []).find(t => t.id === antes.id);
    if (!despues) continue;
    const nuevoEncargo = (despues.solicitud_id && despues.solicitud_id !== antes.solicitud_id) ||
      (despues.reanudacion_id && despues.reanudacion_id !== antes.reanudacion_id);
    if (!nuevoEncargo && (!despues.detencion_solicitada || ['pendiente', 'en_curso'].includes(despues.estado))) {
      throw new ErrorDeCara('Ese encargo está detenido. Actualiza la página para ver su estado.', { http: 400, reintentable: false });
    }
  }
}
