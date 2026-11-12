/**
 * Servicio de Notificaciones por Correo Electrónico (Gmail API con OAuth 2.0 y Nodemailer)
 * Gestiona el envío de confirmación de recarga al cliente y notificación de venta al administrador.
 */

const nodemailer = require('nodemailer');

/**
 * Crea y retorna el transporte de Nodemailer configurado con Gmail y OAuth 2.0.
 * Si las credenciales no están completas o contienen las plantillas, retorna null de forma segura.
 */
function obtenerTransporte() {
  const user = process.env.GMAIL_USER || process.env.ADMIN_EMAIL || 'informatica.full@gmail.com';
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || '';
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN || '';

  // Validación de credenciales activas
  if (
    !clientId || clientId.trim() === '' || clientId.includes('tu_gmail_client_id') ||
    !clientSecret || clientSecret.trim() === '' || clientSecret.includes('tu_gmail_client_secret') ||
    !refreshToken || refreshToken.trim() === '' || refreshToken.includes('tu_gmail_refresh_token')
  ) {
    return null;
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      type: 'OAuth2',
      user: user.trim(),
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim(),
      refreshToken: refreshToken.trim()
    }
  });
}

/**
 * Envía las dos notificaciones tras la recarga manual de créditos:
 * 1. Correo al Cliente confirmando la recarga
 * 2. Correo al Administrador con el detalle de la venta
 * 
 * @param {Object} datos
 * @param {string} datos.clienteEmail Correo del usuario recargado
 * @param {number} datos.creditos Cantidad de créditos asignados
 * @param {string} [datos.packNombre] Nombre del pack asignado
 * @param {string} [datos.packMonto] Monto en CLP del pack
 * @returns {Promise<Object>} Resultado del envío sin interrumpir el flujo principal
 */
async function enviarNotificacionesRecarga({ clienteEmail, creditos, packNombre, packMonto }) {
  const adminEmail = process.env.GMAIL_USER || process.env.ADMIN_EMAIL || 'informatica.full@gmail.com';
  const nombrePackFinal = packNombre || `Pack de ${creditos} Crédito(s)`;
  const montoFinal = packMonto || (
    creditos === 1 ? '$20.000 CLP' :
    creditos === 3 ? '$45.000 CLP' :
    creditos === 5 ? '$70.000 CLP' :
    `$${(creditos * 15000).toLocaleString('es-CL')} CLP`
  );

  const transporter = obtenerTransporte();

  if (!transporter) {
    console.log(`[Email Service Gmail OAuth2] Omitiendo envío: Credenciales de Gmail OAuth2 incompletas en .env. (Cliente: ${clienteEmail}, Créditos: ${creditos})`);
    return {
      enviado: false,
      motivo: 'Credenciales de Gmail OAuth2 (GMAIL_CLIENT_SECRET o GMAIL_REFRESH_TOKEN) aún no configuradas en .env.'
    };
  }

  // 1. Mensaje para el Cliente
  const mailOptionsCliente = {
    from: `"Tasador IA Chile" <${adminEmail}>`,
    to: clienteEmail,
    replyTo: adminEmail,
    subject: '✅ Recarga Exitosa - Tasador IA',
    text: `Hola, hemos confirmado tu pago. Se han añadido ${creditos} créditos a tu cuenta (Pack: ${nombrePackFinal}). Ya puedes seguir utilizando la plataforma. ¡Gracias por tu compra!`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; background-color: #0f172a; color: #f8fafc; border-radius: 16px; overflow: hidden; border: 1px solid #1e293b;">
        <div style="background-color: #10b981; padding: 24px; text-align: center;">
          <h1 style="margin: 0; color: #042f2e; font-size: 22px; font-weight: 800;">¡Recarga Exitosa!</h1>
          <p style="margin: 4px 0 0 0; color: #064e3b; font-size: 13px; font-weight: 600;">Tasador Inmobiliario IA / Chile</p>
        </div>
        
        <div style="padding: 28px 24px;">
          <p style="font-size: 15px; color: #e2e8f0; line-height: 1.6; margin-top: 0;">
            Hola, hemos confirmado tu pago correctamente.
          </p>
          
          <div style="background-color: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 18px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse; font-size: 13px; color: #cbd5e1;">
              <tr>
                <td style="padding: 6px 0; color: #94a3b8;">Pack Asignado:</td>
                <td style="padding: 6px 0; font-weight: bold; color: #ffffff; text-align: right;">${nombrePackFinal}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #94a3b8;">Créditos Añadidos:</td>
                <td style="padding: 6px 0; font-weight: 800; color: #34d399; font-size: 16px; text-align: right;">+${creditos} informe(s)</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #94a3b8;">Cuenta:</td>
                <td style="padding: 6px 0; font-weight: bold; color: #ffffff; text-align: right;">${clienteEmail}</td>
              </tr>
            </table>
          </div>

          <p style="font-size: 14px; color: #cbd5e1; line-height: 1.6;">
            Se han añadido <strong>${creditos} créditos</strong> a tu cuenta. Ya puedes seguir utilizando la plataforma para generar tasaciones y exportar informes técnicos en PDF y Excel.
          </p>

          <div style="text-align: center; margin: 28px 0 16px 0;">
            <a href="http://localhost:3001" style="background-color: #10b981; color: #022c22; text-decoration: none; padding: 12px 28px; border-radius: 10px; font-weight: 700; font-size: 14px; display: inline-block;">
              Ingresar al Tasador IA
            </a>
          </div>

          <p style="font-size: 12px; color: #64748b; text-align: center; margin-top: 24px;">
            ¡Muchas gracias por tu compra y confianza en Tasador IA Chile!
          </p>
        </div>
      </div>
    `
  };

  // 2. Mensaje para el Administrador
  const mailOptionsAdmin = {
    from: `"Tasador IA Ventas" <${adminEmail}>`,
    to: adminEmail,
    subject: `🔔 Nueva Venta: ${creditos} créditos asignados`,
    text: `Se ha recargado la cuenta de ${clienteEmail} con el Pack: ${nombrePackFinal}. Monto estimado: ${montoFinal}. Transacción registrada.`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 580px; margin: 0 auto; background-color: #ffffff; color: #0f172a; border-radius: 14px; border: 1px solid #e2e8f0; padding: 24px;">
        <h2 style="color: #4f46e5; margin-top: 0; font-size: 18px;">🔔 Notificación de Venta Registrada</h2>
        <p style="font-size: 14px; color: #334155; line-height: 1.5;">
          Se ha completado la asignación manual de créditos desde el Panel de Administración:
        </p>
        <ul style="font-size: 13px; color: #1e293b; line-height: 1.8; background-color: #f8fafc; padding: 16px 24px; border-radius: 10px; border: 1px solid #e2e8f0;">
          <li><strong>Cliente:</strong> ${clienteEmail}</li>
          <li><strong>Pack:</strong> ${nombrePackFinal}</li>
          <li><strong>Créditos asignados:</strong> +${creditos}</li>
          <li><strong>Monto estimado:</strong> ${montoFinal}</li>
          <li><strong>Fecha y hora:</strong> ${new Date().toLocaleString('es-CL')}</li>
        </ul>
        <p style="font-size: 12px; color: #64748b; margin-bottom: 0;">
          Transacción registrada en la base de datos de Tasador IA.
        </p>
      </div>
    `
  };

  let clienteEnviado = false;
  let adminEnviado = false;
  let detalleErrores = [];

  // Enviar al cliente
  try {
    const infoCliente = await transporter.sendMail(mailOptionsCliente);
    clienteEnviado = true;
    console.log(`[Email Service Gmail OAuth2] Correo enviado a cliente (${clienteEmail}). MessageId: ${infoCliente.messageId}`);
  } catch (errCliente) {
    console.warn('[Email Service Gmail OAuth2] Error al enviar a cliente:', errCliente.message);
    detalleErrores.push(`Cliente: ${errCliente.message}`);
  }

  // Enviar al administrador
  try {
    const infoAdmin = await transporter.sendMail(mailOptionsAdmin);
    adminEnviado = true;
    console.log(`[Email Service Gmail OAuth2] Correo enviado a admin (${adminEmail}). MessageId: ${infoAdmin.messageId}`);
  } catch (errAdmin) {
    console.warn('[Email Service Gmail OAuth2] Error al enviar a admin:', errAdmin.message);
    detalleErrores.push(`Admin: ${errAdmin.message}`);
  }

  return {
    enviado: clienteEnviado || adminEnviado,
    clienteEnviado,
    adminEnviado,
    motivo: detalleErrores.length > 0 ? detalleErrores.join(' | ') : null
  };
}

module.exports = {
  obtenerTransporte,
  enviarNotificacionesRecarga
};
