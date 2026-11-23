
const crypto = require("crypto");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Método no permitido"
    });
  }

  try {
    const apiKey = process.env.FLOW_SANDBOX_API_KEY;
    const secretKey = process.env.FLOW_SANDBOX_SECRET_KEY;

    if (!apiKey || !secretKey) {
      throw new Error("Faltan las credenciales de Flow");
    }

    // Consultar exclusivamente la orden existente
    const flowOrder = "11862936";

    const parametros = {
      apiKey,
      flowOrder
    };

    const textoFirma = Object.keys(parametros)
      .sort()
      .map(clave => `${clave}${parametros[clave]}`)
      .join("");

    const firma = crypto
      .createHmac("sha256", secretKey)
      .update(textoFirma)
      .digest("hex");

    const consulta = new URLSearchParams({
      ...parametros,
      s: firma
    });

    const respuesta = await fetch(
      `https://sandbox.flow.cl/api/payment/getStatusByFlowOrder?${consulta.toString()}`
    );

    const texto = await respuesta.text();

    let pago;

    try {
      pago = JSON.parse(texto);
    } catch {
      throw new Error("Flow devolvió una respuesta no válida");
    }

    if (!respuesta.ok) {
      console.error("Error de Flow:", respuesta.status, pago);
      throw new Error("Flow no pudo consultar la orden");
    }

    return res.status(200).json({
      flowOrder: pago.flowOrder,
      commerceOrder: pago.commerceOrder,
      amount: pago.amount,
      status: pago.status,
      mensaje:
        Number(pago.status) === 2
          ? "Pago aprobado"
          : "Pago todavía no aprobado"
    });

  } catch (error) {
    console.error("Error consultando Flow:", error.message);

    return res.status(500).json({
      error: error.message
    });
  }
};
