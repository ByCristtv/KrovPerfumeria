import Link from "next/link";

export interface CatalogLink {
  href: string;
  label: string;
}

interface CatalogLinksProps {
  heading: string;
  /** Optional lead-in sentence above the links. */
  text?: string;
  links: CatalogLink[];
}

/**
 * A short row of descriptive links under a listing.
 *
 * Internal links with real anchor text are how a crawler learns that
 * /perfumes-arabes and /decants exist and what they are about; this also gives
 * a shopper an obvious next step when the grid didn't have what they wanted.
 * Server component, static markup.
 */
export default function CatalogLinks({ heading, text, links }: CatalogLinksProps) {
  if (links.length === 0) return null;

  return (
    <aside
      aria-label={heading}
      className="mt-20 border-t border-krov-smoke/60 pt-10"
    >
      <p className="krov-eyebrow">{heading}</p>
      {text && (
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-krov-ash">
          {text}
        </p>
      )}
      <ul className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="krov-underline text-sm text-krov-bone"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  );
}
