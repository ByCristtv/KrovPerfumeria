import { describe, expect, it } from "vitest";
import { renderCustomerOrderConfirmationEmail } from "./customerOrderEmail";
import type { OrderNotificationData, OrderPaymentMethod } from "../types";

/**
 * The payment half of the customer confirmation, which is the only part that
 * branches. What matters is that the email never instructs a customer to do
 * something they did not agree to — a manually-recorded order has no payment
 * provider, and telling its recipient to complete a SINPE transfer would be an
 * instruction, not a description.
 */

const CTX = {
  viewOrderUrl: "https://krov.test/orders/abc?token=t",
  siteUrl: "https://krov.test",
  supportEmail: "ventas@krov.test",
};

function makeData(paymentMethod: OrderPaymentMethod): OrderNotificationData {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    orderNumber: 1042,
    createdAt: "2026-09-13T15:00:00.000Z",
    paymentMethod,
    paymentProvider: paymentMethod === "other" ? null : paymentMethod,
    paymentStatus: paymentMethod === "card" ? "paid" : "pending",
    orderStatus: "pending",
    subtotal: 40_000,
    shippingCost: 2_900,
    discount: 0,
    total: 42_900,
    customer: { name: "Ana Solano", email: "ana@example.com", phone: "8888-8888" },
    shipping: {
      province: "San José",
      canton: "San José",
      district: "Carmen",
      address: "200m sur de la iglesia",
      reference: null,
    },
    items: [
      {
        productName: "Aventus",
        brandName: "Creed",
        productType: "decant",
        sizeMl: 10,
        sku: "CR-AVE-10",
        quantity: 2,
        unitPrice: 20_000,
        lineTotal: 40_000,
      },
    ],
  };
}

describe("renderCustomerOrderConfirmationEmail", () => {
  it("tells a card customer their payment was received", () => {
    const email = renderCustomerOrderConfirmationEmail(makeData("card"), CTX);
    expect(email.text).toContain("Confirmado / Pagado");
    expect(email.text).toContain("Tarjeta de crédito/débito");
  });

  it("asks a SINPE customer to complete their transfer", () => {
    const email = renderCustomerOrderConfirmationEmail(makeData("sinpe"), CTX);
    expect(email.text).toContain("SINPE Móvil");
    expect(email.text).toContain("completa la transferencia");
  });

  it("does not invent a payment method for a manually-recorded order", () => {
    const email = renderCustomerOrderConfirmationEmail(makeData("other"), CTX);

    expect(email.text).not.toContain("SINPE");
    expect(email.html).not.toContain("SINPE");
    expect(email.text).toContain("Por coordinar con la tienda");
    // Still the truthful status: recorded, not yet paid.
    expect(email.text).toContain("Pago pendiente de verificación");
  });

  it("keeps the order details identical across every payment method", () => {
    for (const method of ["card", "sinpe", "other"] as const) {
      const email = renderCustomerOrderConfirmationEmail(makeData(method), CTX);
      expect(email.subject).toContain("1042");
      expect(email.text).toContain("Aventus");
      expect(email.text).toContain("Carmen");
      expect(email.html).toContain(CTX.viewOrderUrl);
    }
  });
});
