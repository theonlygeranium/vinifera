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

interface MemberAliases {
  address?: PostalAddress | null;
  clubTierId?: string | null;
  shippingAddress?: PostalAddress | null;
  tierId?: string | null;
}

function aliasedClubTierId(input: MemberAliases): string | null | undefined {
  return "clubTierId" in input ? input.clubTierId : input.tierId;
}

function aliasedShippingAddress(
  input: MemberAliases,
): PostalAddress | null | undefined {
  return "shippingAddress" in input
    ? input.shippingAddress
    : input.address;
}

function asMemberInput(
  input: z.infer<typeof memberSchema>,
): MemberInput {
  return {
    birthday: input.birthday,
    clubTierId: aliasedClubTierId(input),
    email: input.email,
    firstName: input.firstName,
    joinDate: input.joinDate,
    lastName: input.lastName,
    phone: input.phone,
    referredByMemberId: input.referredByMemberId,
    shippingAddress: aliasedShippingAddress(input),
    status: input.status,
  };
}

interface MultipartPart {
  contentType?: string;
  filename?: string;
  name: string;
  value: Buffer;
}

const CRLF = Buffer.from("\r\n");
const HEADER_SEPARATOR = Buffer.from("\r\n\r\n");
const MAX_MULTIPART_PARTS = 20;
const MAX_MULTIPART_HEADER_BYTES = 16_384;

function hasValidMultipartBoundarySuffix(
  body: Buffer,
  suffixStart: number,
): boolean {
  const suffix = body.subarray(suffixStart, suffixStart + 2);
  if (suffix.equals(CRLF)) return true;
  if (suffix.toString("ascii") !== "--") return false;

  const closingEnd = suffixStart + 2;
  return (
    closingEnd === body.length ||
    body.subarray(closingEnd, closingEnd + 2).equals(CRLF)
  );
}

function findNextMultipartBoundary(
  body: Buffer,
  marker: Buffer,
  from: number,
): number {
  let candidate = body.indexOf(marker, from);
  while (candidate >= 0) {
    const suffixStart = candidate + marker.length;
    if (hasValidMultipartBoundarySuffix(body, suffixStart)) {
      return candidate;
    }
    candidate = body.indexOf(marker, candidate + 1);
  }
  return -1;
}

function parseMultipartForm(request: Request): MultipartPart[] {
  if (!Buffer.isBuffer(request.body)) {
    throw new AppError(400, "invalid_request", "A CSV file is required.");
  }
  const contentType = request.get("content-type") ?? "";
  const boundaryMatch = contentType.match(
    /boundary=(?:"([^"]+)"|([^;\s]+))/i,
  );
  const boundary = (boundaryMatch?.[1] ?? boundaryMatch?.[2])?.trim();
  if (
    !boundary ||
    boundary.length > 70 ||
    !/^[0-9A-Za-z'()+_,./:=?-]+$/.test(boundary)
  ) {
    throw new AppError(400, "invalid_request", "The multipart boundary is invalid.");
  }
  const delimiter = Buffer.from(`--${boundary}`);
  const framedDelimiter = Buffer.from(`\r\n--${boundary}`);
  const parts: MultipartPart[] = [];
  let cursor = 0;
  if (!request.body.subarray(0, delimiter.length).equals(delimiter)) {
    throw new AppError(400, "invalid_request", "The multipart body is malformed.");
  }

  while (cursor < request.body.length) {
    const start = cursor + delimiter.length;
    const delimiterSuffix = request.body.subarray(start, start + 2);
    if (delimiterSuffix.toString("ascii") === "--") {
      if (!hasValidMultipartBoundarySuffix(request.body, start)) {
        throw new AppError(400, "invalid_request", "The multipart body is malformed.");
      }
      return parts;
    }
    if (!delimiterSuffix.equals(CRLF)) {
      throw new AppError(400, "invalid_request", "The multipart body is malformed.");
    }
    if (parts.length >= MAX_MULTIPART_PARTS) {
      throw new AppError(400, "invalid_request", "The multipart body has too many fields.");
    }
    const headerStart = start + 2;
    const headerEnd = request.body.indexOf(HEADER_SEPARATOR, headerStart);
    if (
      headerEnd < 0 ||
      headerEnd - headerStart > MAX_MULTIPART_HEADER_BYTES
    ) {
      throw new AppError(400, "invalid_request", "A multipart header is invalid.");
    }
    const headers = request.body.subarray(headerStart, headerEnd).toString("utf8");
    const disposition = headers.match(
      /^content-disposition:\s*form-data;([^\r\n]+)$/im,
    )?.[1];
    const name = disposition?.match(/(?:^|;)\s*name="([^"]+)"/i)?.[1];
    const filename = disposition?.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
    if (!name) {
      throw new AppError(400, "invalid_request", "A multipart field is invalid.");
    }
    const valueStart = headerEnd + 4;
    const next = findNextMultipartBoundary(
      request.body,
      framedDelimiter,
      valueStart,
    );
    if (next < 0) {
      throw new AppError(400, "invalid_request", "The multipart body is incomplete.");
    }
    const partType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim();
    parts.push({
      contentType: partType,
      filename,
      name,
      value: request.body.subarray(valueStart, next),
    });
    cursor = next + 2;
  }

  throw new AppError(400, "invalid_request", "The multipart body is incomplete.");
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
      ...("birthday" in raw ? { birthday: raw.birthday } : {}),
      ...("address" in raw || "shippingAddress" in raw
        ? {
            shippingAddress: aliasedShippingAddress(raw),
          }
        : {}),
      ...("clubTierId" in raw || "tierId" in raw
        ? { clubTierId: aliasedClubTierId(raw) }
        : {}),
      ...("email" in raw ? { email: raw.email } : {}),
      ...("firstName" in raw ? { firstName: raw.firstName } : {}),
      ...("joinDate" in raw ? { joinDate: raw.joinDate } : {}),
      ...("lastName" in raw ? { lastName: raw.lastName } : {}),
      ...("phone" in raw ? { phone: raw.phone } : {}),
      ...("referredByMemberId" in raw
        ? { referredByMemberId: raw.referredByMemberId }
        : {}),
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
