// Servidor local de vista previa. Sirve los archivos sin transformarlos y usa
// una copia demostrativa del estado para que comprobar la interfaz nunca lance
// generaciones ni escriba en el bucket real.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = normalize(join(fileURLToPath(new URL('.', import.meta.url)), '..'));
const argumentos = process.argv.slice(2);
const puerto = Number(valorDe('--port')) || 4173;
const host = valorDe('--host') || '0.0.0.0';

const serie = JSON.parse(await readFile(join(raiz, 'datos/serie.json'), 'utf8'));
const guiones = JSON.parse(await readFile(join(raiz, 'datos/guiones.json'), 'utf8'));
let estado = estadoDemostrativo(serie, guiones);
let generacion = 1;

const tipos = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.wav': 'audio/wav',
};

createServer(async (peticion, respuesta) => {
  try {
    const url = new URL(peticion.url || '/', `http://${peticion.headers.host || 'localhost'}`);
    if (url.pathname === '/api/g' && peticion.method === 'POST') {
      await apiLocal(peticion, respuesta);
      return;
    }

    const pedida = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const relativa = normalize(pedida).replace(/^([/\\])+/, '');
    const archivo = join(raiz, relativa);
    if (!archivo.startsWith(raiz)) {
      enviar(respuesta, 403, { error: 'Ruta no permitida' });
      return;
    }
    const contenido = await readFile(archivo);
    respuesta.writeHead(200, {
      'Content-Type': tipos[extname(archivo).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    respuesta.end(contenido);
  } catch (fallo) {
    if (fallo && fallo.code === 'ENOENT') {
      enviar(respuesta, 404, { error: 'No encontrado' });
      return;
    }
    enviar(respuesta, 500, { error: fallo && fallo.message ? fallo.message : String(fallo) });
  }
}).listen(puerto, host, () => {
  console.log(`Vista previa lista en ${host}:${puerto}`);
});

function valorDe(nombre) {
  const indice = argumentos.indexOf(nombre);
  if (indice < 0) return '';
  const siguiente = argumentos[indice + 1];
  return siguiente && !siguiente.startsWith('--') ? siguiente : '';
}

async function apiLocal(peticion, respuesta) {
  const trozos = [];
  for await (const trozo of peticion) trozos.push(trozo);
  const cuerpo = JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}');
  const modo = String(cuerpo.modo || '');

  if (modo === 'estado-leer') {
    enviar(respuesta, 200, { ok: true, estado, generacion: String(generacion) });
    return;
  }
  if (modo === 'estado-escribir') {
    if (String(cuerpo.generacion ?? '') !== String(generacion)) {
      enviar(respuesta, 409, {
        ok: false,
        mensaje: 'El estado de la vista previa ha cambiado en otra operación.',
        estado,
        generacion: String(generacion),
      });
      return;
    }
    estado = cuerpo.estado && typeof cuerpo.estado === 'object' ? cuerpo.estado : estado;
    generacion += 1;
    enviar(respuesta, 200, { ok: true, generacion: String(generacion) });
    return;
  }
  if (modo === 'firmar') {
    enviar(respuesta, 200, { ok: true, urls: {} });
    return;
  }
  if (modo === 'listar') {
    enviar(respuesta, 200, { ok: true, objetos: [] });
    return;
  }
  if (modo === 'voces') {
    enviar(respuesta, 200, {
      ok: true,
      voces: serie.voces && Array.isArray(serie.voces.catalogo) ? serie.voces.catalogo : [],
    });
    return;
  }
  if (modo === 'salud') {
    enviar(respuesta, 200, {
      ok: true,
      cuenta: {
        correo: 'la-mirada@••••••.iam.gserviceaccount.com',
        proyecto: 'la-mirada-••••',
        bucket: 'la-mirada-••••',
        prefijo: 'produccion',
      },
      credenciales: { ok: true },
      bucket: { lectura: true, escritura: true },
      prueba_cors: {},
      modelos: [],
      voces: serie.voces && Array.isArray(serie.voces.catalogo) ? serie.voces.catalogo : [],
      montaje: { configurado: true, job: 'montaje', region: 'europe-west1' },
    });
    return;
  }

  enviar(respuesta, 400, {
    ok: false,
    mensaje: `«${modo}» está desactivado en la vista previa para no gastar cuota.`,
  });
}

function enviar(respuesta, codigo, cuerpo) {
  const texto = JSON.stringify(cuerpo);
  respuesta.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(texto),
    'Cache-Control': 'no-store',
  });
  respuesta.end(texto);
}

function estadoDemostrativo(datos, todosLosGuiones) {
  const ahora = new Date().toISOString();
  const futuro = '2099-01-01T00:00:00.000Z';
  const teaser = datos.piezas && datos.piezas.teaser ? datos.piezas.teaser : { tomas: [] };
  const tomas = {};
  for (const toma of Array.isArray(teaser.tomas) ? teaser.tomas : []) {
    tomas[`teaser/${toma.id}`] = {
      keyframe_aprobado: `preview/keyframes/${toma.id}.jpg`,
      intentos_keyframe: [],
      clip_elegido: `preview/clips/${toma.id}.mp4`,
      intentos_clip: [],
      operacion_en_curso: null,
    };
  }

  const banco = {};
  for (const placa of datos.banco && Array.isArray(datos.banco.placas) ? datos.banco.placas : []) {
    banco[placa.id] = { aprobada: `preview/banco/${placa.id}.jpg`, intentos: [] };
  }
  const escenarios = {};
  for (const placa of datos.escenarios && Array.isArray(datos.escenarios.placas) ? datos.escenarios.placas : []) {
    escenarios[placa.id] = { aprobada: `preview/escenarios/${placa.id}.jpg`, intentos: [] };
  }

  const voces = {};
  const reparto = datos.voces && Array.isArray(datos.voces.reparto) ? datos.voces.reparto : [];
  const catalogo = datos.voces && Array.isArray(datos.voces.catalogo) ? datos.voces.catalogo : [];
  reparto.forEach((persona, indice) => {
    const candidata = catalogo[indice % Math.max(catalogo.length, 1)];
    voces[persona.personaje] = {
      voz_id: candidata ? candidata.id : `preview-${indice + 1}`,
      ja: null,
      muestras: {},
    };
  });

  const desglose = {};
  const episodios = todosLosGuiones && Array.isArray(todosLosGuiones.guiones) ? todosLosGuiones.guiones : [];
  for (const episodio of episodios) {
    for (const escena of Array.isArray(episodio.escenas) ? episodio.escenas : []) {
      if (Object.keys(desglose).length >= 37) break;
      desglose[`${episodio.episodio}/${escena.escena}`] = {
        ruta: `preview/desglose/${episodio.episodio}/${escena.escena}.json`,
        planos: episodio.episodio === 1 ? 6 : 5,
        cuando: ahora,
      };
    }
  }

  const cola = [];
  for (let i = 0; i < 200; i += 1) cola.push({ id: `hecho-${i}`, modo: 'preview', estado: 'hecho', actualizado: ahora });
  for (let i = 0; i < 17; i += 1) cola.push({ id: `espera-${i}`, modo: 'preview', estado: 'pendiente', proximo: futuro, actualizado: ahora });
  for (let i = 0; i < 7; i += 1) cola.push({ id: `fallido-${i}`, modo: 'preview', estado: 'fallido', error: 'Trabajo de muestra', actualizado: ahora });
  cola.push({ id: 'en-curso', modo: 'preview', estado: 'en_curso', actualizado: ahora });

  return {
    preview_resumen: { pendientes: 17, enCurso: 1, hechas: 200, fallidas: 7, porcentaje: 89 },
    pieza_activa: 'teaser',
    tomas,
    banco,
    escenarios,
    voces,
    desglose,
    cola,
    audio: { musica: {}, voz: {} },
    piezas: {},
    montajes: [],
    gasto: {
      imagen: { calidad: 0, medio: 351, economico: 0 },
      video_s: { calidad: 0, medio: 0, economico: 510 },
      musica_s: 2656,
      voz_s: 22.2,
    },
  };
}
