/**
 * Wire shapes of the Graph (and Defender) API responses the collectors consume.
 * Only the fields actually read are declared, and every field is optional —
 * these describe untrusted upstream JSON, so collectors still normalise/default
 * each value. Shared here so the same entity read by several collectors is
 * typed once.
 */

// ── directory objects ─────────────────────────────────────────────────────────

export interface GraphUserBasic {
  id?: string;
  accountEnabled?: boolean;
  userType?: string;
}

export interface GraphUserDetailed extends GraphUserBasic {
  displayName?: string;
  userPrincipalName?: string;
  department?: string;
  jobTitle?: string;
  assignedLicenses?: Array<{ skuId?: string }>;
  signInActivity?: {
    lastSignInDateTime?: string | null;
    lastNonInteractiveSignInDateTime?: string | null;
  };
}

export interface GraphSecurityDefaultsPolicy {
  isEnabled?: boolean;
}

export interface GraphDevice {
  id?: string;
  displayName?: string;
  operatingSystem?: string;
  operatingSystemVersion?: string;
  trustType?: string;
  isManaged?: boolean;
  isCompliant?: boolean | null;
  managementType?: string;
  approximateLastSignInDateTime?: string;
}

export interface GraphServicePrincipal {
  id?: string;
  appId?: string;
  displayName?: string;
  publisherName?: string;
  servicePrincipalType?: string;
  appOwnerOrganizationId?: string;
  createdDateTime?: string;
  tags?: string[];
  accountEnabled?: boolean;
  appRoleAssignmentRequired?: boolean;
  homepage?: string;
  replyUrls?: string[];
  signInActivity?: { lastSignInDateTime?: string };
  passwordCredentials?: GraphKeyCredential[];
  keyCredentials?: GraphKeyCredential[];
}

export interface GraphOAuthGrantWithResource extends GraphOAuthGrant {
  resourceId?: string;
}

export interface GraphKeyCredential {
  keyId?: string;
  displayName?: string;
  startDateTime?: string;
  endDateTime?: string;
  type?: string;
}

export interface GraphApplication {
  id?: string;
  appId?: string;
  displayName?: string;
  createdDateTime?: string;
  signInAudience?: string;
  publisherDomain?: string;
  web?: { redirectUris?: string[] };
  spa?: { redirectUris?: string[] };
  publicClient?: { redirectUris?: string[] };
  owners?: Array<{ id?: string; displayName?: string; accountEnabled?: boolean }>;
  passwordCredentials?: GraphPasswordCredential[];
  keyCredentials?: GraphKeyCredential[];
  requiredResourceAccess?: Array<{
    resourceAppId?: string;
    resourceAccess?: Array<{ id?: string; type?: string }>;
  }>;
}

export interface GraphPasswordCredential extends GraphKeyCredential {
  hint?: string;
}

/** The subset of a service principal's permission definitions used to resolve scope ids to names. */
export interface GraphPermissionDefiningSP {
  appRoles?: Array<{ id?: string; value?: string }>;
  oauth2PermissionScopes?: Array<{ id?: string; value?: string }>;
}

export interface GraphAuthorizationPolicy {
  defaultUserRolePermissions?: { allowedToCreateApps?: boolean };
}

export interface GraphOAuthGrant {
  clientId?: string;
  consentType?: string;
  principalId?: string | null;
  scope?: string;
}

export interface GraphAppRoleAssignment {
  appRoleId?: string;
  principalId?: string;
  principalDisplayName?: string;
  resourceId?: string;
  resourceDisplayName?: string;
  createdDateTime?: string;
}

// ── security ──────────────────────────────────────────────────────────────────

export interface GraphControlScore {
  controlName?: string;
  controlCategory?: string;
  description?: string;
  score?: number | string;
  maxScore?: number | string;
  controlContributionToScore?: number | string;
  scoreInPercentage?: number | string;
  implementationStatus?: string;
  lastSynced?: string;
}

export interface GraphSecureScore {
  currentScore?: number;
  maxScore?: number;
  createdDateTime?: string;
  controlScores?: GraphControlScore[];
}

export interface GraphControlProfile {
  id?: string;
  title?: string;
  maxScore?: number | string;
}

export interface GraphCAPolicyConditions {
  users?: {
    includeUsers?: string[];
    includeRoles?: string[];
    includeGroups?: string[];
  };
  applications?: {
    includeApplications?: string[];
    includeUserActions?: string[];
  };
  clientAppTypes?: string[];
}

export interface GraphCAPolicyGrantControls {
  builtInControls?: string[];
  authenticationStrength?: { displayName?: string };
}

export interface GraphCAPolicy {
  id?: string;
  displayName?: string;
  state?: string;
  conditions?: GraphCAPolicyConditions;
  grantControls?: GraphCAPolicyGrantControls | null;
  sessionControls?: unknown;
  modifiedDateTime?: string;
}

export interface GraphRegistrationDetail {
  id?: string;
  userPrincipalName?: string;
  userDisplayName?: string;
  isMfaRegistered?: boolean;
  isPasswordlessCapable?: boolean;
  isSsprRegistered?: boolean;
  methodsRegistered?: string[];
}

export interface GraphRiskDetection {
  activityDateTime?: string;
  detectedDateTime?: string;
  riskLevel?: string;
}

export interface GraphRiskyUser {
  id?: string;
  userDisplayName?: string;
  userPrincipalName?: string;
  riskLevel?: string;
  riskState?: string;
  riskLastUpdatedDateTime?: string;
}

export interface GraphAlertV2 {
  id?: string;
  title?: string;
  severity?: string;
  status?: string;
  serviceSource?: string;
  category?: string;
  createdDateTime?: string;
}

export interface GraphIncident {
  id?: string;
  status?: string;
  createdDateTime?: string;
}

/** Defender for Endpoint machine (api.security.microsoft.com/api/machines). */
export interface MdeMachine {
  id?: string;
  aadDeviceId?: string | null;
  computerDnsName?: string;
  deviceName?: string;
  osPlatform?: string;
  osProcessor?: string;
  osVersion?: string;
  lastSeen?: string;
}

// ── intune ────────────────────────────────────────────────────────────────────

export interface GraphManagedDevice {
  id?: string;
  deviceName?: string;
  azureADDeviceId?: string;
  userDisplayName?: string;
  userPrincipalName?: string;
  operatingSystem?: string;
  osVersion?: string;
  complianceState?: string;
  managementAgent?: string;
  managementState?: string;
  deviceType?: string;
  lastSyncDateTime?: string;
  enrolledDateTime?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  isEncrypted?: boolean;
  isSupervised?: boolean;
  jailBroken?: string;
  deviceEnrollmentType?: string;
  managedDeviceOwnerType?: string;
  totalStorageSpaceInBytes?: number;
  freeStorageSpaceInBytes?: number;
  windowsProtectionState?: { tamperProtectionEnabled?: boolean | null };
}

export interface GraphCompliancePolicy {
  id?: string;
  displayName?: string;
  description?: string;
  "@odata.type"?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
  version?: number;
  assignments?: unknown[];
}

export interface GraphEnrollmentConfiguration {
  id?: string;
  displayName?: string;
  enrollmentConfigurationType?: string;
  priority?: number;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

export interface GraphComplianceDeviceStateSummary {
  compliantDeviceCount?: number;
  nonCompliantDeviceCount?: number;
  remediatedDeviceCount?: number;
  notApplicableDeviceCount?: number;
  notAssignedDeviceCount?: number;
  inGracePeriodCount?: number;
  configManagerCount?: number;
}

export interface GraphConfigurationProfile {
  id?: string;
  displayName?: string;
  name?: string;
  "@odata.type"?: string;
  platforms?: string;
  technologies?: string;
  createdDateTime?: string;
  lastModifiedDateTime?: string;
}

export interface GraphCompliancePolicyState {
  id?: string;
  displayName?: string;
  platformType?: string;
  state?: string;
  lastReportedDateTime?: string | null;
}

export interface GraphDeviceComplianceSettingState {
  setting?: string;
  settingName?: string;
  state?: string;
  errorDescription?: string;
}

export interface GraphMobileApp {
  id?: string;
  displayName?: string;
  publisher?: string;
  "@odata.type"?: string;
  createdDateTime?: string;
  isAssigned?: boolean;
}

export interface GraphDetectedApp {
  id?: string;
  displayName?: string;
  version?: string;
  publisher?: string;
  deviceCount?: number;
  platform?: string;
}

// ── compliance ────────────────────────────────────────────────────────────────

export interface GraphDlpPolicy {
  mode?: string;
}

export interface GraphSensitivityLabel {
  id?: string;
  name?: string;
  description?: string;
  tooltip?: string;
  color?: string;
  sensitivity?: number;
  isActive?: boolean;
  isAppliable?: boolean;
  hasProtection?: boolean;
  contentFormats?: string[];
  parent?: { id?: string } | null;
}

// ── licensing ─────────────────────────────────────────────────────────────────

export interface GraphSubscribedSku {
  skuId?: string;
  skuPartNumber?: string;
  consumedUnits?: number;
  prepaidUnits?: { enabled?: number; suspended?: number; warning?: number };
}

// ── domains / teams ───────────────────────────────────────────────────────────

export interface GraphDomain {
  id?: string;
  isVerified?: boolean;
  supportedServices?: string[];
}

export interface GraphServiceConfigurationRecord {
  recordType?: string;
  text?: string;
}

export interface GraphTeam {
  id?: string;
  displayName?: string;
  visibility?: string;
  isArchived?: boolean;
}

// ── service health ────────────────────────────────────────────────────────────

export interface GraphHealthOverview {
  id?: string;
  service?: string;
  status?: string;
}

export interface GraphServiceIssue {
  service?: string;
  classification?: string;
}

// ── reports (usage CSV rows are parsed elsewhere; these are JSON endpoints) ──

export interface GraphOrganization {
  id?: string;
  displayName?: string;
  verifiedDomains?: Array<{ name?: string; isDefault?: boolean; isInitial?: boolean }>;
  assignedPlans?: Array<{ service?: string; capabilityStatus?: string }>;
  createdDateTime?: string;
  onPremisesSyncEnabled?: boolean | null;
  onPremisesLastSyncDateTime?: string | null;
}
