// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  MemberSessionProvider,
  useMemberSession,
} from "../../src/client/member/MemberSessionContext";

const apiRequest = vi.hoisted(() => vi.fn());
const readCachedNativeMember = vi.hoisted(() => vi.fn());

vi.mock("../../src/client/api/client", () => ({ apiRequest }));
vi.mock("../../src/client/mobile/native-session", () => ({
  readCachedNativeMember,
}));
vi.mock("../../src/client/mobile/MobileRuntime", () => ({
  useMobileRuntime: () => ({
    bootstrap: {
      status: "cached",
      data: {
        generatedAt: "2026-07-26T16:00:00.000Z",
        loyaltyLedger: [],
        member: { id: "member-1" },
        pendingActions: [],
        recentShipments: [],
      },
    },
    native: true,
    online: false,
    refreshBootstrap: vi.fn(),
    sessionUnlocked: true,
  }),
}));

function Probe() {
  const member = useMemberSession();
  return (
    <>
      <span data-testid="state">{member.state}</span>
      <span data-testid="email">{member.session?.user?.email}</span>
    </>
  );
}

describe("Phase 5 offline native member session", () => {
  it("keeps a biometrically unlocked cached portal authenticated and read-only", async () => {
    apiRequest.mockRejectedValueOnce(new Error("offline"));
    readCachedNativeMember.mockResolvedValueOnce({
      email: "member@example.test",
      firstName: "Avery",
      id: "member-1",
      lastName: "Vine",
    });

    render(
      <MemberSessionProvider>
        <Probe />
      </MemberSessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("state")).toHaveTextContent("cached"),
    );
    expect(screen.getByTestId("email")).toHaveTextContent(
      "member@example.test",
    );
  });
});
