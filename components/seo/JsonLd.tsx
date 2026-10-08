import type { JsonLdNode } from "@/lib/seo/jsonLd";

/**
 * Serialise a JSON-LD payload so it is safe inside a `<script>` element.
 *
 * Product names and descriptions come from the database. Escaping every `<` as
 * `<` (the approach the Next.js docs recommend) means no value can close
 * the script early (`</script>`) or open an HTML comment (`<!--`) — an XSS
 * vector, not just a rendering bug. The result is still valid JSON, so parsers
 * read it back unchanged. (No U+2028/U+2029 escaping: a `ld+json` block is
 * parsed as JSON, never executed as JavaScript.)
 */
export function serializeJsonLd(data: JsonLdNode | JsonLdNode[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/**
 * Renders a schema.org JSON-LD block.
 *
 * A Server Component with no "use client" — the script must be in the initial
 * HTML so crawlers that don't execute JavaScript still read it.
 */
export default function JsonLd({ data }: { data: JsonLdNode | JsonLdNode[] }) {
  return (
    <script
      type="application/ld+json"
      // Our own serialized object, escaped by serializeJsonLd — never raw input.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
