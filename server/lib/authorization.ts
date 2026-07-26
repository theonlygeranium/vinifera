import type { StaffPrincipal, StaffRole } from "../types";
import { AppError } from "./errors";

export function assertStaffRole(
  principal: StaffPrincipal,
  roles: StaffRole[],
): void {
  if (!roles.includes(principal.user.role)) {
    throw new AppError(403, "forbidden", "Your role cannot perform this action.");
  }
}
