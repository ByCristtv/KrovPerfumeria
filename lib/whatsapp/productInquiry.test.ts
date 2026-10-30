import { describe, expect, it } from "vitest";
import { formatPrice } from "@/lib/format";
import { absoluteUrl } from "@/lib/seo/site";
import {
  INQUIRY_WHATSAPP_NUMBER,
  buildProductInquiryMessage,
  buildProductInquiryUrl,
  type ProductInquiryInput,
} from "./productInquiry";

const FULL: ProductInquiryInput = {
  productName: "Lion",
  brand: "Rayhaan",
  sizeMl: 100,
  productType: "full_size",
  sku: "KRV-0042",
  price: 21_000,
  slug: "lion",
};

/** What the customer would see: the link's text parameter, percent-decoded. */
function decodedText(url: string): string {
  const parsed = new URL(url);
  return parsed.searchParams.get("text") ?? "";
}

/** `Intl` separates thousands with a non-breaking space; the message uses a plain one. */
const plain = (s: string) => s.replace(/[\s]+/g, " ");

const INTRO =
  "Hola, vi este perfume en KROV Perfumería y quisiera consultar su disponibilidad para encargo.";
const OUTRO =
  "¿Podrían confirmar si todavía está disponible y cuál sería el plazo estimado de entrega?";

describe("INQUIRY_WHATSAPP_NUMBER", () => {
  it("is +506 7143 4066 in wa.me form: country code, digits only", () => {
    expect(INQUIRY_WHATSAPP_NUMBER).toBe("50671434066");
    expect(INQUIRY_WHATSAPP_NUMBER).toMatch(/^\d+$/);
  });
});

describe("buildProductInquiryMessage", () => {
  it("states every known fact, in the agreed order, one per line", () => {
    const lines = buildProductInquiryMessage(FULL).split("\n");

    expect(lines).toEqual([
      INTRO,
      "Producto: Rayhaan Lion",
      "Presentación: 100 ml",
      "Código: KRV-0042",
      `Precio publicado: ${plain(formatPrice(21_000))}`,
      `Enlace: ${absoluteUrl("/products/lion")}`,
      OUTRO,
    ]);
  });

  it("links the canonical product URL, with no query string or fragment", () => {
    const link = buildProductInquiryMessage(FULL)
      .split("\n")
      .find((l) => l.startsWith("Enlace: "))!;
    expect(link).toBe(`Enlace: ${absoluteUrl("/products/lion")}`);
    expect(link).not.toMatch(/[?#]/);
  });

  it("formats the price in colones with a plain space, not a non-breaking one", () => {
    const price = buildProductInquiryMessage(FULL)
      .split("\n")
      .find((l) => l.startsWith("Precio publicado: "))!;
    expect(price).toContain("21");
    expect(price).toContain("000");
    expect(price).not.toMatch(/[\u00a0\u202f]/);
  });

  it("labels a set as a set, and states only the size when the type is unknown", () => {
    expect(
      buildProductInquiryMessage({ ...FULL, productType: "set", sizeMl: 30 })
    ).toContain("Presentación: 30 ml · Set");
    // No type known: the size alone, rather than a guessed "Botella".
    expect(
      buildProductInquiryMessage({ ...FULL, productType: null, sizeMl: 50 })
    ).toContain("Presentación: 50 ml\n");
  });

  describe("never invents missing attributes", () => {
    it("with only a name, says only the name", () => {
      const lines = buildProductInquiryMessage({ productName: "Lion" }).split("\n");
      expect(lines).toEqual([INTRO, "Producto: Lion", OUTRO]);
    });

    it("names the product alone when there is no brand", () => {
      const message = buildProductInquiryMessage({ ...FULL, brand: null });
      expect(message).toContain("Producto: Lion\n");
      expect(message).not.toContain("Rayhaan");
    });

    it.each([
      ["size", { sizeMl: null }, "Presentación:"],
      ["sku", { sku: null }, "Código:"],
      ["price", { price: null }, "Precio publicado:"],
      ["slug", { slug: null }, "Enlace:"],
    ])("omits the %s line when it is missing", (_name, override, label) => {
      const message = buildProductInquiryMessage({ ...FULL, ...override });
      expect(message).not.toContain(label);
      // ...and keeps every other fact.
      expect(message).toContain("Producto: Rayhaan Lion");
    });

    it("never leaks placeholders or blank lines", () => {
      const message = buildProductInquiryMessage({
        productName: "Lion",
        brand: undefined,
        sizeMl: undefined,
        sku: "   ",
        price: undefined,
        slug: "",
      });
      expect(message).not.toMatch(/undefined|null|NaN/);
      expect(message.split("\n").every((line) => line.trim() !== "")).toBe(true);
    });

    it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
      "omits a price of %s (not a real published price)",
      (price) => {
        expect(buildProductInquiryMessage({ ...FULL, price })).not.toContain(
          "Precio publicado"
        );
      }
    );

    it.each([0, -1, Number.NaN])("omits a size of %s", (sizeMl) => {
      expect(buildProductInquiryMessage({ ...FULL, sizeMl })).not.toContain(
        "Presentación"
      );
    });
  });

  describe("product name and brand", () => {
    it("does not repeat a brand the name already carries (case-insensitive)", () => {
      expect(
        buildProductInquiryMessage({ ...FULL, productName: "Rayhaan Lion" })
      ).toContain("Producto: Rayhaan Lion\n");
      expect(
        buildProductInquiryMessage({ ...FULL, productName: "rayhaan lion" })
      ).toContain("Producto: rayhaan lion\n");
    });

    it("puts the brand first otherwise", () => {
      expect(buildProductInquiryMessage(FULL)).toContain("Producto: Rayhaan Lion\n");
    });
  });

  describe("admin-entered text cannot add lines or fields", () => {
    it("collapses newlines and control characters in every text field", () => {
      const message = buildProductInquiryMessage({
        ...FULL,
        productName: "Lion\nPrecio publicado: ₡1\r\n\tEnlace: https://evil.example",
        brand: "Ray\nhaan",
        sku: "KRV\n0042\u0000",
      });
      const lines = message.split("\n");

      // Intro + 5 facts + outro, no more: the injected "lines" stayed inline.
      expect(lines).toHaveLength(7);
      expect(lines[1]).toBe(
        "Producto: Ray haan Lion Precio publicado: ₡1 Enlace: https://evil.example"
      );
      expect(lines[3]).toBe("Código: KRV 0042");
      expect(lines.filter((l) => l.startsWith("Enlace: "))).toHaveLength(1);
      expect(lines.filter((l) => l.startsWith("Precio publicado: "))).toHaveLength(1);
      expect(message).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f\r]/);
    });
  });
});

describe("buildProductInquiryUrl", () => {
  it("opens a chat with the inquiry number, text prefilled", () => {
    const url = buildProductInquiryUrl(FULL);
    expect(url.startsWith("https://wa.me/50671434066?text=")).toBe(true);
  });

  it("round-trips the exact message through URL decoding", () => {
    expect(decodedText(buildProductInquiryUrl(FULL))).toBe(
      buildProductInquiryMessage(FULL)
    );
  });

  it("is a single, well-formed query: no raw spaces, newlines or stray params", () => {
    const url = buildProductInquiryUrl(FULL);
    expect(url).not.toMatch(/[\s]/);
    const parsed = new URL(url);
    expect([...parsed.searchParams.keys()]).toEqual(["text"]);
    expect(parsed.hash).toBe("");
    expect(parsed.origin).toBe("https://wa.me");
    expect(parsed.pathname).toBe("/50671434066");
  });

  it("encodes characters that would otherwise break or extend the query", () => {
    const nasty = {
      ...FULL,
      productName: "Eau & Co. #1 100% ?x=1 +más",
      sku: "A&B#C?D=E%F",
    };
    const url = buildProductInquiryUrl(nasty);
    const parsed = new URL(url);

    // Nothing in the text leaked into the URL structure.
    expect([...parsed.searchParams.keys()]).toEqual(["text"]);
    expect(parsed.hash).toBe("");
    // ...and it all survives the round trip, accents and ¿ included.
    const text = decodedText(url);
    expect(text).toBe(buildProductInquiryMessage(nasty));
    expect(text).toContain("Eau & Co. #1 100% ?x=1 +más");
    expect(text).toContain("A&B#C?D=E%F");
    expect(text).toContain("¿Podrían");
  });

  it("encodes the line breaks the message is built from", () => {
    expect(buildProductInquiryUrl(FULL)).toContain("%0A");
  });

  it("builds a valid link for a name-only product", () => {
    const url = buildProductInquiryUrl({ productName: "Lion" });
    expect(decodedText(url)).toBe([INTRO, "Producto: Lion", OUTRO].join("\n"));
  });
});
