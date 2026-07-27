import { assertUuid } from "../lib/utils";
import type { ClubTierInput } from "../types";
import {
  commandError,
  commandResult,
  CoreClubMemberService,
  databaseError,
  tierToDatabase,
  toPublicTier,
} from "./members";

export class CoreClubClubService extends CoreClubMemberService {
  async listClubTiers(): Promise<Array<Record<string, unknown>>> {
    const principal = await this.requireStaff();
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .from("club_tiers")
      .select("*,members(count)")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .order("created_at");
    if (error) throw databaseError("Club tiers could not be loaded.");
    return (data ?? []).map(toPublicTier);
  }

  async createClubTier(
    input: ClubTierInput,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .rpc("apply_club_tier_command", {
        p_actor_user_id: principal.user.id,
        p_brand_id: brandId,
        p_command_id: commandId,
        p_operation: "create",
        p_organization_id: organizationId,
        p_payload: tierToDatabase(input),
        p_tier_id: null,
      });
    if (error) {
      throw commandError(error, "The club tier could not be created.");
    }
    const result = commandResult(data);
    const tierId = String(result.entityId ?? "");
    assertUuid(tierId, "Club tier");
    const { data: tier, error: tierError } = await this.admin
      .from("club_tiers")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .eq("id", tierId)
      .single();
    if (tierError || !tier) throw databaseError("The club tier could not be loaded.");
    return { ...toPublicTier(tier), command: result };
  }

  async updateClubTier(
    tierId: string,
    input: Partial<ClubTierInput>,
    commandId: string,
  ): Promise<Record<string, unknown>> {
    assertUuid(tierId, "Club tier");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin", "manager"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { data, error } = await this.admin
      .rpc("apply_club_tier_command", {
        p_actor_user_id: principal.user.id,
        p_brand_id: brandId,
        p_command_id: commandId,
        p_operation: "update",
        p_organization_id: organizationId,
        p_payload: tierToDatabase(input),
        p_tier_id: tierId,
      });
    if (error) throw commandError(error, "The club tier could not be updated.");
    const result = commandResult(data);
    const { data: tier, error: tierError } = await this.admin
      .from("club_tiers")
      .select("*")
      .eq("id", tierId)
      .eq("organization_id", organizationId)
      .eq("brand_id", brandId)
      .single();
    if (tierError || !tier) throw databaseError("The club tier could not be loaded.");
    return { ...toPublicTier(tier), command: result };
  }

  async deleteClubTier(tierId: string, commandId: string): Promise<void> {
    assertUuid(tierId, "Club tier");
    assertUuid(commandId, "Command");
    const principal = await this.requireStaff(["owner", "admin"]);
    const organizationId = this.organizationId(principal);
    const brandId = await this.activeBrandId(principal);
    const { error } = await this.admin.rpc("apply_club_tier_command", {
      p_actor_user_id: principal.user.id,
      p_brand_id: brandId,
      p_command_id: commandId,
      p_operation: "delete",
      p_organization_id: organizationId,
      p_payload: {},
      p_tier_id: tierId,
    });
    if (error) throw commandError(error, "The club tier could not be deleted.");
  }
}
