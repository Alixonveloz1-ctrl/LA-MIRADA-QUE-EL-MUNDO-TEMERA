// LO QUE HACE FALTA PARA PUBLICAR, COMPROBADO EJECUTÁNDOLO.
//
// La pantalla de Difusión hace dos cosas que no se pueden probar leyendo:
//
//   1. VALIDA LAS ETIQUETAS CONTRA UNA LISTA. El modelo elige de una lista
//      escrita en datos/serie.json y las que se invente se tiran. Si esa criba
//      dejara de funcionar, la ficha saldría con etiquetas que no busca nadie y
//      no habría manera de notarlo: se publica, y no lo ve nadie.
//
//   2. COMPONE UN MANIFIESTO DE PAQUETE. El montador escribe un zip con el
//      vídeo y la ficha dentro, y ese manifiesto lo compone el navegador. Un
//      nombre con una barra ahí dentro escribe fuera de su carpeta al
//      descomprimirlo; dos archivos con el mismo nombre se pisan. Lo comprueban
//      la función Y el montador, y aquí se comprueba que de verdad lo rechazan.
//
// Y una tercera que sí se lee, pero que se rompe callando: que el botón de
// empaquetar no se encienda hasta que hay vídeo Y ficha aprobada. Encendido
// antes de tiempo, encarga un trabajo a la nube que va a fallar a los minutos.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = new URL('../', import.meta.url).pathname;
const serie = JSON.parse(readFileSync(`${RAIZ}datos/serie.json`, 'utf8'));

function suelto(ruta, extra, exporta, apartar = []) {
  let codigo = readFileSync(RAIZ + ruta, 'utf8').replace(
    /^import[\s\S]*?from\s+'[^']*';$/gm,
    ''
  );
  // Las funciones que se sustituyen por una de mentira se apartan cambiándoles
  // el nombre: si no, quedarían las dos declaradas y el módulo ni siquiera carga.
  for (const nombre of apartar) {
    codigo = codigo.replace(
      new RegExp(`^(export )?(async )?function ${nombre}\\(`, 'm'),
      (todo) => todo.replace(nombre, `${nombre}DeVerdad`)
    );
  }
  const carpeta = mkdtempSync(join(tmpdir(), 'mirada-dif-'));
  const archivo = join(carpeta, 'x.mjs');
  const sinExportar = codigo.replace(/^export (?=(async )?function |const |class )/gm, '');
  writeFileSync(archivo, `${extra}\n${sinExportar}\nexport { ${exporta} };\n`);
  return import(pathToFileURL(archivo).href);
}

let mal = 0;
const di = (bien, que, extra = '') => {
  if (!bien) mal++;
  console.log(`  ${bien ? '✓' : '✗'} ${que}${extra ? ` — ${extra}` : ''}`);
};

console.log('\nLO QUE HACE FALTA PARA PUBLICAR\n');

// ── LOS DATOS ──────────────────────────────────────────────────────────────
const difusion = serie.difusion || {};
di(Boolean(difusion.etiquetas && Array.isArray(difusion.etiquetas.lista)),
  'Hay una lista de etiquetas escrita en los datos',
  `${(difusion.etiquetas && difusion.etiquetas.lista || []).length} etiquetas`);

const etiquetas = (difusion.etiquetas && difusion.etiquetas.lista) || [];
di(etiquetas.every((una) => /^[a-z0-9]+$/.test(una)),
  'Todas en minúsculas y sin almohadilla, que es como se guardan',
  etiquetas.filter((una) => !/^[a-z0-9]+$/.test(una)).join(', ') || 'todas bien');

// Que NINGUNA sea de esta serie. Es la regla entera: una etiqueta propia solo la
// busca quien ya conoce el animé, y todavía no lo conoce nadie.
const DE_LA_SERIE = ['mirada', 'temera', 'saharis', 'elserath', 'feyrond', 'vharn'];
const propias = etiquetas.filter((una) => DE_LA_SERIE.some((suya) => una.includes(suya)));
di(propias.length === 0,
  'Y ninguna es de esta serie: son generales, que es lo que la gente busca',
  propias.join(', ') || 'ninguna propia');

// ── LA CRIBA DE ETIQUETAS ──────────────────────────────────────────────────
//
// Se ejecuta `fichaDePieza` de verdad, con un modelo de mentira que contesta lo
// que se le diga. Es la única manera de comprobar que las inventadas se tiran.
console.log('\n  LAS ETIQUETAS QUE SE INVENTA EL MODELO SE TIRAN\n');

globalThis.__respuesta = null;

const txt = await suelto(
  'api/_lib/texto.js',
  `
const serie = ${JSON.stringify({ difusion: serie.difusion, meta: serie.meta, piezas: serie.piezas })};
class ErrorDeCara extends Error { constructor(m, o = {}) { super(m); this.mensaje = m; Object.assign(this, o); } }
const escenaDeGuion = () => ({}), personajesDeEscena = () => [], nivelImagen = () => ({});
const pieza = (id) => {
  const suya = serie.piezas[id];
  if (!suya) throw new ErrorDeCara('no existe la pieza ' + id);
  return suya;
};
const comprobarCupos = () => {};
const entorno = () => ({ sa: { project_id: 'x' } });
const llamar = async () => ({}), urlModelo = () => '', conGrafias = async () => ({}), comoGrafia = (m) => m;
const generar = async () => globalThis.__respuesta;
`,
  'fichaDePieza',
  ['generar']
);

const BUENAS = ['anime', 'seinen', 'darkanime', 'animeespanol', 'animeteaser', 'amv', 'animeost', 'animeedit'];

globalThis.__respuesta = {
  titulo: 'La mirada que el mundo temerá — Teaser',
  descripcion: 'Un niño que no llora.',
  etiquetas: [...BUENAS, 'lamiradaqueelmundotemera', '#saharis', 'inventadadelaire']
};

const ficha = await txt.fichaDePieza('teaser');
di(ficha.etiquetas.length === BUENAS.length,
  'Las de la lista pasan y las inventadas se quedan fuera',
  `${ficha.etiquetas.length} de ${globalThis.__respuesta.etiquetas.length} propuestas`);
di(!ficha.etiquetas.some((una) => /mirada|saharis|inventada/.test(una)),
  'Ninguna inventada se cuela', ficha.etiquetas.join(' '));
di(ficha.etiquetas.every((una) => !una.startsWith('#')),
  'Y se guardan sin almohadilla, aunque el modelo la ponga');

// Una ficha que vuelve casi sin etiquetas NO se da por buena: publicada así, no
// la ve nadie, y eso no se nota hasta que no la ve nadie.
globalThis.__respuesta = { titulo: 'X', descripcion: 'Y', etiquetas: ['anime', 'seinen'] };
try {
  await txt.fichaDePieza('teaser');
  di(false, 'Una ficha con dos etiquetas se rechaza');
} catch (fallo) {
  di(fallo.reintentable === true, 'Una ficha con muy pocas etiquetas se rechaza y se vuelve a pedir');
}

globalThis.__respuesta = { titulo: '', descripcion: 'Y', etiquetas: BUENAS };
try {
  await txt.fichaDePieza('teaser');
  di(false, 'Una ficha sin título se rechaza');
} catch (fallo) {
  di(fallo.reintentable === true, 'Una ficha sin título se rechaza: sin título no se sube nada');
}

// ── EL MANIFIESTO DEL PAQUETE ──────────────────────────────────────────────
console.log('\n  EL ZIP QUE SE ENCARGA\n');

const mnt = await suelto(
  'api/_lib/montaje.js',
  `
const serie = ${JSON.stringify({ formato: serie.formato })};
class ErrorDeCara extends Error { constructor(m, o = {}) { super(m); this.mensaje = m; Object.assign(this, o); } }
const entorno = () => ({ bucket: 'x', prefijo: '' });
const escribir = async () => {}, leer = async () => null, listar = async () => [], borrar = async () => {};
const llamar = async () => ({}), urlServicio = () => '';
`,
  'validarManifiesto'
);

const bueno = {
  trabajo: 'difusion-teaser',
  salida: 'difusion/teaser/teaser.zip',
  empaquetar: {
    archivos: [
      { nombre: 'teaser.mp4', origen: 'montaje/teaser/teaser.mp4' },
      { nombre: 'ficha.txt', texto: 'TÍTULO\nLo que sea\n' }
    ]
  }
};

try {
  di(mnt.validarManifiesto(bueno) === 'difusion-teaser',
    'Un paquete bien escrito se acepta, sin pedirle capa ni formato');
} catch (fallo) {
  di(false, 'Un paquete bien escrito se acepta, sin pedirle capa ni formato', fallo.mensaje);
}

const rechaza = (que, cambio) => {
  const roto = JSON.parse(JSON.stringify(bueno));
  cambio(roto);
  try {
    mnt.validarManifiesto(roto);
    di(false, que);
  } catch (fallo) {
    di(true, que, (fallo.mensaje || '').split('\n').slice(1, 2).join('').trim().slice(0, 70));
  }
};

rechaza('Un nombre con barra dentro del zip se rechaza: escribiría fuera de su carpeta',
  (m) => { m.empaquetar.archivos[0].nombre = '../fuera.mp4'; });
rechaza('Dos archivos con el mismo nombre se rechazan: uno pisaría al otro',
  (m) => { m.empaquetar.archivos[1].nombre = 'teaser.mp4'; });
rechaza('Un archivo que no dice de dónde sale se rechaza',
  (m) => { delete m.empaquetar.archivos[0].origen; });
rechaza('Un archivo que dice las dos cosas a la vez se rechaza',
  (m) => { m.empaquetar.archivos[0].texto = 'y además esto'; });
rechaza('Una salida que no acaba en .zip se rechaza',
  (m) => { m.salida = 'difusion/teaser/teaser.mp4'; });
rechaza('Un paquete vacío se rechaza',
  (m) => { m.empaquetar.archivos = []; });
rechaza('Un origen que no es una ruta lógica del bucket se rechaza',
  (m) => { m.empaquetar.archivos[0].origen = 'https://algo/fuera.mp4'; });

// Y que un montaje normal siga entrando por su camino de siempre.
try {
  mnt.validarManifiesto({ trabajo: 'x', salida: 'y.mp4', capa: 'pieza' });
  di(false, 'Un montaje sin planos sigue rechazándose');
} catch (fallo) {
  di(/no trae ni un solo plano|formato/.test(fallo.mensaje || ''),
    'Un montaje normal sigue pasando por sus propias reglas');
}

// ── CUÁNDO SE PUEDE EMPAQUETAR ─────────────────────────────────────────────
console.log('\n  EL BOTÓN NO SE ENCIENDE ANTES DE TIEMPO\n');

const dif = await suelto(
  'app/pantallas/difusion.js',
  `
const ErrorDeCara = class extends Error {}, llamar = async () => ({});
const actual = () => ({}), alCambiar = () => {}, cambiar = async () => {};
const encolar = () => {};
const aviso = () => null, boton = () => null, confirmar = async () => true;
const espera = () => null, h = () => null, pantalla = () => null, seccion = () => null;
const tarjeta = () => null, vaciar = () => {};
const bytes = () => '', fecha = () => '', plural = () => '';
`,
  'porQueNoSePuedeEmpaquetar, fichaEnTexto, piezasQueSePublican, paqueteDe'
);

const conFicha = { ficha: { titulo: 'T', descripcion: 'D', etiquetas: ['anime'] }, ficha_aprobada: true };
const montado = { ruta: 'montaje/teaser/teaser.mp4', cuando: '2026-09-06T10:00:00Z' };

di(dif.porQueNoSePuedeEmpaquetar(conFicha, montado, null) === null,
  'Con vídeo y ficha aprobada, se puede');
di(typeof dif.porQueNoSePuedeEmpaquetar(conFicha, null, null) === 'string',
  'Sin vídeo, no: y lo dice con palabras');
di(typeof dif.porQueNoSePuedeEmpaquetar({ ficha: null, ficha_aprobada: false }, montado, null) === 'string',
  'Sin ficha, tampoco');
di(typeof dif.porQueNoSePuedeEmpaquetar({ ...conFicha, ficha_aprobada: false }, montado, null) === 'string',
  'Y con la ficha sin aprobar, tampoco: con ella se sube el vídeo');
di(typeof dif.porQueNoSePuedeEmpaquetar(conFicha, montado, { estado: 'en_curso' }) === 'string',
  'Ni dos veces a la vez');

// El archivo de planos de ambiente NO se publica: no se sube a ninguna parte.
const paraPublicar = dif.piezasQueSePublican(serie).map((una) => una.id);
di(!paraPublicar.includes('archivo'),
  'El archivo de planos de ambiente no sale aquí: no se sube a ninguna parte',
  paraPublicar.join(', '));

// La ficha en texto: lo que de verdad se copia y se pega desde el móvil.
const enTexto = dif.fichaEnTexto(
  { id: 'teaser' },
  { titulo: 'Un título', descripcion: 'Dos\nlíneas', etiquetas: ['anime', 'seinen'] }
);
di(/^TÍTULO\nUn título/.test(enTexto), 'La ficha en texto empieza por el título, para copiarlo de un gesto');
di(/#anime #seinen/.test(enTexto), 'Y las etiquetas salen con su almohadilla, listas para pegar');
di(/Dos\nlíneas/.test(enTexto), 'Y la descripción conserva sus saltos de línea');

console.log(mal === 0 ? '\nTodo bien.\n' : `\n${mal} MAL.\n`);
process.exit(mal ? 1 : 0);
