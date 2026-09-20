import { ImageResponse } from "next/og";
import { SITE } from "@/lib/seo/site";

/**
 * Site-wide social share card, generated at request time by next/og.
 *
 * Placing this at the app root means Next automatically attaches `og:image` and
 * `twitter:image` to every route that doesn't define its own — so shared links
 * to the home page, /products and /howtobuy stop rendering as bare text.
 * Product pages override it with the actual bottle shot.
 *
 * Deliberately no remote font fetch: it would add a network hop to every render
 * and fails closed (a broken card) if the font host is slow. System serif
 * carries the brand adequately at this size, and the card leans on the two
 * things that survive any font substitution — the near-black ground and the
 * KROV red.
 */
export const runtime = "edge";
export const alt = `${SITE.name} — Perfumes originales en Costa Rica`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BLOOD = "#ff0b55";
const BLUSH = "#ffdede";
const BONE = "#f4eef0";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 92px",
          background:
            "radial-gradient(circle at 8% 100%, #4a0518 0%, #0c090f 52%, #08060a 100%)",
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        {/* Left-aligned, like the hero. A centred card is the one everyone
            makes; the off-centre column is the one people recognise. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 22,
            letterSpacing: 9,
            color: BLOOD,
            textTransform: "uppercase",
          }}
        >
          {/* flexShrink: 0 is required — Satori (the next/og layout engine) is
              flex-only, so a fixed-width rule inside a flex container collapses
              to a dot without it. */}
          <div style={{ width: 56, height: 2, flexShrink: 0, background: BLOOD }} />
          кровь · sangre
        </div>

        <div
          style={{
            fontSize: 122,
            letterSpacing: 26,
            color: BONE,
            marginTop: 26,
            display: "flex",
          }}
        >
          KROV
        </div>

        <div
          style={{
            fontSize: 40,
            color: BLUSH,
            fontStyle: "italic",
            marginTop: 14,
            display: "flex",
          }}
        >
          Tu fragancia es parte de vos
        </div>

        <div
          style={{
            fontSize: 24,
            color: "rgba(244,238,240,0.55)",
            letterSpacing: 5,
            marginTop: 34,
            display: "flex",
          }}
        >
          Perfumes originales · Costa Rica
        </div>

        {/* The horizon — the same red line that closes the hero. */}
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "100%",
            height: 6,
            background: BLOOD,
          }}
        />
      </div>
    ),
    size
  );
}
