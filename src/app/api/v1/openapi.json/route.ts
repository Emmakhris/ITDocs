import { NextResponse } from "next/server";

// OpenAPI 3.1 description of /api/v1. Public (no secrets in it) so tools can fetch it directly.

const page = [
  { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
  { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 200 } },
];
const id = [{ name: "id", in: "path", required: true, schema: { type: "string" }, description: "Record id (assets also accept the asset tag)" }];
const ok = (description: string) => ({ "200": { description, content: { "application/json": { schema: { type: "object" } } } } });
const created = (description: string) => ({ "201": { description, content: { "application/json": { schema: { type: "object" } } } } });
const body = (schema: object) => ({ required: true, content: { "application/json": { schema } } });
const errors = {
  "401": { $ref: "#/components/responses/Unauthorized" },
  "403": { $ref: "#/components/responses/Forbidden" },
  "422": { $ref: "#/components/responses/Invalid" },
  "429": { $ref: "#/components/responses/TooMany" },
};

const spec = {
  openapi: "3.1.0",
  info: {
    title: "ITDocs API",
    version: "1.0.0",
    description:
      "REST API for ITDocs. Authenticate with a personal access token (Profile › API tokens): `Authorization: Bearer itd_…`. A token acts as its owner with the owner's role, optionally narrowed to read-only and to some modules. Every write is recorded in the audit log. The password vault and admin settings are not available through the API. Errors are `{ \"error\": string, \"fieldErrors\"?: { field: message } }`.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ token: [] }],
  components: {
    securitySchemes: { token: { type: "http", scheme: "bearer", bearerFormat: "itd_ token" } },
    schemas: {
      Error: { type: "object", properties: { error: { type: "string" }, fieldErrors: { type: "object", additionalProperties: { type: "string" } } }, required: ["error"] },
      AssetInput: {
        type: "object",
        required: ["name", "typeId"],
        properties: {
          tag: { type: "string", description: "Generated from the type's prefix if omitted" },
          name: { type: "string" },
          typeId: { type: "string" },
          status: { enum: ["ORDERED", "IN_STOCK", "DEPLOYED", "IN_REPAIR", "LOANED", "RETIRED", "DISPOSED", "LOST"] },
          manufacturer: { type: "string" },
          model: { type: "string" },
          serial: { type: "string" },
          hostname: { type: "string" },
          ipAddress: { type: "string" },
          macAddress: { type: "string" },
          os: { type: "string" },
          locationId: { type: "string" },
          assigneeId: { type: "string" },
          purchaseDate: { type: "string", format: "date" },
          purchaseCost: { type: "number" },
          warrantyEnd: { type: "string", format: "date" },
          storesPhi: { type: "boolean" },
          notes: { type: "string" },
          customFields: { type: "object" },
          changeReason: { type: "string", description: "Recorded in the movement log when location, assignee or status changes" },
        },
      },
    },
    responses: {
      Unauthorized: { description: "Missing, invalid, expired or revoked token", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      Forbidden: { description: "The token or its owner's role doesn't allow this", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      Invalid: { description: "Validation failed", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      TooMany: { description: "Rate limit exceeded; see Retry-After", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    },
  },
  paths: {
    "/me": { get: { summary: "The token's owner and what the token can do", responses: { ...ok("Owner, scopes and access per module"), ...errors } } },
    "/assets": {
      get: {
        summary: "List assets",
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "typeId", in: "query", schema: { type: "string" } },
          { name: "locationId", in: "query", schema: { type: "string" }, description: "Includes sub-locations" },
          { name: "assigneeId", in: "query", schema: { type: "string" } },
          ...page,
        ],
        responses: { ...ok("{ data, page, pageSize, total }"), ...errors },
      },
      post: { summary: "Create an asset", requestBody: body({ $ref: "#/components/schemas/AssetInput" }), responses: { ...created("The new asset"), ...errors } },
    },
    "/assets/{id}": {
      get: { summary: "Get an asset (id or tag)", parameters: id, responses: { ...ok("Asset"), ...errors } },
      patch: { summary: "Update some fields of an asset", parameters: id, requestBody: body({ $ref: "#/components/schemas/AssetInput" }), responses: { ...ok("Updated asset"), ...errors } },
    },
    "/assets/{id}/move": {
      post: {
        summary: "Move an asset (recorded in the movement log)",
        parameters: id,
        requestBody: body({ type: "object", required: ["reason"], properties: { toLocationId: { type: "string" }, toAssigneeId: { type: "string" }, clearAssignee: { type: "boolean" }, toStatus: { type: "string" }, reason: { type: "string" }, ticketRef: { type: "string" } } }),
        responses: { ...created("Asset after the move"), ...errors },
      },
    },
    "/assets/{id}/movements": { get: { summary: "Movement history", parameters: [...id, { name: "limit", in: "query", schema: { type: "integer", maximum: 1000 } }], responses: { ...ok("{ data }"), ...errors } } },
    "/asset-types": { get: { summary: "Asset types and custom fields", responses: { ...ok("{ data }"), ...errors } } },
    "/locations": { get: { summary: "All locations with paths", responses: { ...ok("{ data }"), ...errors } } },
    "/people": { get: { summary: "People", parameters: [{ name: "q", in: "query", schema: { type: "string" } }, { name: "active", in: "query", schema: { enum: ["true", "false"] } }, ...page], responses: { ...ok("{ data, page, pageSize, total }"), ...errors } } },
    "/subnets": { get: { summary: "Subnets with usage", parameters: [{ name: "q", in: "query", schema: { type: "string" } }], responses: { ...ok("{ data }"), ...errors } } },
    "/subnets/{id}": { get: { summary: "A subnet with its addresses and next free IP", parameters: id, responses: { ...ok("Subnet"), ...errors } } },
    "/subnets/{id}/allocate": {
      post: {
        summary: "Allocate the next free IP",
        parameters: id,
        requestBody: body({ type: "object", properties: { hostname: { type: "string" }, assetId: { type: "string" }, macAddress: { type: "string" }, status: { enum: ["ASSIGNED", "RESERVED"] }, notes: { type: "string" } } }),
        responses: { ...created("The allocated address"), ...errors },
      },
    },
    "/changes": { get: { summary: "Changes", parameters: [{ name: "view", in: "query", schema: { enum: ["open", "upcoming", "recent", "all"] } }, { name: "status", in: "query", schema: { type: "string" } }, { name: "q", in: "query", schema: { type: "string" } }], responses: { ...ok("{ data }"), ...errors } } },
    "/incidents": {
      get: { summary: "Incidents", parameters: [{ name: "view", in: "query", schema: { enum: ["open", "recent", "all"] } }, { name: "severity", in: "query", schema: { enum: ["P1", "P2", "P3", "P4"] } }, { name: "q", in: "query", schema: { type: "string" } }], responses: { ...ok("{ data }"), ...errors } },
      post: {
        summary: "Open an incident (P1/P2 send alerts)",
        requestBody: body({ type: "object", required: ["title"], properties: { title: { type: "string" }, severity: { enum: ["P1", "P2", "P3", "P4"] }, description: { type: "string" }, impact: { type: "string" }, startedAt: { type: "string", format: "date-time" }, ticketRef: { type: "string" } } }),
        responses: { ...created("The new incident"), ...errors },
      },
    },
    "/search": { get: { summary: "Search across modules", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string", minLength: 2 } }], responses: { ...ok("{ data: hits }"), ...errors } } },
    "/reports/{key}": { get: { summary: "Run a built-in report", parameters: [{ name: "key", in: "path", required: true, schema: { type: "string" } }], responses: { ...ok("{ columns, rows, summary }"), ...errors } } },
  },
};

export function GET() {
  return NextResponse.json(spec, { headers: { "Cache-Control": "public, max-age=300" } });
}
