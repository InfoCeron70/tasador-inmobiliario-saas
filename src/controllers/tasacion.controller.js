const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const db = require('../database');
const deepseekService = require('../services/deepseek.service');
const calculoService = require('../services/calculo.service');

/**
 * Formatea valores numéricos a pesos chilenos
 */
function formatearCLP(valor) {
  return '$ ' + Math.round(Number(valor) || 0).toLocaleString('es-CL');
}

/**
 * Sanitiza nombres para nombres de archivo seguros
 */
function sanitizarNombre(texto) {
  if (!texto) return 'chile';
  return texto
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Endpoint POST /api/tasacion
 * Realiza el cálculo de tasación con DeepSeek y descuenta 1 crédito del usuario
 */
async function crearTasacion(req, res) {
  try {
    const { inmueble, comparables, configMotor } = req.body;

    // Validación de usuario autenticado
    if (!req.usuario || !req.usuario.id) {
      return res.status(401).json({ error: 'Debes iniciar sesión para realizar tasaciones.' });
    }

    // 1. Verificación de créditos (debe tener > 0)
    const usuarioActual = await db.obtenerUsuarioPorId(req.usuario.id);
    if (!usuarioActual || usuarioActual.creditos <= 0) {
      return res.status(403).json({
        error: 'No tienes créditos suficientes. Contacta al administrador para recargar tu cuenta.',
        sinCreditos: true,
        creditos_actuales: usuarioActual ? usuarioActual.creditos : 0
      });
    }

    // Validación de datos del inmueble
    if (!inmueble) {
      return res.status(400).json({ error: 'Faltan los datos del inmueble a valuar.' });
    }

    const { tipo, superficie_m2, dormitorios, banos, antiguedad, estado_conservacion, comuna } = inmueble;

    if (!tipo || !superficie_m2 || !dormitorios || !banos || antiguedad === undefined || !estado_conservacion || !comuna) {
      return res.status(400).json({
        error: 'Todos los campos obligatorios del inmueble deben ser completados (tipo, superficie_m2, dormitorios, banos, antiguedad, estado_conservacion, comuna).'
      });
    }

    if (Number(superficie_m2) <= 0) {
      return res.status(400).json({ error: 'La superficie en m² debe ser mayor a 0.' });
    }

    // Validación de comparables (2 a 5 comparables requeridos)
    if (!comparables || !Array.isArray(comparables) || comparables.length < 2 || comparables.length > 5) {
      return res.status(400).json({
        error: 'Debe ingresar entre 2 y 5 inmuebles comparables de mercado.'
      });
    }

    for (let i = 0; i < comparables.length; i++) {
      const c = comparables[i];
      if (!c.superficie_m2 || !c.precio_clp || c.distancia_km === undefined) {
        return res.status(400).json({
          error: `El comparable #${i + 1} debe contener superficie_m2, precio_clp y distancia_km válidos.`
        });
      }
      if (Number(c.superficie_m2) <= 0 || Number(c.precio_clp) <= 0) {
        return res.status(400).json({
          error: `El comparable #${i + 1} contiene valores numéricos inválidos.`
        });
      }
    }

    // 2. Descontar 1 crédito al usuario antes de hacer la tasación
    const descuentoExitoso = await db.descontarCredito(req.usuario.id);
    if (!descuentoExitoso) {
      return res.status(403).json({
        error: 'No tienes créditos suficientes. Contacta al administrador para recargar tu cuenta.',
        sinCreditos: true
      });
    }

    // 3. Cálculos matemáticos inmediatos en el servidor (Arquitectura Híbrida con Configuración Personalizada)
    const calculos = calculoService.calcularTasacion(inmueble, comparables, configMotor);

    // 4. Redacción ejecutiva con DeepSeek (Exclusivamente la conclusión técnica)
    const redaccion = await deepseekService.redactarConclusionConDeepSeek(calculos, inmueble, comparables);

    // 5. Estructura JSON final unificada
    const resultadoTasacion = {
      comparables_analisis: calculos.comparables_analisis,
      precio_unitario_promedio: calculos.precio_unitario_promedio,
      valor_referencia: calculos.valor_referencia,
      rango_referencia: calculos.rango_referencia,
      conclusion: redaccion.conclusion,
      advertencias: calculos.advertencias,
      metodologia_y_fuentes: calculos.metodologia_y_fuentes,
      inmueble: {
        ...inmueble,
        direccion: inmueble.direccion || '',
        estacionamiento: inmueble.estacionamiento || 'No',
        bodega: inmueble.bodega || 'No',
        piso: inmueble.piso || null,
        ascensor: inmueble.ascensor || null,
        amenidades: inmueble.amenidades || ''
      }
    };

    const fechaHoy = new Date().toISOString().slice(0, 10);

    // 6. Persistencia en SQLite asociada al usuario_id
    const guardado = await db.guardarTasacion({
      usuario_id: req.usuario.id,
      fecha: fechaHoy,
      comuna: inmueble.comuna,
      tipo_inmueble: inmueble.tipo,
      superficie_m2: Number(inmueble.superficie_m2),
      dormitorios: Number(inmueble.dormitorios),
      banos: Number(inmueble.banos),
      valor_referencia: Number(resultadoTasacion.valor_referencia) || 0,
      precio_unitario_promedio: Number(resultadoTasacion.precio_unitario_promedio) || 0,
      datos_entrada: { inmueble, comparables, configMotor: configMotor || null },
      resultado_ia: resultadoTasacion
    });

    // Consultar saldo restante actualizado
    const usuarioActualizado = await db.obtenerUsuarioPorId(req.usuario.id);

    return res.status(201).json({
      success: true,
      id: guardado.id,
      fecha: fechaHoy,
      datos_entrada: { inmueble, comparables, configMotor: configMotor || null },
      tasacion: resultadoTasacion,
      creditos_restantes: usuarioActualizado ? usuarioActualizado.creditos : 0
    });
  } catch (error) {
    console.error('Error en crearTasacion:', error);
    return res.status(500).json({
      error: 'Ocurrió un error al procesar la tasación: ' + error.message
    });
  }
}

/**
 * Endpoint GET /api/tasaciones
 * Recupera el historial de tasaciones guardadas para el usuario logueado (o todas si es admin)
 */
async function obtenerHistorial(req, res) {
  try {
    const usuarioId = req.usuario ? req.usuario.id : null;
    const esAdmin = req.usuario && (req.usuario.rol === 'admin' || req.usuario.email === 'informatica.full@gmail.com');

    const historial = await db.obtenerHistorial(usuarioId, esAdmin);
    return res.json({
      success: true,
      count: historial.length,
      data: historial
    });
  } catch (error) {
    console.error('Error en obtenerHistorial:', error);
    return res.status(500).json({
      error: 'Error al consultar historial: ' + error.message
    });
  }
}

/**
 * Endpoint GET /api/tasaciones/:id
 * Recupera el detalle completo de una tasación
 */
async function obtenerTasacionPorId(req, res) {
  try {
    const { id } = req.params;
    const registro = await db.obtenerTasacionPorId(id);

    if (!registro) {
      return res.status(404).json({ error: 'Tasación no encontrada.' });
    }

    // Verificar pertenencia si no es admin
    const esAdmin = req.usuario && (req.usuario.rol === 'admin' || req.usuario.email === 'informatica.full@gmail.com');
    if (!esAdmin && req.usuario && registro.usuario_id && registro.usuario_id !== req.usuario.id) {
      return res.status(403).json({ error: 'No tienes permiso para ver esta tasación.' });
    }

    return res.json({
      success: true,
      data: registro
    });
  } catch (error) {
    console.error('Error en obtenerTasacionPorId:', error);
    return res.status(500).json({
      error: 'Error al consultar tasación: ' + error.message
    });
  }
}

/**
 * Endpoint POST /api/exportar/pdf
 * Genera y envía en memoria el informe técnico en PDF
 */
async function exportarPdf(req, res) {
  try {
    const { inmueble, tasacion, comparables } = req.body;

    if (!tasacion || !inmueble) {
      return res.status(400).json({ error: 'Se requieren los datos del inmueble y el resultado de la tasación.' });
    }

    const comunaSafe = sanitizarNombre(inmueble.comuna);
    const fechaStr = new Date().toISOString().slice(0, 10);
    const filename = `tasacion-${comunaSafe}-${fechaStr}.pdf`;

    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
      info: {
        Title: `Informe de Tasación - ${inmueble.comuna}`,
        Author: 'Tasador IA Chile',
        Subject: 'Valuación Comercial Inmobiliaria'
      }
    });

    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(pdfBuffer);
    });

    const usuarioInfo = req.usuario || req.body.usuario || {};
    const nombreUsuario = usuarioInfo.nombre || (usuarioInfo.email ? usuarioInfo.email.split('@')[0] : 'Usuario');
    const rolProfesional = usuarioInfo.rol_profesional || 'Particular';

    // Encabezado corporativo Navy
    doc.rect(40, 40, 515, 75).fill('#0F172A');
    doc.fillColor('#FFFFFF').fontSize(16).font('Helvetica-Bold')
      .text('INFORME TÉCNICO DE TASACIÓN INMOBILIARIA', 55, 52);
    doc.fontSize(9).font('Helvetica')
      .fillColor('#94A3B8')
      .text(`TASADOR IA / CHILE  •  COMUNA: ${(inmueble.comuna || 'CHILE').toUpperCase()}  •  FECHA: ${fechaStr}`, 55, 72);
    doc.fontSize(8.5).font('Helvetica-Bold')
      .fillColor('#38BDF8')
      .text(`Informe generado por: ${nombreUsuario} - ${rolProfesional}`, 55, 88);

    let currentY = 128;

    // Ficha del Inmueble Valuado
    doc.rect(40, currentY, 515, 24).fill('#1E293B');
    doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
      .text('1. ANTECEDENTES DEL INMUEBLE A VALUAR', 50, currentY + 6);

    currentY += 32;

    const esDepto = String(inmueble.tipo || '').toLowerCase().includes('depto') || String(inmueble.tipo || '').toLowerCase().includes('departamento');
    const boxHeight = esDepto ? 96 : 82;
    doc.rect(40, currentY, 515, boxHeight).fill('#F8FAFC').stroke('#E2E8F0');

    doc.fillColor('#334155').fontSize(8.5).font('Helvetica');
    const col1X = 52;
    const col2X = 215;
    const col3X = 375;

    // Fila 1: Tipo, Superficie, Comuna
    doc.font('Helvetica-Bold').text('Tipo:', col1X, currentY + 9)
      .font('Helvetica').text(inmueble.tipo || '-', col1X + 35, currentY + 9);
    doc.font('Helvetica-Bold').text('Superficie Útil:', col2X, currentY + 9)
      .font('Helvetica').text(`${inmueble.superficie_m2} m²`, col2X + 80, currentY + 9);
    doc.font('Helvetica-Bold').text('Comuna:', col3X, currentY + 9)
      .font('Helvetica').text(inmueble.comuna || '-', col3X + 55, currentY + 9);

    // Fila 2: Dormitorios/Baños, Antigüedad/Estado, Estacionamiento/Bodega
    doc.font('Helvetica-Bold').text('Dorm / Baños:', col1X, currentY + 26)
      .font('Helvetica').text(`${inmueble.dormitorios}D / ${inmueble.banos}B`, col1X + 75, currentY + 26);
    doc.font('Helvetica-Bold').text('Antig. / Estado:', col2X, currentY + 26)
      .font('Helvetica').text(`${inmueble.antiguedad}a / ${inmueble.estado_conservacion || '-'}`, col2X + 80, currentY + 26);
    doc.font('Helvetica-Bold').text('Estac. / Bodega:', col3X, currentY + 26)
      .font('Helvetica').text(`${inmueble.estacionamiento || 'No'} / ${inmueble.bodega || 'No'}`, col3X + 85, currentY + 26);

    // Fila 3: Dirección / Sector y P. Estimado
    const dirTexto = inmueble.direccion ? inmueble.direccion : `Sector ${inmueble.comuna || '-'}`;
    doc.font('Helvetica-Bold').text('Dirección:', col1X, currentY + 43)
      .font('Helvetica').text(dirTexto, col1X + 55, currentY + 43, { width: 310, ellipsis: true });
    if (inmueble.precio_referencia) {
      doc.font('Helvetica-Bold').text('P. Ref:', col3X, currentY + 43)
        .font('Helvetica').text(formatearCLP(inmueble.precio_referencia), col3X + 45, currentY + 43);
    }

    // Fila 4: Si es Departamento (Piso y Ascensor) y/o Amenidades
    if (esDepto) {
      doc.font('Helvetica-Bold').text('Piso / Ascensor:', col1X, currentY + 60)
        .font('Helvetica').text(`Piso ${inmueble.piso || '-'} / Ascensor: ${inmueble.ascensor || 'No'}`, col1X + 85, currentY + 60);
      if (inmueble.amenidades) {
        doc.font('Helvetica-Bold').text('Amenidades:', col2X, currentY + 60)
          .font('Helvetica').text(inmueble.amenidades, col2X + 70, currentY + 60, { width: 260, ellipsis: true });
      }
    } else if (inmueble.amenidades) {
      doc.font('Helvetica-Bold').text('Amenidades:', col1X, currentY + 60)
        .font('Helvetica').text(inmueble.amenidades, col1X + 70, currentY + 60, { width: 450, ellipsis: true });
    }

    currentY += boxHeight + 15;

    // Caja de Valor de Referencia (Destacada en azul marino profundo)
    doc.rect(40, currentY, 515, 80).fill('#1E3A8A');
    doc.fillColor('#93C5FD').fontSize(10).font('Helvetica-Bold')
      .text('VALOR COMERCIAL ESTIMADO (REFERENCIA DE MERCADO)', 55, currentY + 12);

    const valRef = formatearCLP(tasacion.valor_referencia);
    doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold')
      .text(valRef + ' CLP', 55, currentY + 28);

    const unitProm = formatearCLP(tasacion.precio_unitario_promedio);
    const rMin = formatearCLP(tasacion.rango_referencia?.min);
    const rMax = formatearCLP(tasacion.rango_referencia?.max);

    doc.fillColor('#E0E7FF').fontSize(9).font('Helvetica')
      .text(`Precio Unitario Promedio: ${unitProm} / m²   |   Rango Referencial: ${rMin} - ${rMax} CLP`, 55, currentY + 58);

    currentY += 95;

    // Tabla de Factores de Ajuste
    doc.rect(40, currentY, 515, 22).fill('#0F172A');
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold')
      .text('2. ANÁLISIS DE COMPARABLES Y FACTORES DE AJUSTE', 50, currentY + 6);

    currentY += 26;

    // Cabecera de la tabla
    doc.rect(40, currentY, 515, 20).fill('#334155');
    doc.fillColor('#FFFFFF').fontSize(8).font('Helvetica-Bold');
    doc.text('Comparable / Factor', 50, currentY + 6, { width: 140 });
    doc.text('P. Unit. Orig.', 200, currentY + 6, { width: 75, align: 'right' });
    doc.text('Factor', 285, currentY + 6, { width: 50, align: 'right' });
    doc.text('P. Unit. Ajust.', 345, currentY + 6, { width: 75, align: 'right' });
    doc.text('Justificación', 430, currentY + 6, { width: 115 });

    currentY += 22;

    const items = tasacion.comparables_analisis || [];
    items.forEach((item, index) => {
      const bgColor = index % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
      doc.rect(40, currentY, 515, 34).fill(bgColor).stroke('#E2E8F0');

      doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold')
        .text(item.nombre || `Comparable ${item.index || index + 1} - Superficie`, 50, currentY + 6, { width: 145 });

      doc.font('Helvetica').fillColor('#334155')
        .text(formatearCLP(item.precio_unitario_original), 200, currentY + 6, { width: 75, align: 'right' });

      doc.font('Helvetica-Bold')
        .text((item.factor_ajuste || 1).toFixed(3), 285, currentY + 6, { width: 50, align: 'right' });

      doc.font('Helvetica')
        .text(formatearCLP(item.precio_unitario_ajustado), 345, currentY + 6, { width: 75, align: 'right' });

      doc.fontSize(7.5).fillColor('#64748B')
        .text(item.justificacion || 'Ajuste de mercado', 430, currentY + 4, { width: 115, height: 26 });

      currentY += 34;
    });

    currentY += 10;

    // Conclusión
    if (tasacion.conclusion) {
      doc.rect(40, currentY, 515, 20).fill('#1E293B');
      doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold')
        .text('3. CONCLUSIÓN TÉCNICA DEL TASADOR', 50, currentY + 5);

      currentY += 24;
      const conclusionHeight = 45;
      doc.rect(40, currentY, 515, conclusionHeight).fill('#F1F5F9').stroke('#CBD5E1');
      doc.fillColor('#1E293B').fontSize(8.5).font('Helvetica')
        .text(tasacion.conclusion, 50, currentY + 6, { width: 495, lineGap: 2 });
      currentY += conclusionHeight + 10;
    }

    // Advertencias en caja ámbar
    if (tasacion.advertencias && tasacion.advertencias.length > 0) {
      const advHeight = Math.min(80, 20 + tasacion.advertencias.length * 14);
      doc.rect(40, currentY, 515, advHeight).fill('#FEF3C7').stroke('#F59E0B');
      doc.fillColor('#92400E').fontSize(9).font('Helvetica-Bold')
        .text('OBSERVACIONES Y ADVERTENCIAS:', 50, currentY + 6);

      let advY = currentY + 20;
      doc.font('Helvetica').fontSize(8).fillColor('#78350F');
      tasacion.advertencias.slice(0, 4).forEach(adv => {
        doc.text(`• ${adv}`, 50, advY, { width: 495 });
        advY += 13;
      });
    }

    // Pie de página
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#64748B')
      .text(`Informe generado por: ${nombreUsuario} - ${rolProfesional}`, 40, 768, { align: 'center', width: 515 });
    doc.fontSize(7.5).font('Helvetica').fillColor('#94A3B8')
      .text('Documento generado automáticamente por Tasador IA Chile con modelo DeepSeek. Valuación con fines orientativos y referenciales.', 40, 782, { align: 'center', width: 515 });

    doc.end();
  } catch (error) {
    console.error('Error en exportarPdf:', error);
    return res.status(500).json({ error: 'Error al generar PDF: ' + error.message });
  }
}

/**
 * Endpoint POST /api/exportar/excel
 * Genera y envía en memoria la planilla Excel detallada
 */
async function exportarExcel(req, res) {
  try {
    const { inmueble, tasacion, comparables } = req.body;

    if (!tasacion || !inmueble) {
      return res.status(400).json({ error: 'Se requieren los datos del inmueble y el resultado de la tasación.' });
    }

    const comunaSafe = sanitizarNombre(inmueble.comuna);
    const fechaStr = new Date().toISOString().slice(0, 10);
    const filename = `tasacion-${comunaSafe}-${fechaStr}.xlsx`;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Tasador IA Chile';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Tasación Inmobiliaria', {
      views: [{ showGridLines: true }]
    });

    sheet.columns = [
      { width: 30 }, // A
      { width: 22 }, // B
      { width: 18 }, // C
      { width: 22 }, // D
      { width: 45 }  // E
    ];

    // Título Principal
    sheet.mergeCells('A1:E1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'INFORME TÉCNICO DE TASACIÓN INMOBILIARIA - CHILE';
    titleCell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 32;

    // Subtítulo
    sheet.mergeCells('A2:E2');
    const subCell = sheet.getCell('A2');
    subCell.value = `Comuna: ${inmueble.comuna} | Fecha de emisión: ${fechaStr} | Motor: DeepSeek AI`;
    subCell.font = { name: 'Arial', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
    subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(2).height = 20;

    // Sección 1: Antecedentes del Inmueble
    sheet.getCell('A4').value = '1. ANTECEDENTES DEL INMUEBLE EVALUADO';
    sheet.getCell('A4').font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } };

    const datosInmueble = [
      ['Tipo de Inmueble', inmueble.tipo || '-'],
      ['Dirección o Sector', inmueble.direccion || 'No especificada'],
      ['Comuna', inmueble.comuna || '-'],
      ['Superficie Útil (m²)', Number(inmueble.superficie_m2) || 0],
      ['Dormitorios', Number(inmueble.dormitorios) || 0],
      ['Baños', Number(inmueble.banos) || 0],
      ['Antigüedad (años)', Number(inmueble.antiguedad) || 0],
      ['Estado de Conservación', inmueble.estado_conservacion || '-'],
      ['Estacionamiento', inmueble.estacionamiento || 'No'],
      ['Bodega', inmueble.bodega || 'No'],
      ...(inmueble.tipo === 'Departamento' ? [
        ['Piso (Departamento)', inmueble.piso ? Number(inmueble.piso) : '-'],
        ['Ascensor en Edificio', inmueble.ascensor || 'No']
      ] : []),
      ['Amenidades / Áreas Comunes', inmueble.amenidades || 'Ninguna especificada'],
      ['Precio Referencial Solicitante (CLP)', Number(inmueble.precio_referencia) || 'No especificado']
    ];

    let rowCursor = 5;
    datosInmueble.forEach(([label, val]) => {
      sheet.getCell(`A${rowCursor}`).value = label;
      sheet.getCell(`A${rowCursor}`).font = { name: 'Arial', bold: true, color: { argb: 'FF334155' } };
      sheet.getCell(`A${rowCursor}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };

      sheet.getCell(`B${rowCursor}`).value = val;
      sheet.getCell(`B${rowCursor}`).font = { name: 'Arial' };
      if (typeof val === 'number' && label.includes('CLP')) {
        sheet.getCell(`B${rowCursor}`).numFmt = '"$"#,##0';
      }
      rowCursor++;
    });

    rowCursor++;

    // Sección 2: Resumen Económico
    sheet.getCell(`A${rowCursor}`).value = '2. RESUMEN DE RESULTADOS Y VALOR DE REFERENCIA';
    sheet.getCell(`A${rowCursor}`).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } };
    rowCursor++;

    sheet.getCell(`A${rowCursor}`).value = 'VALOR COMERCIAL REFERENCIAL (CLP)';
    sheet.getCell(`A${rowCursor}`).font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`A${rowCursor}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };

    sheet.getCell(`B${rowCursor}`).value = Number(tasacion.valor_referencia) || 0;
    sheet.getCell(`B${rowCursor}`).font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getCell(`B${rowCursor}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    sheet.getCell(`B${rowCursor}`).numFmt = '"$"#,##0';
    rowCursor++;

    sheet.getCell(`A${rowCursor}`).value = 'Precio Unitario Promedio Ajustado (CLP/m²)';
    sheet.getCell(`A${rowCursor}`).font = { name: 'Arial', bold: true };
    sheet.getCell(`B${rowCursor}`).value = Number(tasacion.precio_unitario_promedio) || 0;
    sheet.getCell(`B${rowCursor}`).numFmt = '"$"#,##0';
    rowCursor++;

    sheet.getCell(`A${rowCursor}`).value = 'Rango Mínimo Estimado (CLP)';
    sheet.getCell(`B${rowCursor}`).value = Number(tasacion.rango_referencia?.min) || 0;
    sheet.getCell(`B${rowCursor}`).numFmt = '"$"#,##0';
    rowCursor++;

    sheet.getCell(`A${rowCursor}`).value = 'Rango Máximo Estimado (CLP)';
    sheet.getCell(`B${rowCursor}`).value = Number(tasacion.rango_referencia?.max) || 0;
    sheet.getCell(`B${rowCursor}`).numFmt = '"$"#,##0';
    rowCursor += 2;

    // Sección 3: Matriz de Comparables y Factores de Ajuste
    sheet.getCell(`A${rowCursor}`).value = '3. MATRIZ DE COMPARABLES Y FACTORES DE AJUSTE';
    sheet.getCell(`A${rowCursor}`).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } };
    rowCursor++;

    const headers = [
      'Comparable / Factor',
      'Precio Unit. Original',
      'Factor de Ajuste',
      'Precio Unit. Ajustado',
      'Justificación Técnica'
    ];

    headers.forEach((h, idx) => {
      const colLetter = String.fromCharCode(65 + idx);
      const c = sheet.getCell(`${colLetter}${rowCursor}`);
      c.value = h;
      c.font = { name: 'Arial', bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
      c.alignment = { horizontal: idx >= 1 && idx <= 3 ? 'right' : 'left', vertical: 'middle' };
    });
    rowCursor++;

    const items = tasacion.comparables_analisis || [];
    items.forEach((item, idx) => {
      const bg = idx % 2 === 0 ? 'FFF8FAFC' : 'FFFFFFFF';

      sheet.getCell(`A${rowCursor}`).value = item.nombre || `Comparable ${item.index || idx + 1} - Superficie`;
      sheet.getCell(`A${rowCursor}`).font = { name: 'Arial', bold: true };

      sheet.getCell(`B${rowCursor}`).value = Number(item.precio_unitario_original) || 0;
      sheet.getCell(`B${rowCursor}`).numFmt = '"$"#,##0';
      sheet.getCell(`B${rowCursor}`).alignment = { horizontal: 'right' };

      sheet.getCell(`C${rowCursor}`).value = Number(item.factor_ajuste) || 1;
      sheet.getCell(`C${rowCursor}`).numFmt = '0.000';
      sheet.getCell(`C${rowCursor}`).alignment = { horizontal: 'right' };

      sheet.getCell(`D${rowCursor}`).value = Number(item.precio_unitario_ajustado) || 0;
      sheet.getCell(`D${rowCursor}`).numFmt = '"$"#,##0';
      sheet.getCell(`D${rowCursor}`).alignment = { horizontal: 'right' };

      sheet.getCell(`E${rowCursor}`).value = item.justificacion || '';
      sheet.getCell(`E${rowCursor}`).font = { name: 'Arial', italic: true };

      ['A', 'B', 'C', 'D', 'E'].forEach(col => {
        sheet.getCell(`${col}${rowCursor}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        sheet.getCell(`${col}${rowCursor}`).border = {
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
      });

      rowCursor++;
    });

    rowCursor++;

    // Sección 4: Conclusión
    sheet.getCell(`A${rowCursor}`).value = '4. CONCLUSIÓN TÉCNICA DEL TASADOR';
    sheet.getCell(`A${rowCursor}`).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FF0F172A' } };
    rowCursor++;

    sheet.mergeCells(`A${rowCursor}:E${rowCursor + 1}`);
    const concCell = sheet.getCell(`A${rowCursor}`);
    concCell.value = tasacion.conclusion || 'Sin conclusiones adicionales.';
    concCell.font = { name: 'Arial', size: 10 };
    concCell.alignment = { wrapText: true, vertical: 'top' };
    rowCursor += 3;

    // Sección 5: Advertencias
    if (tasacion.advertencias && tasacion.advertencias.length > 0) {
      sheet.getCell(`A${rowCursor}`).value = '5. ADVERTENCIAS Y OBSERVACIONES';
      sheet.getCell(`A${rowCursor}`).font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFB45309' } };
      rowCursor++;

      tasacion.advertencias.forEach(adv => {
        sheet.mergeCells(`A${rowCursor}:E${rowCursor}`);
        const advCell = sheet.getCell(`A${rowCursor}`);
        advCell.value = `• ${adv}`;
        advCell.font = { name: 'Arial', size: 9, color: { argb: 'FF78350F' } };
        advCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        rowCursor++;
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(buffer));
  } catch (error) {
    console.error('Error en exportarExcel:', error);
    return res.status(500).json({ error: 'Error al generar Excel: ' + error.message });
  }
}

module.exports = {
  crearTasacion,
  obtenerHistorial,
  obtenerTasacionPorId,
  exportarPdf,
  exportarExcel
};
