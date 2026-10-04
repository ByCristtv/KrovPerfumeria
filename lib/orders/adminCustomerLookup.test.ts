import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  findCustomerByEmail,
  searchCustomers,
  toCustomerMatch,
} from "./adminCustomerLookup";

const ROW = {
  user_id: "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
  full_name: "Ana Solano",
  email: "ana@correo.com",
  phone: "88881234",
  address_province: "1",
  address_canton: "101",
  address_district: "Carmen",
  address_exact: "200m sur",
  address_reference: null,
};

function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("toCustomerMatch", () => {
  it("nests the saved address and keeps null reference as null", () => {
    expect(toCustomerMatch(ROW as never).address).toEqual({
      province: "1",
      canton: "101",
      district: "Carmen",
      exact_address: "200m sur",
      reference: null,
    });
  });

  it("yields no address for a customer who never saved one (LEFT JOIN nulls)", () => {
    const match = toCustomerMatch({
      ...ROW,
      address_province: null,
      address_canton: null,
      address_district: null,
      address_exact: null,
    } as never);
    expect(match.address).toBeNull();
  });
});

describe("searchCustomers", () => {
  it("never calls the server for a term below the minimum", async () => {
    const { client, rpc } = fakeClient({ data: [], error: null });
    expect(await searchCustomers(client, " a ")).toEqual({ ok: true, data: [] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends the trimmed term with a bounded limit and maps the rows", async () => {
    const { client, rpc } = fakeClient({ data: [ROW], error: null });
    const outcome = await searchCustomers(client, "  ana  ");
    expect(rpc).toHaveBeenCalledWith("admin_search_customers", {
      p_query: "ana",
      p_limit: 8,
    });
    expect(outcome.ok && outcome.data[0].email).toBe("ana@correo.com");
  });

  it("reports a refusal as a message, not as an empty result", async () => {
    const { client } = fakeClient({
      data: null,
      error: { message: "Insufficient privilege: admin only." },
    });
    const outcome = await searchCustomers(client, "ana");
    expect(outcome).toEqual({
      ok: false,
      message: "No tienes permiso para buscar clientes.",
    });
  });

  it("does not leak the raw database error for unexpected failures", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ data: null, error: { message: "relation x does not exist" } });
    const outcome = await searchCustomers(client, "ana");
    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.message).not.toMatch(/relation/);
    // and the log carries no search term
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/ana/);
    spy.mockRestore();
  });
});

describe("findCustomerByEmail", () => {
  it("skips the round trip for something that is not yet an address", async () => {
    const { client, rpc } = fakeClient({ data: [], error: null });
    for (const typed of ["", "   ", "ana", "ana@", "ana@correo"]) {
      expect(await findCustomerByEmail(client, typed)).toEqual({ ok: true, data: null });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("normalizes case and whitespace before asking", async () => {
    const { client, rpc } = fakeClient({ data: [ROW], error: null });
    await findCustomerByEmail(client, "  ANA@Correo.com ");
    expect(rpc).toHaveBeenCalledWith("admin_find_customer_by_email", {
      p_email: "ana@correo.com",
    });
  });

  it("returns null data when nobody owns the address", async () => {
    const { client } = fakeClient({ data: [], error: null });
    expect(await findCustomerByEmail(client, "nadie@correo.com")).toEqual({
      ok: true,
      data: null,
    });
  });

  it("surfaces a failed lookup as an error, distinct from 'not registered'", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    const outcome = await findCustomerByEmail(client, "ana@correo.com");
    expect(outcome.ok).toBe(false);
    spy.mockRestore();
  });
});
