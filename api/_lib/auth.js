// Autenticación con Google, sin librerías: se firma un JWT RS256 con la clave
// privada de la service account y se canjea por un token de acceso.
//
// FALTA EN EL CONTRATO: docs/contrato.md §12 no recoge `api/_lib/auth.js`.
// Se implementa con el nombre más obvio en español, `token(ambitos)`, más dos
// ayudas que necesita `gcs.js` para firmar URLs: `AMBITOS` y `clavePrivada()`.
// Conviene añadirlo al contrato.

import { createSign } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { entorno } from './entorno.js';
import { ErrorDeCara, esReintentable } from './errores.js';

// Dónde se canjea el JWT por el token. No identifica ninguna cuenta: es la
// puerta pública de Google. Si la service account trae su propio `token_uri`,
// manda el suyo.
const CANJE_POR_DEFECTO = 'https://oauth2.googleapis.com/token';

// El JWT que se firma vale una hora; es lo máximo que acepta Google.
const VIDA_DEL_JWT_S = 3600;

// Margen con el que se tira un token cacheado: se pide otro 60 segundos antes
// de que caduque, para que ninguna petición salga con un token que muere por el
// camino.
const MARGEN_MS = 60_000;

// El canje no debería tardar; si tarda, la función serverless se apagaría sin
// excepción y el activo se quedaría «generando» para siempre.
const LIMITE_CANJE_MS = 20_000;

// Ámbitos de uso corriente. Se dan con nombre para no repetir la URL por ahí.
export const AMBITOS = {
  plataforma: 'https://www.googleapis.com/auth/cloud-platform',
  almacen: 'https://www.googleapis.com/auth/devstorage.read_write',
  almacenLectura: 'https://www.googleapis.com/auth/devstorage.read_only'
};

// Caché en memoria del módulo. La función serverless se reutiliza entre
// invocaciones, así que pedir un token nuevo en cada llamada es tiempo tirado.
// La clave es el correo de la cuenta más los ámbitos ordenados: dos juegos de
// ámbitos distintos son dos tokens distintos.
const guardados = new Map();   // clave → { valor, caducaMs }
const enVuelo = new Map();     // clave → Promise, para no canjear dos veces a la vez

/**
 * Devuelve un token de acceso válido para los ámbitos pedidos.
 * @param {string|string[]} [ambitos] uno o varios ámbitos OAuth.
 * @returns {Promise<string>} el token de acceso, listo para `Bearer`.
 */
export async function token(ambitos = AMBITOS.plataforma) {
  const lista = normalizarAmbitos(ambitos);
  const ent = entorno();
  const sa = cuentaValida(ent.sa);
  const clave = `${sa.client_email}\n${lista.join(' ')}`;

  const guardado = guardados.get(clave);
  if (guardado && Date.now() < guardado.caducaMs - MARGEN_MS) return guardado.valor;

  // Si ya hay un canje en marcha para esta misma clave, se espera a ese en vez
  // de lanzar otro: varias llamadas del mismo modo arrancan a la vez.
  const enCurso = enVuelo.get(clave);
  if (enCurso) return enCurso;

  const promesa = canjear(sa, lista)
    .then((resultado) => {
      guardados.set(clave, resultado);
      return resultado.valor;
    })
    .finally(() => {
      enVuelo.delete(clave);
    });

  enVuelo.set(clave, promesa);
  return promesa;
}

/**
 * Devuelve la clave privada de la service account lista para firmar.
 * Algunos despliegues guardan el JSON con los saltos de línea escapados otra
 * vez («\\n» literal); si se firma con eso, node:crypto no reconoce la clave.
 * @param {object} sa service account ya parseada.
 * @returns {string} la clave privada en PEM.
 */
export function clavePrivada(sa) {
  const cuenta = cuentaValida(sa);
  return cuenta.private_key.includes('\\n')
    ? cuenta.private_key.replace(/\\n/g, '\n')
    : cuenta.private_key;
}

// --- Cocina interna -------------------------------------------------------

/** Acepta un ámbito suelto o una lista y devuelve una lista limpia y ordenada. */
function normalizarAmbitos(ambitos) {
  const crudos = Array.isArray(ambitos) ? ambitos : String(ambitos ?? '').split(/\s+/);
  const limpios = [...new Set(crudos.map((a) => String(a).trim()).filter(Boolean))].sort();
  if (limpios.length === 0) {
    throw new ErrorDeCara(
      'Se ha pedido un permiso de acceso a Google sin decir para qué. Es un fallo del propio estudio, no de tu cuenta.',
      { reintentable: false, http: 500 }
    );
  }
  return limpios;
}

/** Comprueba que la service account trae lo imprescindible para firmar. */
function cuentaValida(sa) {
  if (!sa || typeof sa !== 'object') {
    throw new ErrorDeCara(
      'No hay service account con la que identificarse ante Google. Falta el JSON de la cuenta en la variable de entorno GCP_SERVICE_ACCOUNT.',
      { reintentable: false, http: 500 }
    );
  }
  const faltan = ['client_email', 'private_key'].filter((campo) => !sa[campo]);
  if (faltan.length > 0) {
    throw new ErrorDeCara(
      'El JSON de la service account está incompleto: le falta ' +
        (faltan.length === 2 ? 'el correo de la cuenta y su clave privada' :
          faltan[0] === 'client_email' ? 'el correo de la cuenta' : 'la clave privada') +
        '. Vuelve a pegar en GCP_SERVICE_ACCOUNT el archivo entero que descargaste de Google, sin recortar nada.',
      { reintentable: false, http: 500 }
    );
  }
  return sa;
}

/** Firma el JWT y lo canjea. Devuelve { valor, caducaMs }. */
async function canjear(sa, ambitos) {
  const destino = typeof sa.token_uri === 'string' && sa.token_uri.startsWith('https://')
    ? sa.token_uri
    : CANJE_POR_DEFECTO;

  const aserto = firmarJwt(sa, ambitos, destino);

  const cuerpo = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: aserto
  });

  const aborto = new AbortController();
  const reloj = setTimeout(() => aborto.abort(), LIMITE_CANJE_MS);
  let respuesta;
  try {
    respuesta = await fetch(destino, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: cuerpo.toString(),
      signal: aborto.signal
    });
  } catch (fallo) {
    throw new ErrorDeCara(
      aborto.signal.aborted
        ? 'Google ha tardado demasiado en responder al identificar la service account. No se ha llegado a empezar el trabajo; inténtalo otra vez.'
        : 'No se ha podido contactar con Google para identificar la service account. Puede ser la red; inténtalo otra vez.',
      { detalle: fallo?.message ?? null, reintentable: true, http: 504 }
    );
  } finally {
    clearTimeout(reloj);
  }

  const texto = await respuesta.text();

  if (!respuesta.ok) {
    // El mensaje habla de la service account, que es lo que el usuario puede
    // arreglar. «OAuth» no le dice nada y no le deja hacer nada.
    throw new ErrorDeCara(
      'Google no ha aceptado la service account: ha rechazado su firma al pedir el permiso de acceso. Repasa que GCP_SERVICE_ACCOUNT lleve el JSON entero y sin recortar, que la clave privada no esté caducada ni borrada, y que la cuenta siga activa en el proyecto.',
      { detalle: texto || null, reintentable: esReintentable(respuesta.status), http: respuesta.status }
    );
  }

  let datos;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new ErrorDeCara(
      'Google ha contestado algo que no se entiende al identificar la service account. No se ha obtenido permiso de acceso.',
      { detalle: texto || null, reintentable: true, http: 502 }
    );
  }

  if (!datos?.access_token) {
    throw new ErrorDeCara(
      'Google ha respondido sin entregar el permiso de acceso de la service account. Sin él no se puede tocar nada de tu nube.',
      { detalle: texto || null, reintentable: false, http: 502 }
    );
  }

  const duracionS = Number(datos.expires_in) > 0 ? Number(datos.expires_in) : VIDA_DEL_JWT_S;
  return { valor: datos.access_token, caducaMs: Date.now() + duracionS * 1000 };
}

/** Compone y firma el JWT RS256 con la clave privada de la cuenta. */
function firmarJwt(sa, ambitos, destino) {
  const ahoraS = Math.floor(Date.now() / 1000);

  const cabecera = { alg: 'RS256', typ: 'JWT' };
  if (sa.private_key_id) cabecera.kid = sa.private_key_id;

  const cuerpo = {
    iss: sa.client_email,
    scope: ambitos.join(' '),
    aud: destino,
    iat: ahoraS,
    exp: ahoraS + VIDA_DEL_JWT_S
  };

  const sinFirmar = `${base64url(JSON.stringify(cabecera))}.${base64url(JSON.stringify(cuerpo))}`;

  let firma;
  try {
    firma = createSign('RSA-SHA256').update(sinFirmar).sign(clavePrivada(sa));
  } catch (fallo) {
    throw new ErrorDeCara(
      'La clave privada de la service account no se puede leer: node no la reconoce como una clave válida. Suele pasar cuando el JSON se pegó a medias o se le cambiaron los saltos de línea. Vuelve a pegar el archivo tal cual lo descargaste.',
      { detalle: fallo?.message ?? null, reintentable: false, http: 500 }
    );
  }

  return `${sinFirmar}.${base64url(firma)}`;
}

/** base64 de la web: sin relleno, con «-» y «_» en vez de «+» y «/». */
function base64url(valor) {
  const bruto = Buffer.isBuffer(valor) ? valor : Buffer.from(String(valor), 'utf8');
  return bruto.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
