const crypto = require("crypto");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }

  try {
    const apiKey = process.env.FLOW_SANDBOX_API_KEY;
    const secretKey = process.env.FLOW_SANDBOX_SECRET_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey || !secretKey || !supabaseUrl || !serviceKey) {
      throw new Error("Faltan variables de configuración");
    }

    const reservaId = Number(req.body?.reserva_id);
    const tokenPago = req.body?.token_pago;

    if (
      !Number.isSafeInteger(reservaId) ||
      reservaId <= 0 ||
      typeof tokenPago !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tokenPago)
    ) {
      return res.status(400).json({ error: "Datos de reserva inválidos" });
    }

    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    };

    const consulta = await fetch(
      `${supabaseUrl}/rest/v1/reservas?id=eq.${reservaId}&token_pago=eq.${encodeURIComponent(tokenPago)}&select=id,estado,email,monto_pagado,saldo_pendiente,monto_abono_requerido`,
      { headers }
    );

   if (!consulta.ok) {
  const detalleConsulta = await consulta.text();

  console.error(
    "Error consultando reserva en Supabase:",
    consulta.status,
    detalleConsulta
  );

  throw new Error(
    `No se pudo consultar la reserva. Código: ${consulta.status}`
  );
}
    }

    const reservas = await consulta.json();
    const reserva = reservas[0];

    if (!reserva || reserva.estado === "cancelada") {
      return res.status(404).json({
        error: "Reserva no encontrada o no autorizada"
      });
    }

    const saldo = Number(reserva.saldo_pendiente || 0);
    const pagado = Number(reserva.monto_pagado || 0);
    const abono = Number(reserva.monto_abono_requerido || 0);

    const monto = Math.min(
      Math.max(0, abono - pagado),
      saldo
    );

    if (!reserva.email || !Number.isFinite(monto) || monto <= 0) {
      return res.status(400).json({
        error: "No hay un abono pendiente válido"
      });
    }

    const origen = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : null;

    if (!origen) {
      throw new Error("No se encontró la dirección del sitio");
    }

    const commerceOrder = crypto.randomUUID();

    const parametros = {
      apiKey,
      commerceOrder,
      subject: `Abono Buses Rivas - Reserva ${reservaId}`,
      email: reserva.email,
      amount: monto,
      urlConfirmation: `${origen}/api/flow-confirmacion`,
      urlReturn: `${origen}/?pago=retorno`
    };

    const textoFirma = Object.keys(parametros)
      .sort()
      .map(clave => `${clave}${parametros[clave]}`)
      .join("");

    const firma = crypto
      .createHmac("sha256", secretKey)
      .update(textoFirma)
      .digest("hex");

    const body = new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(parametros).map(
          ([clave, valor]) => [clave, String(valor)]
        )
      ),
      s: firma
    });

    const registro = await fetch(
      `${supabaseUrl}/rest/v1/flow_pagos`,
      {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          reserva_id: reservaId,
          commerce_order: commerceOrder,
          monto,
          estado: "pendiente"
        })
      }
    );

   if (!registro.ok) {
  const detalleRegistro = await registro.text();

  console.error(
    "Error registrando flow_pagos:",
    registro.status,
    detalleRegistro
  );

  if (registro.status === 409) {
    return res.status(409).json({
      error: "Esta reserva ya tiene un pago en proceso. Intenta nuevamente más tarde."
    });
  }

  throw new Error(
    `No se pudo registrar la orden de pago. Código: ${registro.status}`
  );
}

let respuestaFlow;
    let datosFlow;

    try {
      respuestaFlow = await fetch(
        "https://sandbox.flow.cl/api/payment/create",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body
        }
      );

      datosFlow = await respuestaFlow.json();

    } catch (error) {
      console.error("Error de conexión con Flow:", error.message);

      return res.status(502).json({
        error: "No se pudo confirmar la respuesta de Flow. Revisa el estado antes de intentar otro pago."
      });
    }

     if (
  !respuestaFlow.ok ||
  !datosFlow.url ||
  !datosFlow.token ||
  (typeof datosFlow.flowOrder !== "string" &&
   typeof datosFlow.flowOrder !== "number") ||
  !String(datosFlow.flowOrder).trim()
) {
      const marcarError = await fetch(
        `${supabaseUrl}/rest/v1/flow_pagos?commerce_order=eq.${encodeURIComponent(commerceOrder)}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            estado: "error"
          })
        }
      );

      if (!marcarError.ok) {
        throw new Error("No se pudo actualizar el estado de la orden");
      }

      return res.status(502).json({
        error: "Flow no pudo crear el pago. Puedes intentarlo nuevamente."
      });
    }
    const actualizar = await fetch(
      `${supabaseUrl}/rest/v1/flow_pagos?commerce_order=eq.${encodeURIComponent(commerceOrder)}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          flow_order: String(datosFlow.flowOrder)
        })
      }
    );

    if (!actualizar.ok) {
      throw new Error("No se pudo actualizar la orden de pago");
    }

    return res.status(200).json({
      checkoutUrl: `${datosFlow.url}?token=${datosFlow.token}`
    });

  } catch (error) {
   console.error("Error creando pago Flow:", error);
console.error("Mensaje:", error.message);
console.error("Causa:", error.cause);

    return res.status(500).json({
      error: "No se pudo crear el pago"
    });
  }
};
