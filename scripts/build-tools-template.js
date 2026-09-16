// Genera plantilla-herramientas.xlsx: la plantilla para importar en lote
// fixtures, ganchos, manipuladores y demás herramental de proceso.
// Uso: npm run make-template

const path = require('path');
const XLSX = require('xlsx');

const HEADERS = [
  'No. de Parte', 'Descripción', 'Categoría', 'Línea', 'Frecuencia (días)',
  'Técnico Asignado', 'Costo Aproximado (USD)', 'Ubicación', 'Estado'
];

// Filas de ejemplo -- bórralas y pon tus propias herramientas antes de subir
// el archivo. "Categoría" acepta: maquina, herramienta, proceso o equipo.
// "Estado" acepta: activo, en_mantenimiento o baja (si lo dejas vacío se usa "activo").
const SAMPLE_ROWS = [
  ['FX-1042', 'Fixture de ensamble puerta delantera', 'herramienta', 'Línea 1', 30, 'Raúl López', 1850, 'Planta 1', 'activo'],
  ['GC-2031', 'Gancho transportador tipo C', 'herramienta', 'Línea 2', 7, 'Diana Ramos', 260, 'Planta 1', 'activo'],
  ['MN-3010', 'Manipulador neumático de panel', 'maquina', 'Línea 1', 90, 'Raúl López', 6400, 'Planta 1', 'activo'],
  ['HR-4005', 'Torquímetro digital calibrado', 'herramienta', 'Línea 1', 180, 'Raúl López', 950, 'Planta 1', 'activo']
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...SAMPLE_ROWS]);
ws['!cols'] = HEADERS.map((h, i) => ({ wch: i === 1 ? 38 : Math.max(14, h.length + 2) }));
XLSX.utils.book_append_sheet(wb, ws, 'Herramientas');

const outPath = path.join(__dirname, '..', 'plantilla-herramientas.xlsx');
XLSX.writeFile(wb, outPath);
console.log('Plantilla generada en', outPath);
