import { Router } from "express";
import {
  permissionsManifest,
  getFeaturePermissionDetails,
} from "@workspace/permissions-manifest";
import {
  GetM365PermissionsFeatureParams,
  GetM365PermissionsFeatureWithMetadataParams,
} from "@workspace/api-zod";
import { withMetadata } from "../lib/metadata.js";
import { validate } from "../middlewares/validate.js";

const router = Router();

router.get("/m365/permissions/manifest", (_req, res) => {
  return res.json(permissionsManifest);
});

router.get("/m365/permissions/manifest/with-metadata", (_req, res) => {
  return res.json(
    withMetadata(permissionsManifest, {
      permissions: {
        evidenceStatus: "manual",
        confidenceLabel: "high",
        sourceLabel: "@workspace/permissions-manifest",
        notes: ["Static manifest generated from repository source of truth"],
      },
      features: {
        evidenceStatus: "manual",
        confidenceLabel: "high",
        sourceLabel: "@workspace/permissions-manifest",
        notes: ["Static feature-to-permission mapping from code"],
      },
      dataSources: {
        evidenceStatus: "manual",
        confidenceLabel: "medium",
        sourceLabel: "@workspace/permissions-manifest",
        notes: ["Registry metadata maintained in code and updated through release cycles"],
      },
    })
  );
});

router.get(
  "/m365/permissions/feature/:featureId",
  validate({ params: GetM365PermissionsFeatureParams }),
  (req, res) => {
  const { featureId } = req.valid!.params as { featureId: string };
  const feature = getFeaturePermissionDetails(featureId);
  if (!feature) {
    return res.status(404).json({
      error: "Unknown permission feature",
      featureId,
    });
  }
  return res.json(feature);
});

router.get(
  "/m365/permissions/feature/:featureId/with-metadata",
  validate({ params: GetM365PermissionsFeatureWithMetadataParams }),
  (req, res) => {
  const { featureId } = req.valid!.params as { featureId: string };
  const feature = getFeaturePermissionDetails(featureId);
  if (!feature) {
    return res.status(404).json({
      error: "Unknown permission feature",
      featureId,
    });
  }

  return res.json(
    withMetadata(feature, {
      permissionDependency: {
        evidenceStatus: "manual",
        confidenceLabel: "high",
        sourceLabel: "@workspace/permissions-manifest",
        notes: ["Feature dependency classification is defined in source manifest"],
      },
      requiredPermissions: {
        evidenceStatus: "manual",
        confidenceLabel: "high",
        sourceLabel: "@workspace/permissions-manifest",
        notes: ["Permission IDs are static definitions from repository manifest"],
      },
      notes: {
        evidenceStatus: "manual",
        confidenceLabel: "medium",
        sourceLabel: "@workspace/permissions-manifest",
        notes: ["Guidance text is curated and may lag implementation changes"],
      },
    })
  );
});

export default router;
