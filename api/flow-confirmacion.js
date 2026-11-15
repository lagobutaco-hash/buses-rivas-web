const crypto = require("crypto");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Método no permitido");
  }

  try {
    const apiKey = process.env.FLOW_SANDBOX_API_KEY;
    const secretKey = process.env.FLOW_SANDBOX_SECRET_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!apiKey || !secretKey || !supabaseUrl || !serviceKey) {
      throw new Error("Faltan variables de configuración");
    }

    let token = req.body?.token;

    if (typeof req.body === "string") {
      token = new URLSearchParams(req.body).get("token");
    }

    if (!token || typeof token !== "string") {
      return res.status(400).send("Token inválido");
    }

    const parametros = { apiKey, token };

    const textoFirma = Object.keys(parametros)
      .sort()
      .map(clave => `${clave}${parametros[clave]}`)
      .join("");

    const firma = crypto
      .createHmac("sha256", secretKey)
      .update(textoFirma)
      .digest("hex");

    const consulta = new URLSearchParams({
      apiKey,
      token,
      s: firma
    });

    const respuestaFlow = await fetch(
      `https://sandbox.flow.cl/api/payment/getStatus?${consulta.toString()}`
    );

    if (!respuestaFlow.ok) {
      throw new Error("No se pudo consultar el pago en Flow");
    }

    const pago = await respuestaFlow.json();

    if (Number(pago.status) !== 2) {
      return res.status(200).send("Pago todavía no aprobado");
    }

   const comercio = pago.commerceOrder;
const flowOrder = pago.flowOrder;
const monto = Number(pago.amount);

if (
  typeof comercio !== "string" ||
  !comercio ||
  (typeof flowOrder !== "string" && typeof flowOrder !== "number") ||
  !String(flowOrder).trim() ||
  !Number.isFinite(monto) ||
  monto <= 0
) {
  throw new Error("Datos de pago inválidos");
}

const flowOrderValidado = String(flowOrder);

    if (
      !comercio ||
      !flowOrder ||
      !Number.isFinite(monto) ||
      monto <= 0
    ) {
      throw new Error("Datos de pago inválidos");
    }

    const respuestaSupabase = await fetch(
      `${supabaseUrl}/rest/v1/rpc/confirmar_pago_flow`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          p_commerce_order: comercio,
         p_flow_order: flowOrderValidado,
          p_monto: monto
        })
      }
    );

    if (!respuestaSupabase.ok) {
      throw new Error("Supabase no pudo confirmar el pago");
    }

    const resultado = await respuestaSupabase.json();

    if (resultado !== true) {
      throw new Error("El pago no pudo registrarse en la reserva");
    }

    return res.status(200).send("OK");

  } catch (error) {
    console.error("Error confirmando pago Flow:", error.message);
    return res.status(500).send("Error al confirmar el pago");
  }
};
