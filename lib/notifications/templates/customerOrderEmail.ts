import type { OrderNotificationData } from "../types";
import type { RenderedEmail } from "./orderEmails";
import {
  brand,
  ctaButton,
  esc,
  FONT_STACK,
  formatCRC,
  formatDateTime,
  orderHandle,
} from "./layout";

/**
 * Context the customer confirmation needs beyond the order itself — links and
 * support details that live in config, injected by the notifier so this module
 * stays a pure renderer.
 */
export interface CustomerEmailContext {
  /** Token-authed link to the customer's own order page. */
  viewOrderUrl: string;
  /** Public storefront URL. */
  siteUrl: string;
  /** Support inbox shown in the footer. */
  supportEmail: string;
}

/**
 * Customer-facing order confirmation, sent right after purchase.
 *
 * Spanish copy (customer-facing). The payment-status half is CONDITIONAL on the
 * method (per the business rules):
 *   • Card  → "Confirmado / Pagado" + a payment-received message.
 *   • SINPE → "Pago pendiente de verificación" + a complete-your-transfer message.
 *   • other → the same pending status, but WITHOUT naming a payment method.
 *
 * That third branch exists for orders an admin records by hand (WhatsApp, phone,
 * in person): they carry no payment provider, and telling such a customer to
 * "complete your SINPE transfer" would instruct them to do something nobody
 * agreed to. Everything else about the email is identical.
 *
 * Dark, elegant Krov styling with explicit colors + `color-scheme` so it renders
 * consistently in both light- and dark-mode email clients. Every dynamic value
 * is escaped via esc().
 */
export function renderCustomerOrderConfirmationEmail(
  data: OrderNotificationData,
  ctx: CustomerEmailContext
): RenderedEmail {
  const handle = orderHandle(data.orderNumber);
  const isCard = data.paymentMethod === "card";

  const subject = `Confirmación de pedido #${handle} - Krov Perfumería`;

  const statusLabel = isCard
    ? "Confirmado / Pagado"
    : "Pago pendiente de verificación";
  const statusColor = isCard ? brand.green : brand.amber;
  const methodLabel = isCard
    ? "Tarjeta de crédito/débito"
    : data.paymentMethod === "sinpe"
      ? "SINPE Móvil"
      : "Por coordinar con la tienda";
  const totalLabel = isCard ? "Total pagado" : "Total por pagar";

  const message = isCard
    ? "¡Gracias por tu compra! Recibimos tu pago correctamente y ya estamos preparando tu pedido."
    : data.paymentMethod === "sinpe"
      ? "¡Gracias por tu pedido! Tu pago por SINPE Móvil está marcado como PENDIENTE. Por favor completa la transferencia y envíanos el número de comprobante si aún no lo has hecho. Nuestro equipo lo verificará pronto para procesar tu pedido."
      : "¡Gracias por tu pedido! Lo registramos con el pago PENDIENTE. Coordinaremos contigo el método y la confirmación del pago para procesarlo. Si algún dato de este resumen no coincide con lo que acordamos, escríbenos y lo corregimos.";

  const body =
    messageBlock(message, statusColor) +
    overviewPanel(data, handle, methodLabel, statusLabel, statusColor) +
    itemsPanel(data) +
    summaryPanel(data, totalLabel, statusColor) +
    shippingPanel(data) +
    ctaButton(ctx.viewOrderUrl, "Ver mi pedido");

  const html = wrapCustomerEmail({
    accent: statusColor,
    preheader: subject,
    firstName: firstName(data.customer.name),
    body,
    ctx,
  });

  return { subject, html, text: buildText(data, handle, methodLabel, statusLabel, totalLabel, message, ctx) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Sections
// ─────────────────────────────────────────────────────────────────────────────

function messageBlock(message: string, accent: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:${accent}14;border:1px solid ${accent}55;border-radius:10px;margin:0 0 18px 0;">` +
    `<tr><td style="padding:16px 18px;color:${brand.text};font-size:14px;line-height:1.65;">${esc(
      message
    )}</td></tr></table>`
  );
}

function overviewPanel(
  data: OrderNotificationData,
  handle: string,
  methodLabel: string,
  statusLabel: string,
  statusColor: string
): string {
  const rows =
    row("Número de pedido", esc(handle)) +
    row("Fecha", esc(formatDateTime(data.createdAt))) +
    row("Método de pago", esc(methodLabel)) +
    row("Estado del pago", pill(statusLabel, statusColor));
  return panel("Resumen del pedido", table(rows));
}

function itemsPanel(data: OrderNotificationData): string {
  const header =
    `<tr>` +
    th("Producto", "left") +
    th("Cant.", "center") +
    th("Precio unit.", "right") +
    `</tr>`;

  const rows = data.items
    .map((item) => {
      const size =
        item.productType === "decant"
          ? `Decant · ${esc(item.sizeMl)} ml`
          : item.productType === "set"
            ? "Set"
            : `${esc(item.sizeMl)} ml`;
      const name =
        `<div style="color:${brand.text};font-weight:600;">${esc(
          item.brandName
        )} — ${esc(item.productName)}</div>` +
        `<div style="color:${brand.muted};font-size:12px;margin-top:2px;">${size}</div>`;
      return (
        `<tr>` +
        `<td style="padding:10px 0;border-bottom:1px solid ${brand.border};vertical-align:top;">${name}</td>` +
        `<td align="center" style="padding:10px 0;border-bottom:1px solid ${brand.border};vertical-align:top;color:${brand.text};font-weight:600;">${esc(
          item.quantity
        )}</td>` +
        `<td align="right" style="padding:10px 0 10px 8px;border-bottom:1px solid ${brand.border};vertical-align:top;color:${brand.text};font-weight:600;white-space:nowrap;">${esc(
          formatCRC(item.unitPrice)
        )}</td>` +
        `</tr>`
      );
    })
    .join("");

  return panel(
    "Artículos comprados",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-size:13px;">${header}${rows}</table>`
  );
}

function summaryPanel(
  data: OrderNotificationData,
  totalLabel: string,
  accent: string
): string {
  const rows =
    summaryRow("Subtotal", formatCRC(data.subtotal), brand.muted) +
    (data.discount > 0
      ? summaryRow("Descuento", `- ${formatCRC(data.discount)}`, brand.muted)
      : "") +
    summaryRow(
      "Envío",
      data.shippingCost > 0 ? formatCRC(data.shippingCost) : "Gratis",
      brand.muted
    ) +
    summaryRow(totalLabel, formatCRC(data.total), accent, true);
  return panel(
    "Resumen de pago",
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`
  );
}

function shippingPanel(data: OrderNotificationData): string {
  const s = data.shipping;
  const rows =
    row("Destinatario", esc(data.customer.name)) +
    row("Teléfono", esc(data.customer.phone)) +
    row(
      "Dirección",
      `${esc(s.address)}<br>${esc(s.district)}, ${esc(s.canton)}, ${esc(
        s.province
      )}`
    ) +
    (s.reference ? row("Indicaciones", esc(s.reference)) : "");
  return panel("Dirección de envío", table(rows));
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell + primitives
// ─────────────────────────────────────────────────────────────────────────────

function wrapCustomerEmail(opts: {
  accent: string;
  preheader: string;
  firstName: string;
  body: string;
  ctx: CustomerEmailContext;
}): string {
  const { ctx } = opts;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(opts.preheader)}</title>
</head>
<body style="margin:0;padding:0;background:${brand.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${brand.bg};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:${brand.panel};border:1px solid ${brand.border};border-radius:14px;overflow:hidden;font-family:${FONT_STACK};">
      <tr><td style="height:4px;background:${opts.accent};font-size:0;line-height:0;">&nbsp;</td></tr>
      <!-- header -->
      <tr><td style="padding:32px 32px 8px 32px;text-align:center;">
        <div style="font-size:26px;font-weight:800;letter-spacing:.30em;color:${brand.text};">KROV</div>
        <div style="font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:${brand.muted};margin-top:4px;">Perfumería</div>
      </td></tr>
      <tr><td style="padding:16px 32px 4px 32px;text-align:center;">
        <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:800;color:${brand.text};">¡Gracias${opts.firstName ? `, ${esc(opts.firstName)}` : ""}!</h1>
        <p style="margin:8px 0 0 0;color:${brand.muted};font-size:14px;line-height:1.6;">Hemos recibido tu pedido. Aquí están los detalles de tu compra.</p>
      </td></tr>
      <!-- body -->
      <tr><td style="padding:20px 32px 8px 32px;color:${brand.text};font-size:14px;line-height:1.6;">
        ${opts.body}
      </td></tr>
      <!-- footer -->
      <tr><td style="padding:24px 32px 30px 32px;border-top:1px solid ${brand.border};text-align:center;">
        <p style="margin:0 0 6px 0;color:${brand.text};font-size:13px;font-weight:600;">¿Necesitas ayuda con tu pedido?</p>
        <p style="margin:0 0 12px 0;color:${brand.muted};font-size:13px;line-height:1.6;">
          Escríbenos a <a href="mailto:${esc(ctx.supportEmail)}" style="color:${brand.redSoft};text-decoration:none;">${esc(ctx.supportEmail)}</a>
        </p>
        <p style="margin:0;font-size:12px;">
          <a href="${esc(ctx.siteUrl)}" style="color:${brand.muted};text-decoration:none;">Ir a la tienda</a>
          &nbsp;·&nbsp;
          <a href="${esc(ctx.viewOrderUrl)}" style="color:${brand.muted};text-decoration:none;">Seguir mi pedido</a>
        </p>
        <p style="margin:16px 0 0 0;color:${brand.muted};font-size:11px;line-height:1.6;">
          © Krov Perfumería · Costa Rica<br>Recibes este correo porque realizaste un pedido con nosotros.
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function panel(title: string, innerHtml: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="background:${brand.panelAlt};border:1px solid ${brand.border};border-radius:10px;margin:0 0 16px 0;">` +
    `<tr><td style="padding:16px 18px;">` +
    `<div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${brand.muted};margin-bottom:10px;">${esc(title)}</div>` +
    innerHtml +
    `</td></tr></table>`
  );
}

function table(rows: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

function row(label: string, valueHtml: string): string {
  return (
    `<tr>` +
    `<td style="padding:6px 0;color:${brand.muted};font-size:13px;width:38%;vertical-align:top;">${esc(label)}</td>` +
    `<td style="padding:6px 0;color:${brand.text};font-size:13px;font-weight:600;vertical-align:top;">${valueHtml}</td>` +
    `</tr>`
  );
}

function th(label: string, align: "left" | "center" | "right"): string {
  const pad = align === "right" ? "0 0 8px 8px" : "0 0 8px 0";
  return `<th align="${align}" style="padding:${pad};color:${brand.muted};font-size:11px;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid ${brand.border};">${esc(label)}</th>`;
}

function summaryRow(
  label: string,
  value: string,
  color: string,
  strong = false
): string {
  const weight = strong ? "800" : "600";
  const size = strong ? "16px" : "13px";
  const padTop = strong ? "12px" : "6px";
  return (
    `<tr>` +
    `<td style="padding:${padTop} 0 0 0;color:${strong ? brand.text : brand.muted};font-size:${size};font-weight:${weight};">${esc(
      label
    )}</td>` +
    `<td align="right" style="padding:${padTop} 0 0 0;color:${color};font-size:${size};font-weight:${weight};white-space:nowrap;">${esc(
      value
    )}</td>` +
    `</tr>`
  );
}

function pill(label: string, color: string): string {
  return (
    `<span style="display:inline-block;padding:4px 12px;border-radius:999px;` +
    `background:${color}1a;color:${color};border:1px solid ${color}55;` +
    `font-size:12px;font-weight:700;letter-spacing:.03em;">${esc(label)}</span>`
  );
}

function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Plaintext fallback
// ─────────────────────────────────────────────────────────────────────────────

function buildText(
  data: OrderNotificationData,
  handle: string,
  methodLabel: string,
  statusLabel: string,
  totalLabel: string,
  message: string,
  ctx: CustomerEmailContext
): string {
  const lines: string[] = [];
  lines.push(`KROV PERFUMERÍA`);
  lines.push(`Confirmación de pedido #${handle}`);
  lines.push("");
  lines.push(message);
  lines.push("");
  lines.push("RESUMEN DEL PEDIDO");
  lines.push(`  Número de pedido: ${handle}`);
  lines.push(`  Fecha: ${formatDateTime(data.createdAt)}`);
  lines.push(`  Método de pago: ${methodLabel}`);
  lines.push(`  Estado del pago: ${statusLabel}`);
  lines.push("");
  lines.push("ARTÍCULOS COMPRADOS");
  for (const item of data.items) {
    const size =
      item.productType === "decant"
        ? ` (Decant ${item.sizeMl} ml)`
        : item.productType === "set"
          ? " (Set)"
          : ` (${item.sizeMl} ml)`;
    lines.push(
      `  - ${item.brandName} — ${item.productName}${size} x${item.quantity} @ ${formatCRC(
        item.unitPrice
      )}`
    );
  }
  lines.push("");
  lines.push("RESUMEN DE PAGO");
  lines.push(`  Subtotal: ${formatCRC(data.subtotal)}`);
  if (data.discount > 0) lines.push(`  Descuento: -${formatCRC(data.discount)}`);
  lines.push(
    `  Envío: ${data.shippingCost > 0 ? formatCRC(data.shippingCost) : "Gratis"}`
  );
  lines.push(`  ${totalLabel}: ${formatCRC(data.total)}`);
  lines.push("");
  lines.push("DIRECCIÓN DE ENVÍO");
  lines.push(`  ${data.customer.name} · ${data.customer.phone}`);
  lines.push(`  ${data.shipping.address}`);
  lines.push(
    `  ${data.shipping.district}, ${data.shipping.canton}, ${data.shipping.province}`
  );
  if (data.shipping.reference)
    lines.push(`  Indicaciones: ${data.shipping.reference}`);
  lines.push("");
  lines.push(`Ver mi pedido: ${ctx.viewOrderUrl}`);
  lines.push(`Soporte: ${ctx.supportEmail}`);
  return lines.join("\n");
}
