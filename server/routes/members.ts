import express, { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors";
import type { MemberInput, PostalAddress } from "../types";
import {
  addressSchema,
  commandId,
  data,
  email,
  memberStatus,
  parseBody,
  uuid,
  type RouteContext,
} from "./shared";

const memberSchema = z.object({
  address: addressSchema.nullable().optional(),
  birthday: z.iso.date().nullable().optional(),
  clubTierId: uuid.nullable().optional(),
  email,
  firstName: z.string().trim().min(1).max(100),
  joinDate: z.iso.date().optional(),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(30).nullable().optional(),
  referredByMemberId: uuid.nullable().optional(),
  shippingAddress: addressSchema.nullable().optional(),
  status: memberStatus.optional(),
  tierId: uuid.nullable().optional(),
});
const memberPatchSchema = memberSchema.partial();

function asMemberInput(
  input: z.infer<typeof memberSchema>,
): MemberInput {
  return {
    birthday: input.birthday,
    clubTierId: input.clubTierId ?? input.tierId,
    email: input.email,
    firstName: input.firstName,
    joinDate: input.joinDate,
    lastName: input.lastName,
    phone: input.phone,
    referredByMemberId: input.referredByMemberId,
    shippingAddress: (input.shippingAddress ?? input.address) as
      | PostalAddress
      | null
      | undefined,
    status: input.status,
  };
}

interface MultipartPart {
  contentType?: string;
  filename?: string;
  name: string;
  value: Buffer;
}

function parseMultipartForm(request: Request): MultipartPart[] {
  if (!Buffer.isBuffer(request.body)) {
    throw new AppError(400, "invalid_request", "A CSV file is required.");
  }
  const contentType = request.get("content-type") ?? "";
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean);
  if (!boundary || boundary.length > 200) {
    throw new AppError(400, "invalid_request", "The multipart boundary is invalid.");
  }
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let cursor = request.body.indexOf(delimiter);
  while (cursor >= 0) {
    const start = cursor + delimiter.length;
    if (request.body.subarray(start, start + 2).toString() === "--") break;
    const headerStart = start + 2;
    const headerEnd = request.body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd < 0) break;
    const headers = request.body.subarray(headerStart, headerEnd).toString("utf8");
    const disposition = headers.match(
      /content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i,
    );
    if (!disposition?.[1]) {
      throw new AppError(400, "invalid_request", "A multipart field is invalid.");
    }
    const valueStart = headerEnd + 4;
    const next = request.body.indexOf(delimiter, valueStart);
    if (next < 0) break;
    const valueEnd = Math.max(valueStart, next - 2);
    const partType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();
    parts.push({
      contentType: partType,
      filename: disposition[2],
      name: disposition[1],
      value: request.body.subarray(valueStart, valueEnd),
    });
    cursor = next;
  }
  return parts;
}

export default function createMembersRouter(context: RouteContext): Router {
  const { coreService } = context;
  const router = Router();

  router.get("/api/members", async (request, response) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        search: z.string().trim().max(120).optional(),
        status: memberStatus.optional(),
        tierId: uuid.optional(),
      })
      .parse(request.query);
    data(response, await coreService(request, response).listMembers(query));
  });

  router.post("/api/members", async (request, response) => {
    const input = asMemberInput(parseBody(memberSchema, request));
    data(
      response,
      await coreService(request, response).createMember(
        input,
        commandId(request),
      ),
      201,
    );
  });

  router.get("/api/members/export", async (request, response) => {
    const query = z
      .object({
        search: z.string().trim().max(120).optional(),
        status: memberStatus.optional(),
        tierId: uuid.optional(),
      })
      .parse(request.query);
    const result = await coreService(request, response).exportMembers(query);
    response
      .status(200)
      .set({
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Type": "text/csv; charset=utf-8",
      })
      .send(result.contents);
  });

  router.post(
    "/api/members/import/preview",
    express.raw({ limit: "6mb", type: "multipart/form-data" }),
    async (request, response) => {
      // TODO(BS-03): move logic to service layer
      const parts = parseMultipartForm(request);
      const file = parts.find((part) => part.name === "file");
      const sourcePart = parts.find((part) => part.name === "source");
      const source = z
        .enum(["commerce7", "winedirect", "generic"])
        .parse(sourcePart?.value.toString("utf8") ?? "generic");
      if (!file?.filename || !file.value.length) {
        throw new AppError(400, "invalid_request", "Choose a non-empty CSV file.");
      }
      if (!file.filename.toLowerCase().endsWith(".csv")) {
        throw new AppError(400, "invalid_request", "Only .csv files can be imported.");
      }
      const allowedTypes = new Set([
        "application/csv",
        "application/vnd.ms-excel",
        "text/csv",
      ]);
      const contentType = file.contentType ?? "text/csv";
      if (!allowedTypes.has(contentType)) {
        throw new AppError(400, "invalid_request", "The upload must use a CSV media type.");
      }
      data(
        response,
        await coreService(request, response).previewMemberImport({
          contents: file.value.toString("utf8"),
          contentType: contentType as
            | "text/csv"
            | "application/csv"
            | "application/vnd.ms-excel",
          filename: file.filename.replaceAll(/[^\w .-]/g, "_").slice(0, 255),
          format: source,
        }),
        201,
      );
    },
  );

  router.post("/api/members/import", async (request, response) => {
    const input = parseBody(
      z.object({
        mapping: z.record(z.string(), z.string()).optional(),
        uploadToken: z.string().min(32).max(200),
      }),
      request,
    );
    data(
      response,
      await coreService(request, response).importMembers(input),
      201,
    );
  });

  router.post("/api/members/batch", async (request, response) => {
    const input = parseBody(
      z.object({
        action: z.enum(["pause", "resume", "cancel", "assign_tier"]),
        memberIds: z.array(uuid).min(1).max(1_000).optional(),
        scope: z.literal("all").optional(),
        tierId: uuid.optional(),
      }),
      request,
    );
    if (input.scope !== "all" && !input.memberIds?.length) {
      throw new AppError(
        400,
        "invalid_request",
        "Choose members or explicitly select the entire roster.",
      );
    }
    data(
      response,
      await coreService(request, response).batchMembers({
        ids: input.memberIds,
        operation: input.action,
        tierId: input.tierId,
      }, commandId(request)),
    );
  });

  router.get("/api/members/:id", async (request, response) => {
    data(
      response,
      await coreService(request, response).getMember(
        uuid.parse(request.params.id),
      ),
    );
  });

  router.patch("/api/members/:id", async (request, response) => {
    // TODO(BS-03): move logic to service layer
    const memberId = uuid.parse(request.params.id);
    const raw = parseBody(memberPatchSchema, request);
    if (raw.status !== undefined) {
      const includesProfileChanges = Object.entries(raw).some(
        ([field, value]) => field !== "status" && value !== undefined,
      );
      if (includesProfileChanges) {
        throw new AppError(
          400,
          "invalid_request",
          "Update member status separately from profile details.",
        );
      }
      data(
        response,
        await coreService(request, response).transitionMember(
          memberId,
          raw.status,
          commandId(request),
        ),
      );
      return;
    }
    const input: Partial<MemberInput> = {
      birthday: raw.birthday,
      ...(raw.address !== undefined || raw.shippingAddress !== undefined
        ? {
            shippingAddress: (raw.shippingAddress ?? raw.address) as
              | PostalAddress
              | null,
          }
        : {}),
      ...(raw.clubTierId !== undefined || raw.tierId !== undefined
        ? { clubTierId: raw.clubTierId ?? raw.tierId }
        : {}),
      email: raw.email,
      firstName: raw.firstName,
      joinDate: raw.joinDate,
      lastName: raw.lastName,
      phone: raw.phone,
      referredByMemberId: raw.referredByMemberId,
    };
    data(
      response,
      await coreService(request, response).updateMember(
        memberId,
        input,
        commandId(request),
      ),
    );
  });

  router.delete("/api/members/:id", async (request, response) => {
    await coreService(request, response).deleteMember(
      uuid.parse(request.params.id),
      commandId(request),
    );
    response.status(204).end();
  });

  return router;
}
