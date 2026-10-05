import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import RankBadge from "./RankBadge";
import { RANK_THRESHOLDS, getRankIconUrl, getRankLevel } from "@/lib/rank";

describe("rank icon config", () => {
  it("maps every tier to its badge in the rank-icons bucket", () => {
    expect(RANK_THRESHOLDS.map((t) => [t.rank, t.icon])).toEqual([
      ["Aficionado", "Aficionado.avif"],
      ["Coleccionista", "Coleccionista.avif"],
      ["Conocedor", "Conocedor.avif"],
      ["Alquimista", "Alquimista.avif"],
      ["Maestro", "Krov.avif"],
    ]);
  });

  it("builds the public storage URL from NEXT_PUBLIC_SUPABASE_URL", () => {
    expect(getRankIconUrl("Maestro")).toBe(
      "https://test.supabase.co/storage/v1/object/public/rank-icons/icons/Krov.avif"
    );
  });

  it("numbers the ladder from 1", () => {
    expect(getRankLevel("Aficionado")).toBe(1);
    expect(getRankLevel("Maestro")).toBe(5);
  });
});

describe("RankBadge", () => {
  it("labels the image with the rank by default", () => {
    render(<RankBadge rank="Conocedor" />);
    const img = screen.getByRole("img", { name: "Rango Conocedor" });
    expect(img).toHaveAttribute("width", "40");
    expect(img).toHaveAttribute("height", "40");
  });

  it("is silent to assistive tech when decorative", () => {
    render(<RankBadge rank="Conocedor" decorative />);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("falls back to a monogram when the image fails to load", () => {
    render(<RankBadge rank="Alquimista" size="lg" />);
    fireEvent.error(screen.getByRole("img", { name: "Rango Alquimista" }));

    const fallback = screen.getByRole("img", { name: "Rango Alquimista" });
    expect(fallback.tagName).toBe("SPAN");
    expect(fallback).toHaveTextContent("A");
    expect(fallback).toHaveStyle({ width: "64px", height: "64px" });
  });
});
