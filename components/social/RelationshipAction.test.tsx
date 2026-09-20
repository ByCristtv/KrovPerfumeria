import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RelationshipAction from "./RelationshipAction";
import type { RelationshipStatus } from "@/types/social";

/**
 * SOCIAL-04 (states) + SOCIAL-05 (send/cancel), at the presentation layer.
 *
 * These assert the mapping from relationship state to affordance, and — just as
 * importantly — that the component holds NO state of its own: every click is
 * reported upward, and what the row displays comes only from `status`.
 */
const handlers = {
  onAdd: vi.fn(),
  onCancel: vi.fn(),
  onRespond: vi.fn(),
};

function renderAction(
  props: {
    status?: RelationshipStatus;
    pendingRequestId?: string;
    isSending?: boolean;
    isCancelling?: boolean;
  } = {}
) {
  return render(
    <RelationshipAction
      status={props.status ?? "none"}
      username="aurora"
      pendingRequestId={props.pendingRequestId}
      isSending={props.isSending}
      isCancelling={props.isCancelling}
      {...handlers}
    />
  );
}

describe("RelationshipAction", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("state → affordance", () => {
    it("offers 'Agregar' when there is no relationship", () => {
      renderAction({ status: "none" });
      expect(screen.getByRole("button")).toHaveTextContent("Agregar");
    });

    it("shows 'Pendiente' plus a cancel action for a request sent", () => {
      renderAction({ status: "outgoing_pending", pendingRequestId: "r1" });
      expect(screen.getByText("Pendiente")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /cancelar la solicitud/i })
      ).toBeEnabled();
    });

    it("shows 'Solicitud recibida' for a request received", () => {
      renderAction({ status: "incoming_pending" });
      expect(screen.getByText("Solicitud recibida")).toBeInTheDocument();
    });

    it("shows 'Amigos' for an established friendship", () => {
      renderAction({ status: "friends" });
      expect(screen.getByText("Amigos")).toBeInTheDocument();
    });

    it("distinguishes the two pending directions", () => {
      const { unmount } = renderAction({ status: "outgoing_pending" });
      expect(screen.queryByText("Solicitud recibida")).not.toBeInTheDocument();
      unmount();

      renderAction({ status: "incoming_pending" });
      expect(screen.queryByText("Pendiente")).not.toBeInTheDocument();
    });

    it("offers no destructive action for a friend — removal lives in the list", () => {
      renderAction({ status: "friends" });
      expect(
        screen.queryByRole("button", { name: /eliminar/i })
      ).not.toBeInTheDocument();
    });
  });

  describe("sending a request (CASE 1)", () => {
    it("reports the click upward instead of changing state locally", async () => {
      const user = userEvent.setup();
      renderAction({ status: "none" });

      await user.click(screen.getByRole("button", { name: /enviar solicitud/i }));

      expect(handlers.onAdd).toHaveBeenCalledTimes(1);
      // Still "Agregar": only a refetched `status` may change the label.
      expect(screen.getByRole("button")).toHaveTextContent("Agregar");
    });

    it("locks and relabels the button while the request is in flight (CASE 7)", () => {
      renderAction({ status: "none", isSending: true });
      const button = screen.getByRole("button");
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent(/enviando/i);
    });

    it("cannot be clicked a second time while sending (CASE 7)", async () => {
      const user = userEvent.setup();
      renderAction({ status: "none", isSending: true });

      await user.click(screen.getByRole("button"));

      expect(handlers.onAdd).not.toHaveBeenCalled();
    });
  });

  describe("cancelling a request (CASE 2)", () => {
    it("passes the request id, not the user id", async () => {
      const user = userEvent.setup();
      renderAction({ status: "outgoing_pending", pendingRequestId: "req-7" });

      await user.click(screen.getByRole("button", { name: /cancelar/i }));

      expect(handlers.onCancel).toHaveBeenCalledWith("req-7");
    });

    it("waits rather than firing a call it cannot address", async () => {
      // The sent-requests list has not arrived yet, so there is no id to cancel
      // BY. The button must not call with undefined.
      const user = userEvent.setup();
      renderAction({ status: "outgoing_pending", pendingRequestId: undefined });

      const button = screen.getByRole("button", { name: /cancelar/i });
      expect(button).toBeDisabled();

      await user.click(button);
      expect(handlers.onCancel).not.toHaveBeenCalled();
    });

    it("locks the button while cancelling (CASE 7)", () => {
      renderAction({
        status: "outgoing_pending",
        pendingRequestId: "r1",
        isCancelling: true,
      });
      expect(screen.getByRole("button", { name: /cancelar/i })).toBeDisabled();
    });
  });

  describe("an incoming request", () => {
    it("routes to Solicitudes rather than duplicating accept/reject here", async () => {
      const user = userEvent.setup();
      renderAction({ status: "incoming_pending" });

      expect(
        screen.queryByRole("button", { name: /^aceptar$/i })
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: /responder/i }));
      expect(handlers.onRespond).toHaveBeenCalledTimes(1);
    });
  });

  it("names the person in every accessible label, for a list of rows", () => {
    renderAction({ status: "none" });
    expect(screen.getByRole("button")).toHaveAccessibleName(/aurora/i);
  });
});
