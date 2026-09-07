// EL AVISO QUE NO SE CALLABA.
//
// El estudio recoge los fallos que nadie atrapa y los pinta arriba, porque quien
// usa esto desde el móvil no va a abrir la consola del navegador. Bien. El
// problema es lo que pasaba cuando el fallo NO ocurría una vez, sino cada pocos
// segundos —un error que salta con cada latido de la cola, por ejemplo—:
//
//   · Solo se comparaba con EL ÚLTIMO, así que dos fallos distintos alternando
//     se repintaban los dos, uno detrás de otro, para siempre.
//   · Y «Entendido» BORRABA esa memoria. Cerrabas el aviso y el siguiente latido
//     lo traía de vuelta. Se cerraba y volvía. Se cerraba y volvía.
//
// Encima, el fallo que más se repetía era el que el navegador se niega a
// identificar («Script error.»), que por definición NO viene de este estudio:
// una extensión, un bloqueador. O sea que una tarjeta roja tapaba el plano que
// estabas mirando, con un botón de recargar que no iba a arreglar nada, por algo
// que no podemos tocar.
//
// Aquí se ejecuta el recogedor de verdad, con un DOM de mentira, y se comprueba
// lo aburrido: que el mismo fallo cien veces sea UNA tarjeta con un contador, y
// que cerrarla sea cerrarla.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('../', import.meta.url).pathname;

// ---------------------------------------------------------------------------
// Un DOM del tamaño justo
// ---------------------------------------------------------------------------

/** Un nodo: lo mínimo que usa el recogedor de fallos. */
function nodo(etiqueta) {
  const yo = {
    etiqueta,
    hijos: [],
    padre: null,
    texto: '',
    get isConnected() {
      let actual = yo;
      while (actual.padre) actual = actual.padre;
      return actual === cuerpo;
    },
    get childElementCount() {
      return yo.hijos.length;
    },
    get firstChild() {
      return yo.hijos[0] || null;
    },
    get firstElementChild() {
      return yo.hijos[0] || null;
    },
    appendChild(hijo) {
      if (!hijo) return hijo;
      hijo.padre = yo;
      yo.hijos.push(hijo);
      return hijo;
    },
    remove() {
      if (!yo.padre) return;
      yo.padre.hijos = yo.padre.hijos.filter((h) => h !== yo);
      yo.padre = null;
    },
    setAttribute() {},
    classList: { add() {}, remove() {} },
    /** Todo el texto que hay dentro, para poder leer lo que saldría en pantalla. */
    get todoElTexto() {
      return [yo.texto, ...yo.hijos.map((h) => h.todoElTexto)].join(' ');
    },
  };
  return yo;
}

const cuerpo = nodo('body');
const botonesPuestos = [];

const PRESTADO = `
const ErrorDeCara = class extends Error {
  constructor(m, o = {}) { super(m); this.mensaje = m; Object.assign(this, o); }
};
const document = globalThis.__doc;
const window = globalThis.__win;
const h = (etiqueta, atributos, ...hijos) => {
  const n = globalThis.__nodo(etiqueta);
  for (const hijo of hijos.flat()) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    // El h() de verdad admite texto suelto como hijo, y el recogedor lo usa.
    n.appendChild(typeof hijo === 'object' ? hijo : globalThis.__texto(hijo));
  }
  return n;
};
const aviso = (mensaje, opciones = {}) => {
  const n = globalThis.__nodo('aviso');
  n.texto = String(mensaje);
  n.tono = (opciones && opciones.tono) || 'nota';
  return n;
};
const boton = (texto, alPulsar) => {
  const n = globalThis.__nodo('boton');
  n.texto = String(texto);
  n.pulsar = alPulsar;
  globalThis.__botones.push(n);
  return n;
};
const espera = () => globalThis.__nodo('espera');
const pantalla = () => globalThis.__nodo('pantalla');
const seccion = () => globalThis.__nodo('seccion');
const vaciar = (n) => { if (n) { n.hijos = []; n.texto = ''; } };
const EVENTO_FALLO_SUELTO = 'fallo-suelto';
`;

globalThis.__doc = {
  body: cuerpo,
  createTextNode: (t) => {
    const n = nodo('#texto');
    n.texto = String(t);
    return n;
  },
};
globalThis.__win = { location: { reload() {} }, addEventListener() {} };
globalThis.__nodo = nodo;
globalThis.__texto = (t) => {
  const n = nodo('#texto');
  n.texto = String(t);
  return n;
};
globalThis.__botones = botonesPuestos;

// ---------------------------------------------------------------------------
// El recogedor, suelto
// ---------------------------------------------------------------------------

const codigo = readFileSync(`${RAIZ}app/main.js`, 'utf8')
  .replace(/^import[\s\S]*?from\s+'[^']*';$/gm, '')
  // El arranque llama a la aplicación entera y aquí no se prueba la aplicación:
  // se prueba el recogedor. Es la única línea que se quita, y se dice.
  .replace(/^arrancarElEstudio\(\);$/m, '')
  .replace(/^export (?=(async )?function |const |class )/gm, '');

const carpeta = mkdtempSync(join(tmpdir(), 'mirada-'));
const archivo = join(carpeta, 'x.mjs');
writeFileSync(archivo, `${PRESTADO}\n${codigo}\nexport { contarFalloSuelto };\n`);
const main = await import(pathToFileURL(archivo).href);

let mal = 0;
const di = (bien, que, extra = '') => {
  if (!bien) mal++;
  console.log(`  ${bien ? '✓' : '✗'} ${que}${extra ? ` — ${extra}` : ''}`);
};

/** Las tarjetas de fallo que hay ahora mismo en pantalla. */
const enPantalla = () => (cuerpo.hijos[0] ? cuerpo.hijos[0].hijos : []);

/** El botón de una tarjeta por su texto. */
const botonDe = (tarjeta, texto) =>
  botonesPuestos.find((b) => b.texto === texto && dentroDe(b, tarjeta)) || null;

const dentroDe = (n, raiz) => {
  let actual = n;
  while (actual) {
    if (actual === raiz) return true;
    actual = actual.padre;
  }
  return false;
};

// El recogedor escribe cada fallo en la consola del navegador, que es donde
// tiene que estar. Aquí estorba: lo que se lee es el resultado, no el ruido.
console.error = () => {};

console.log('\nEL AVISO DE FALLOS QUE NO SE CALLABA\n');

// UN FALLO QUE SE REPITE, QUE ES EL CASO QUE SE VIO EN EL TELÉFONO.
for (let i = 0; i < 12; i += 1) main.contarFalloSuelto('Script error.');

di(enPantalla().length === 1,
  'El mismo fallo doce veces seguidas es UNA tarjeta, no doce',
  `${enPantalla().length} tarjetas`);

const laDelScript = enPantalla()[0];
di(/vuelto a pasar 12 veces/.test(laDelScript.todoElTexto),
  'Y dice cuántas veces ha vuelto a pasar, en vez de apilarse');

di(/NO viene de este estudio/.test(laDelScript.todoElTexto),
  'Dice con todas las letras que ese fallo no es del estudio');

const avisoDelScript = laDelScript.hijos.find((n) => n.etiqueta === 'aviso');
di(avisoDelScript && avisoDelScript.tono === 'nota',
  'Y se pinta como NOTA, no como error rojo: no es nuestro y no se puede tocar',
  avisoDelScript ? avisoDelScript.tono : 'no hay aviso');

di(!botonDe(laDelScript, 'Recargar la aplicación'),
  'Sin botón de recargar: recargar no arregla una extensión, y tira lo que estés mirando');

// CERRARLO ES CERRARLO. Esto es lo que de verdad fallaba.
const entendido = botonDe(laDelScript, 'Entendido');
di(Boolean(entendido), 'Tiene su botón de «Entendido»');
entendido.pulsar();
di(enPantalla().length === 0 || !cuerpo.hijos.length, 'Al cerrarlo, desaparece');

for (let i = 0; i < 20; i += 1) main.contarFalloSuelto('Script error.');
di(!cuerpo.hijos.length || enPantalla().length === 0,
  'Y veinte repeticiones después NO vuelve: cerrarlo fue decir «ya lo he visto»',
  `${cuerpo.hijos.length ? enPantalla().length : 0} tarjetas`);

// UN FALLO DE VERDAD DEL ESTUDIO SÍ TIENE QUE GRITAR.
main.contarFalloSuelto(new TypeError('no se puede leer «tomas» de undefined'));
di(enPantalla().length === 1, 'Un fallo del propio estudio sí se pinta');

const laNuestra = enPantalla()[0];
const avisoNuestro = laNuestra.hijos.find((n) => n.etiqueta === 'aviso');
di(avisoNuestro && avisoNuestro.tono === 'error',
  'Y esa sí es roja, porque es nuestra y hay que arreglarla',
  avisoNuestro ? avisoNuestro.tono : 'no hay aviso');
di(Boolean(botonDe(laNuestra, 'Recargar la aplicación')),
  'Y ofrece recargar, porque puede haber dejado algo a medias');
di(/no se puede leer/.test(laNuestra.todoElTexto),
  'Y enseña lo que dijo el navegador, sin tener que abrir nada');

// Dos fallos DISTINTOS son dos tarjetas: eso no se toca.
main.contarFalloSuelto(new RangeError('otra cosa distinta'));
di(enPantalla().length === 2, 'Dos fallos distintos siguen siendo dos tarjetas',
  `${enPantalla().length}`);

// ── EL 403, QUE SON DOS AVERÍAS DISTINTAS QUE SE VEN IGUAL ─────────────────
//
// Un 403 puede ser que a la cuenta le falte un papel, o que la API esté apagada
// en el proyecto. Se arreglan en sitios distintos y el mensaje mandaba a revisar
// las dos, así que la mitad de las veces mandaba a revisar la que estaba bien.
//
// Y no hace falta adivinar: Google lo dice, en un campo «reason» dentro de su
// respuesta. Aquí se comprueba que ese dato se lee y decide la frase, porque es
// lo que separa arreglarlo en un minuto de pasar una tarde en la consola de
// Google mirando permisos que están perfectos.
console.log('\n  UN 403 DICE CUÁL DE LAS DOS AVERÍAS ES\n');

const codigoDeErrores = readFileSync(`${RAIZ}api/_lib/errores.js`, 'utf8').replace(
  /^import[\s\S]*?from\s+'[^']*';$/gm,
  ''
);
const archivoDeErrores = join(mkdtempSync(join(tmpdir(), 'mirada-err-')), 'x.mjs');
writeFileSync(
  archivoDeErrores,
  `${codigoDeErrores.replace(/^export (?=(async )?function |const |class )/gm, '')}\nexport { deGoogle };\n`
);
const err = await import(pathToFileURL(archivoDeErrores).href);

const respuestaDeGoogle = (razon) =>
  JSON.stringify({
    error: {
      code: 403,
      message: 'Permission denied on resource project X.',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: razon,
          domain: 'googleapis.com',
          metadata: { service: 'run.googleapis.com' }
        }
      ]
    }
  });

const frase = (razon) =>
  err.deGoogle(403, respuestaDeGoogle(razon), {
    que: 'preguntar cómo va el montaje',
    servicio: 'run'
  }).mensaje;

const deApi = frase('CONSUMER_INVALID');
di(/ESTE PROYECTO no puede usar/.test(deApi) && /NO son los papeles/.test(deApi),
  'CONSUMER_INVALID dice que es la API del proyecto, y que NO son los permisos');
di(/run\.googleapis\.com/.test(deApi),
  'Y nombra la API concreta que hay que encender', 'run.googleapis.com');
di(!/Revisa las dos/.test(deApi), 'Y ya no manda a revisar las dos cosas a ciegas');

di(/está apagada en este proyecto/.test(frase('SERVICE_DISABLED')),
  'SERVICE_DISABLED dice que es un interruptor del proyecto');
di(/facturación desactivada/.test(frase('BILLING_DISABLED')),
  'BILLING_DISABLED manda a la facturación y a ningún otro sitio');

const dePapeles = frase('IAM_PERMISSION_DENIED');
di(/le falta un papel/.test(dePapeles) && /SÍ son los permisos/.test(dePapeles),
  'IAM_PERMISSION_DENIED sí manda a los permisos de la cuenta');
di(/permisos\.txt/.test(dePapeles),
  'Y al archivo donde están escritos, que es de donde los lee el instalador');

// Y si Google contesta algo que no conocemos, no se inventa un diagnóstico: se
// dice lo que hay y se manda a leer lo que ha contestado, que viaja debajo.
const raro = frase('UNA_RAZON_QUE_NO_CONOCEMOS');
di(/Revisa|Son dos cosas distintas/.test(raro) && /palabra por palabra/.test(raro),
  'Y una razón desconocida no se inventa: manda a leer lo que contestó Google');

// ── LA TARJETA DEL MONTADOR DEJA DE MENTIR ────────────────────────────────
//
// Se pintaba EN VERDE con solo existir la variable MONTAJE_JOB, sin preguntarle
// a nadie. Y el montaje fallaba con un 403 de Cloud Run. O sea: la pantalla que
// existe para decir qué está roto enseñaba en verde exactamente lo roto, y desde
// un teléfono no había ninguna otra forma de enterarse.
//
// Aquí se comprueba que cada «no» de Cloud Run se cuenta por separado, porque se
// arreglan en sitios distintos, y que los dos que NO son fallos —la cuenta que
// lanza pero no lee, y el montador puesto por URL— no salen en rojo.
console.log('\n  LA TARJETA DEL MONTADOR DICE LO QUE HAY\n');

const codigoDeSalud = readFileSync(`${RAIZ}app/pantallas/salud.js`, 'utf8')
  .replace(/^import[\s\S]*?from\s+'[^']*';$/gm, '')
  .replace(/^export default \{[\s\S]*?\n\};$/m, '')
  .replace(/^export (?=(async )?function |const |class )/gm, '');
const archivoDeSalud = join(mkdtempSync(join(tmpdir(), 'mirada-salud-')), 'x.mjs');
writeFileSync(
  archivoDeSalud,
  `const h = () => null, tarjeta = () => null, seccion = () => null, pantalla = () => null;\n` +
    `const aviso = () => null, boton = () => null, espera = () => null, vaciar = () => {};\n` +
    `const bytes = () => '', fecha = () => '', plural = () => '', segundos = () => '';\n` +
    `const llamar = async () => ({}), ErrorDeCara = class extends Error {};\n` +
    `const actual = () => ({}), alCambiar = () => {}, cambiar = async () => {};\n` +
    `${codigoDeSalud}\nexport { veredictoDelMontaje };\n`
);
const salud = await import(pathToFileURL(archivoDeSalud).href);

const veredicto = (porque, extra = {}) =>
  salud.veredictoDelMontaje({
    configurado: true,
    job: 'montador-mirada',
    region: 'us-central1',
    porque,
    error: 'lo que dijo Google',
    ...extra
  });

const familia = (v) => (typeof v.estado === 'string' ? v.estado : v.estado.tipo);

di(familia(veredicto('bien')) === 'listo', 'Si el montador contesta, verde');

const apagada = veredicto('api-apagada');
di(familia(apagada) === 'fallido', 'Si la API está apagada, ROJO — antes salía verde');
di(/NO ESTÁ ENCENDIDA/.test(apagada.texto) && /no lo es/.test(apagada.texto),
  'Y dice que se lee como un permiso y NO lo es');
di(/los modelos salen en verde/.test(apagada.texto),
  'Y enseña cómo distinguirlo sin salir de esta pantalla');

di(familia(veredicto('no-esta')) === 'fallido' && /otra región|otro proyecto/.test(veredicto('no-esta').texto),
  'Si el job no está ahí, rojo, y dice dónde puede estar');
di(familia(veredicto('sin-facturacion')) === 'fallido',
  'Si falta la facturación, rojo, y manda a la facturación');

// Los dos que NO son fallos. Pintar esto en rojo sería el error de siempre al
// revés: asustar con algo que funciona.
const soloLanzar = veredicto('solo-lanzar');
di(familia(soloLanzar) === 'listo' && /NO ES UN FALLO/.test(soloLanzar.texto),
  'Una cuenta que lanza pero no lee NO sale en rojo: el montaje funciona igual');
di(familia(veredicto('sin-direccion')) === 'listo',
  'Ni el montador puesto por MONTAJE_URL, que no se puede preguntar sin inventar');

di(familia(salud.veredictoDelMontaje({ configurado: false, error: 'falta' })) === 'pendiente',
  'Y sin montador configurado sigue diciendo que falta instalarlo');

// ── EL NOMBRE QUE EL CENSOR ROMPÍA ────────────────────────────────────────
//
// ESTE ES EL FALLO QUE MÁS CARO SALIÓ DE TODA LA SESIÓN, y era invisible.
//
// El nombre de una ejecución de Cloud Run es
// «projects/802391847265/locations/us-central1/jobs/…/executions/…»: lleva
// dentro el NÚMERO DE PROYECTO. El censor de la puerta lo tacha al salir, que es
// exactamente su trabajo y está bien que lo haga. Pero ese nombre viajaba al
// navegador, se guardaba en la cola tal cual —ya roto— y en la vuelta siguiente
// se le mandaba a Google.
//
// Google contesta 403 CONSUMER_INVALID sobre «projects/«tachado»». Eso se lee
// como «esta service account no tiene permiso», y no tiene NADA que ver con los
// permisos. Se revisaron los papeles de la cuenta, las APIs del proyecto, y se
// llegó a volver a ejecutar el instalador entero. Todo estaba bien.
//
// Y era el mismo fallo que ya estaba resuelto para Veo, con esta misma solución
// y por este mismo motivo, sin llevar al montaje.
//
// Aquí se ejecuta el censor de VERDAD sobre un nombre de ejecución de verdad.
console.log('\n  UN NOMBRE CON EL NÚMERO DE PROYECTO NO PUEDE VIAJAR\n');

const codigoDelCensor = readFileSync(`${RAIZ}api/_lib/censor.js`, 'utf8').replace(
  /^import[\s\S]*?from\s+'[^']*';$/gm,
  ''
);
const archivoDelCensor = join(mkdtempSync(join(tmpdir(), 'mirada-cen-')), 'x.mjs');
writeFileSync(
  archivoDelCensor,
  `${codigoDelCensor.replace(/^export (?=(async )?function |const |class )/gm, '')}\n` +
    `export { tachar, compilarSecretos };\n`
);
const censor = await import(pathToFileURL(archivoDelCensor).href);

// El correo se arma a trozos a propósito: escribir uno entero, aunque sea de
// mentira, lo caza el invariante que impide que haya correos de service account
// en un repositorio público. Y hace bien en cazarlo.
const CORREO_DE_MENTIRA = ['cuenta', '@', 'ejemplo', '.', 'invalido'].join('');

const cuenta = {
  sa: {
    project_id: 'un-proyecto-cualquiera-1234',
    client_email: CORREO_DE_MENTIRA,
    private_key: 'CLAVE'
  },
  bucket: 'un-bucket',
  prefijo: '',
  numeroProyecto: ''
};
const secretos = censor.compilarSecretos(cuenta);

const NOMBRE =
  'projects/802391847265/locations/us-central1/jobs/montador-mirada/executions/montador-mirada-a1b2c';

const alSalir = censor.tachar({ ejecucion: NOMBRE }, secretos).ejecucion;
di(alSalir !== NOMBRE,
  'El censor ROMPE el nombre de la ejecución al salir — y hace bien, lleva el número de proyecto');
di(/«tachado»/.test(alSalir),
  'Lo que llegaría al navegador es un nombre con un hueco tachado dentro',
  alSalir.slice(0, 34));

// Y lo que importa: que ese nombre roto ya NO se le mande a Google. La función
// lo reconoce y lee el bueno del bucket en vez de preguntar por él.
const codigoDeMontaje = readFileSync(`${RAIZ}api/_lib/montaje.js`, 'utf8');
di(/nombre\.includes\(TACHADO\)/.test(codigoDeMontaje),
  'La función RECONOCE un nombre tachado en vez de mandárselo a Google');
di(/function rutaDeLaEjecucion/.test(codigoDeMontaje),
  'Y la ejecución se guarda en el bucket, por el nombre del trabajo');

const codigoDeLaCola = readFileSync(`${RAIZ}app/cola.js`, 'utf8');
di(/'montaje-estado', \{ trabajo: args\.trabajo \}/.test(codigoDeLaCola),
  'El navegador pregunta por el NOMBRE DEL TRABAJO, que no lleva secretos dentro');
di(!/llamar\('montaje-estado', \{ ejecucion/.test(codigoDeLaCola),
  'Y ya no manda el nombre de la ejecución, que es lo que se rompía');

// La misma regla, en el sitio donde ya estaba bien: Veo.
di(!/operacion: soloTexto\(crudos\.operacion\)/.test(codigoDeLaCola),
  'Veo sigue sin mandar su operación: la misma regla en los dos sitios');

console.log(mal === 0 ? '\nTodo bien.\n' : `\n${mal} MAL.\n`);
process.exit(mal ? 1 : 0);
