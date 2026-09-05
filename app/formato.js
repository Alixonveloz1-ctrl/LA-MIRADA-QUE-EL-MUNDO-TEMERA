// Cómo se escriben los números en la pantalla del teléfono.
//
// Aquí no hay lógica de producción: solo la forma en que un dato se lee de un
// vistazo, a una mano y con luz mala. Reglas de la casa:
//
//   · Coma decimal, que es como se escribe en español. Nunca «4.5 s».
//   · Punto para los miles: 1.200 planos.
//   · Espacio duro entre el número y su unidad, para que «4,5 s» no se parta
//     al final de una línea y quede una «s» huérfana en la siguiente.
//   · Cuando un dato no se ha podido medir se dice con palabras —«sin medir»,
//     «sin fecha»—, nunca con un guion suelto y jamás con un NaN en pantalla.
//   · Nada de toLocaleString: el idioma del teléfono no tiene por qué ser el
//     de la herramienta, y aquí siempre se escribe en español.
//
// docs/contrato.md §12 fija estas cinco funciones y no hay más salidas.

/** Espacio duro (U+00A0): pega el número a su unidad y evita el corte de línea. */
const DURO = ' ';

/** Meses abreviados, en español y en minúscula, como se escriben aquí. */
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
               'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// ---------------------------------------------------------------------------
// Duraciones
// ---------------------------------------------------------------------------

/**
 * Segundos legibles: `segundos(4.5)` → «4,5 s».
 *
 * Por debajo del minuto se escriben en segundos con un decimal, y el decimal
 * desaparece cuando no aporta: 4 → «4 s», 4.5 → «4,5 s». Por encima del minuto
 * se parte, porque un teaser de 78 segundos se entiende antes como «1 min 18 s»
 * que como «78 s», y un episodio de 22 minutos no se lee en segundos.
 *
 * Lo que no se puede medir lo dice con palabras: la duración de un WAV que
 * todavía no existe es «sin medir», no «0 s», que sería mentira.
 */
export function segundos(s) {
  // null no es cero: es que todavía no se ha medido. Un WAV que no existe no
  // dura «0 s», y decirlo sería mentir sobre algo que aún no ha sonado.
  if (s == null || s === '') return 'sin medir';
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 'sin medir';

  if (n < 60) return `${conComa(n, 1)}${DURO}s`;

  const total = Math.round(n);
  const horas = Math.floor(total / 3600);
  const minutos = Math.floor((total % 3600) / 60);
  const resto = total % 60;

  if (horas > 0) {
    return minutos > 0
      ? `${horas}${DURO}h ${minutos}${DURO}min`
      : `${horas}${DURO}h`;
  }
  return resto > 0
    ? `${minutos}${DURO}min ${resto}${DURO}s`
    : `${minutos}${DURO}min`;
}

// ---------------------------------------------------------------------------
// Tamaños
// ---------------------------------------------------------------------------

/**
 * Bytes legibles con coma decimal: 4718592 → «4,5 MB».
 *
 * Se usa en dos sitios que importan: el peso de cada respuesta contra el tope
 * de 4,5 MB (Salud) y el «cuánto pesaba» de un 413, que es la única cifra que
 * explica por qué algo no cabe. Por eso nunca redondea a cero: por debajo del
 * kilobyte se dice en bytes.
 *
 * Un decimal hasta 100, ninguno por encima: «4,5 MB» ayuda, «128,3 MB» no.
 */
export function bytes(n) {
  // Lo mismo que con los segundos: null es «no se ha pesado», no «pesa cero».
  if (n == null || n === '') return 'sin medir';
  const valor = Number(n);
  if (!Number.isFinite(valor) || valor < 0) return 'sin medir';

  if (valor < 1024) {
    const enteros = Math.round(valor);
    return `${conMiles(enteros)}${DURO}${enteros === 1 ? 'byte' : 'bytes'}`;
  }

  const unidades = ['KB', 'MB', 'GB', 'TB'];
  let cantidad = valor / 1024;
  let escalon = 0;
  while (cantidad >= 1024 && escalon < unidades.length - 1) {
    cantidad /= 1024;
    escalon += 1;
  }
  return `${conComa(cantidad, cantidad >= 100 ? 0 : 1)}${DURO}${unidades[escalon]}`;
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/**
 * Fecha relativa y corta: «ahora», «hace 2 min», «hace 3 h», «ayer»,
 * «hace 4 d», y a partir de la semana la fecha seca: «12 mar», «12 mar 2025».
 *
 * En la Cola lo que importa no es la hora exacta a la que se encoló algo, sino
 * cuánto lleva ahí; y en una tarjeta el «hace 2 min» ocupa lo que cabe.
 *
 * Acepta la cadena ISO que guarda el estado, un Date o milisegundos. También
 * mira al futuro, porque una URL firmada caduca en seis horas y hay que poder
 * decir cuándo.
 */
export function fecha(iso) {
  const cuando = aFecha(iso);
  if (!cuando) return 'sin fecha';

  const diferencia = Date.now() - cuando.getTime();
  const futuro = diferencia < 0;
  const seg = Math.round(Math.abs(diferencia) / 1000);

  if (seg < 45) return 'ahora';

  // Se redondea hacia abajo para no adelantar acontecimientos: a los 59
  // minutos y medio se dice «hace 59 min», no «hace 60 min».
  const minutos = Math.max(1, Math.floor(seg / 60));
  if (minutos < 60) return `${futuro ? 'en' : 'hace'} ${minutos}${DURO}min`;

  const horas = Math.max(1, Math.floor(seg / 3600));
  if (horas < 24) return `${futuro ? 'en' : 'hace'} ${horas}${DURO}h`;

  const dias = Math.max(1, Math.floor(seg / 86400));
  if (dias === 1) return futuro ? 'mañana' : 'ayer';
  if (dias < 7) return `${futuro ? 'en' : 'hace'} ${dias}${DURO}d`;

  return fechaSeca(cuando);
}

/** «12 mar», y con el año cuando no es el de hoy: «12 mar 2025». */
function fechaSeca(cuando) {
  const dia = cuando.getDate();
  const mes = MESES[cuando.getMonth()] || '';
  const anio = cuando.getFullYear();
  const esteAnio = new Date().getFullYear();
  return anio === esteAnio
    ? `${dia}${DURO}${mes}`
    : `${dia}${DURO}${mes}${DURO}${anio}`;
}

/** Cualquier forma razonable de escribir un instante → Date, o null. */
function aFecha(valor) {
  if (valor == null || valor === '') return null;
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === 'number') {
    const desdeMs = new Date(valor);
    return Number.isNaN(desdeMs.getTime()) ? null : desdeMs;
  }
  const leida = new Date(String(valor).trim());
  return Number.isNaN(leida.getTime()) ? null : leida;
}

// ---------------------------------------------------------------------------
// Proporciones
// ---------------------------------------------------------------------------

/**
 * Porcentaje entero de `a` sobre `b`: «50 %».
 *
 * Nunca dice «100 %» sin estarlo ni «0 %» habiendo empezado: con 399 planos de
 * 400 escribe «99 %», y con uno solo de 400 escribe «<1 %». Un progreso que
 * canta el pleno antes de tiempo es peor que no tener progreso.
 *
 * Con total cero devuelve «0 %» en vez de un NaN: no hay nada que repartir.
 */
export function porcentaje(a, b) {
  const parte = Number(a);
  const total = Number(b);
  if (!Number.isFinite(parte) || !Number.isFinite(total) || total <= 0) {
    return `0${DURO}%`;
  }

  const bruto = (parte / total) * 100;
  if (bruto > 0 && bruto < 1) return `<1${DURO}%`;
  if (bruto > 99 && bruto < 100) return `99${DURO}%`;

  const acotado = Math.min(100, Math.max(0, bruto));
  return `${Math.round(acotado)}${DURO}%`;
}

// ---------------------------------------------------------------------------
// Plurales
// ---------------------------------------------------------------------------

/**
 * Cantidad y palabra concordadas: `plural(24, 'plano', 'planos')` → «24 planos»,
 * `plural(1, 'plano', 'planos')` → «1 plano», `plural(0, …)` → «0 planos».
 *
 * Devuelve el número delante, que es como se lee: la palabra sola casi nunca
 * sirve, porque el número siempre acompaña.
 */
export function plural(n, uno, varios) {
  const cantidad = Number.isFinite(Number(n)) ? Number(n) : 0;
  const palabra = Math.abs(cantidad) === 1 ? uno : varios;
  const cifra = Number.isInteger(cantidad) ? conMiles(cantidad) : conComa(cantidad, 1);
  return `${cifra}${DURO}${palabra}`;
}

// ---------------------------------------------------------------------------
// Auxiliares: la coma y el punto de los miles
// ---------------------------------------------------------------------------

/**
 * Número con coma decimal y punto de millar, sin ceros de relleno:
 * 4.5 → «4,5»; 4 → «4»; 1234.06 → «1.234,1»; 128.3 con 0 decimales → «128».
 */
function conComa(x, decimales = 1) {
  const n = Number(x);
  if (!Number.isFinite(n)) return '0';

  const fijado = n.toFixed(Math.max(0, decimales));
  const [entera, decimal] = fijado.split('.');
  const conPunto = conMiles(entera);
  if (!decimal) return conPunto;

  const limpia = decimal.replace(/0+$/, '');
  return limpia ? `${conPunto},${limpia}` : conPunto;
}

/** Punto de millar, como se escribe en español: 1200 → «1.200». */
function conMiles(x) {
  const texto = typeof x === 'string' ? x : String(Math.trunc(Number(x) || 0));
  const negativo = texto.startsWith('-');
  const digitos = negativo ? texto.slice(1) : texto;
  const agrupados = digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return negativo ? `-${agrupados}` : agrupados;
}
