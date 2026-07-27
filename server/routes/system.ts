import { Router } from "express";
import { getConfigurationReport } from "../config";
import {
  androidAssetLinks,
  appleAppSiteAssociation,
} from "../services/webhooks";
import { data, type RouteContext } from "./shared";

export function createPublicSystemRouter(context: RouteContext): Router {
  const { options } = context;
  const router = Router();

  router.get("/.well-known/apple-app-site-association", (_request, response) => {
    response
      .status(200)
      .type("application/json")
      .send(JSON.stringify(appleAppSiteAssociation(options.getEnv())));
  });

  router.get("/.well-known/assetlinks.json", (_request, response) => {
    response
      .status(200)
      .type("application/json")
      .send(JSON.stringify(androidAssetLinks(options.getEnv())));
  });

  return router;
}

export default function createSystemRouter(context: RouteContext): Router {
  const { integrationService, options } = context;
  const router = Router();

  router.get("/api/health", (_request, response) => {
    data(response, { service: "vinifera-api", status: "ok" });
  });

  router.get("/api/health/configuration", (_request, response) => {
    data(response, getConfigurationReport(options.getEnv()));
  });

  router.get("/api/portal/branding", async (request, response) => {
    if (!getConfigurationReport(options.getEnv()).database.configured) {
      data(response, { brand: null, mode: "canonical" });
      return;
    }
    const host = request.get("host") ?? "";
    data(
      response,
      await integrationService(request, response).getPortalBranding(host),
    );
  });

  return router;
}
