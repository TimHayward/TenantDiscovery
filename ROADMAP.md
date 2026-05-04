# Product Overview

The tool provides a clear, evidence-led view of a client’s Microsoft 365 tenant, helping organisations understand how securely their environment is configured, which Microsoft 365 capabilities are being used, and where value is being missed.

It is designed to bridge the gap between executive visibility and technical evidence. Decision makers receive a concise view of tenant health, security posture, licence utilisation, adoption and operational risk. Architects, internal IT teams and managed service providers receive the supporting detail needed to investigate findings, prioritise remediation and develop actionable improvement plans.

The platform assesses the tenant across identity, access, devices, applications, collaboration, data protection, security controls, licensing and workload usage. Findings are measured against Microsoft best practice, recognised security baselines, customer policy and historical tenant trends. This allows organisations to understand not only what is configured, but whether it is effective, whether it is being used, and whether it aligns with the business outcome intended.

The objective is to turn Microsoft 365 tenant data into practical insight. It should help customers identify risk, reduce waste, improve adoption, strengthen governance and create a clear roadmap for continual improvement.

## Shorter product positioning statement

A Microsoft 365 tenant visibility and optimisation platform that combines security posture, capability adoption and platform usage into a single evidence-led health report for executives, architects and managed service providers.

## More strategic version

The product exists to make Microsoft 365 environments easier to understand, govern and improve.

It gives organisations a structured view of their tenant, showing how securely the platform is configured, which capabilities are actively being leveraged, where licences and workloads are underused, and where technical or operational risk exists.

The platform is built for two audiences. Executives receive a clear overview of risk, value, adoption and improvement priorities. Technical teams receive the evidence, object-level detail and benchmark mapping required to build remediation plans or managed service proposals.

Its north star is simple: provide trusted visibility of the Microsoft 365 tenant, translate that visibility into business and technical insight, and help customers move from assessment to measurable improvement.

## Product principles

1. **Visibility before remediation**  
    The tool should show what exists, what is configured, what is being used and what is exposed before recommending change.
    
2. **Executive clarity with technical evidence**  
    Every executive-level conclusion should be traceable to supporting tenant evidence.
    
3. **Security and value in one view**  
    The product should treat Microsoft 365 health as both a security and value realisation question.
    
4. **Benchmark-led, not opinion-led**  
    Findings should be measured against Microsoft guidance, recognised baselines, customer policy and previous tenant state.
    
5. **Actionable by design**  
    The output should help customers prioritise remediation, justify investment and track improvement over time.
    
6. **Useful for both internal IT and MSPs**  
    The evidence should support internal improvement planning and external remediation proposals.
    

## One-line version

A Microsoft 365 tenant health platform that turns security posture, capability adoption and platform usage data into executive insight and architect-ready evidence.

# Considerations
The following considerations persist in developing the application:

1. **Graph alone will not be enough.** Microsoft Graph gives you strong coverage for identity, usage, Secure Score, service health, sign-ins, app registrations, Intune and security objects, but some Exchange, Teams, SharePoint, Purview and Defender configuration evidence will still require workload-specific APIs, PowerShell modules or export connectors.
    
2. **Do not create a single “health score” without explain-ability.** Executives want simplicity, but architects need to see why a score moved. Every score should trace back to evidence, impacted objects, benchmark mapping and recommended action.
    
3. **Treat licence “waste” carefully.** Inactive usage does not always mean removable licensing. Shared mailboxes, leavers under retention, executives, frontline workers, privileged admins, service accounts and project-based users all distort simple usage logic.
    
4. **Privacy needs to be designed in from day one.** Microsoft 365 usage reports support 7, 30, 90 and 180 day periods, but identifiable user information may be affected by reporting privacy settings. Your app should support pseudonymised executive views and identifiable architect views only where consent and role permissions allow it.
    
5. **Competition: The market gap is not data collection. It is translation.** CloudCapsule positions around automated Microsoft 365 security assessment, remediation, monitoring and framework mapping, while TBSC positions around Microsoft 365 usage, licensing and SaaS efficiency. Your differentiator should be turning technical findings into board-level risk, then into architect-ready remediation evidence.
    

## Recommended report structure

I would build the product around two linked views:

**Executive Overview**

A concise, decision-maker view covering risk, cost, adoption, resilience and remediation priority.

**Technical Evidence Pack**

A drill-through evidence model for architects, internal IT teams and MSPs, with raw findings, impacted objects, benchmark mappings, remediation guidance and exportable tables.

The key is that every executive card should have a “show evidence” path.

---

## 1. Tenant summary and commercial baseline

|Area|Information to visualise|Measure against|Executive visualisations|Detail sections|
|---|---|---|---|---|
|Tenant profile|Tenant name, default domain, verified domains, region, creation date where available, subscribed services, active workloads|Customer profile, intended Microsoft 365 architecture, licensing contract|Tenant summary card|Tenant metadata table|
|Licence estate|Subscribed SKUs, consumed units, available units, disabled service plans, add-ons, direct versus group-based assignment|Purchased entitlement, role-based licensing model, renewal position|Licence utilisation gauge, cost exposure card, unused licence value estimate|User licence assignment table, SKU inventory, service plan matrix|
|User population|Total users, licensed users, unlicensed users, guests, disabled users, stale users, service accounts|HR source of truth, joiner mover leaver policy, 30/60/90/180 day activity|User estate composition donut, stale account trend|User inventory, stale users, disabled licensed users, guest user table|
|Adoption baseline|Active users by workload across Exchange, Teams, SharePoint, OneDrive, Microsoft 365 Apps and Copilot where licensed|Microsoft 365 usage report periods, internal adoption goals, persona expectations|Workload adoption heatmap, licence adoption funnel|Workload activity by user, department, role or persona|

Microsoft Graph reports are specifically intended to help understand application and resource activity in a Microsoft Entra tenant, and Microsoft 365 admin centre usage reports are generally available for 7, 30, 90 and 180 day periods.

---

## 2. Security posture and control maturity

| Area                 | Information to visualise                                                                     | Measure against                                                                    | Executive visualisations                                                  | Detail sections                                                |
| -------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Secure Score         | Current Secure Score, score trend, completed actions, incomplete actions, regressed controls | Microsoft Secure Score, Microsoft recommended actions, previous scan baseline      | Security posture score, 90-day trend, top score improvement opportunities | Secure Score control table, completed and incomplete actions   |
| Framework coverage   | Control alignment across CIS, NIST CSF, Cyber Essentials, internal baseline                  | CIS Microsoft 365 Benchmark, NCSC Cyber Essentials, NCSC CAF, customer control set | Control coverage matrix, risk heatmap                                     | Framework mapping table, control evidence, pass fail rationale |
| Remediation priority | High impact findings, high exposure objects, quick wins, complex remediation items           | Risk severity, effort, blast radius, dependency, business impact                   | 30/60/90 day remediation roadmap                                          | Remediation register with owners, dependencies and scripts     |
| Drift                | Changes since last scan, newly failed controls, newly introduced risky objects               | Previous scan, change window, approved configuration baseline                      | “What changed?” card                                                      | Delta table by object, control and date                        |

Microsoft Secure Score is a measurement of an organisation’s security posture, with a higher number indicating more recommended actions taken. Graph exposes secure score objects, and the secureScore resource represents tenant and control level scoring data with 90 days of data held by default.

For external benchmarks, use CIS as a prescriptive secure configuration baseline for Microsoft 365, and use NCSC Cyber Essentials or CAF where UK relevance matters. CIS describes its Microsoft 365 Benchmark as secure configuration guidance, while NCSC describes Cyber Essentials as five technical controls aimed at common internet-based threats and CAF as a framework to assess and improve cyber security and resilience.

---

## 3. Identity and access management

|Area|Information to visualise|Measure against|Executive visualisations|Detail sections|
|---|---|---|---|---|
|MFA coverage|Users registered for MFA, users not capable of strong auth, admins without strong auth, legacy MFA methods|Microsoft Entra recommendations, Cyber Essentials MFA expectations, internal identity baseline|MFA coverage gauge, privileged MFA exception card|MFA registration table, auth method table|
|Conditional Access|Number of policies, enabled policies, report-only policies, disabled policies, exclusions, target users, target apps, grant controls|Microsoft Zero Trust access baseline, customer policy design, break glass standard|Conditional Access maturity radar|Conditional Access policy matrix|
|Privileged access|Global admins, privileged role assignments, permanent versus eligible access, inactive privileged accounts|Least privilege model, PIM target state, named admin account policy|Privilege exposure card|Role assignment table, PIM coverage table|
|Risk and sign-ins|Risky users, risky sign-ins, failed sign-ins, impossible travel, legacy protocol sign-ins, sign-ins blocked by CA|Entra ID Protection risk model, Conditional Access policy objectives|Identity risk trend, risky sign-in map|Risk detection table, sign-in evidence table|
|Guest access|Guest count, inactive guests, guests with group or team access, external domains, stale invitations|B2B governance policy, access review policy|External access exposure card|Guest user table, group and site access table|

Graph exposes Conditional Access policies, sign-in logs with applied Conditional Access policy data where permissions allow, role assignments, PIM APIs for Microsoft Entra roles and Microsoft Entra ID Protection risk detections.

---

## 4. App registrations, enterprise apps and API permissions

This should be a first-class section. It is often underreported, but it is one of the most valuable areas for architects and MSPs.

|Area|Information to visualise|Measure against|Executive visualisations|Detail sections|
|---|---|---|---|---|
|App inventory|App registrations, service principals, owners, publisher verification, sign-in audience, last activity where available|Application governance standard, ownership policy|Application risk summary|App registration inventory|
|Credentials|Client secrets, certificates, expired credentials, long-lived credentials, credentials expiring soon, apps without owners|Credential lifetime policy, certificate preferred model|Expiring credential risk card|Secret and certificate expiry table|
|Permissions|Delegated permissions, application permissions, high privilege Graph permissions, admin consent grants|Least privilege, approved API access catalogue|High privilege app exposure card|API permission table, admin consent evidence|
|Orphaned apps|No owners, no recent sign-in, stale reply URLs, unused enterprise apps|App lifecycle policy|Orphaned application count|Orphaned and stale app table|
|Multi-tenant exposure|Multi-tenant apps, external publishers, unverified publishers, risky consent grants|Publisher verification policy, consent governance model|Third-party access risk heatmap|Enterprise app consent table|

Microsoft documents application and service principal objects as the core model for app registrations and enterprise app instances, and Microsoft Graph can list and manage applications, service principals, permissions and credentials.

---

## 5. Endpoint and Intune posture

|Area|Information to visualise|Measure against|Executive visualisations|Detail sections|
|---|---|---|---|---|
|Device inventory|Entra registered devices, Intune managed devices, ownership, OS, compliance state, encryption, jailbroken or rooted status where exposed|Intune compliance policy, Cyber Essentials device scope, internal endpoint standard|Managed versus unmanaged device card|Device inventory table|
|Compliance|Compliant, non-compliant, unknown, grace period, last check-in|Compliance policy baseline|Compliance heatmap by OS and department|Non-compliant device table|
|Platform coverage|Windows, macOS, iOS, iPadOS, Android, Linux where applicable|Supported platform standard|Platform estate chart|OS version and support table|
|Update exposure|OS version drift, unsupported operating systems, stale check-ins|Security update management policy, vendor support lifecycle|Unsupported OS risk card|Update and OS version detail|
|Configuration|Security baselines, Defender onboarding, disk encryption, firewall, local admin exposure where available|Intune security baseline, Defender baseline, CIS endpoint benchmark|Endpoint control maturity radar|Policy assignment and setting compliance table|

Graph exposes Intune managed devices through `deviceManagement/managedDevices`, but Microsoft notes that the Intune Graph API requires an active Intune licence for the tenant.

---

## 6. Email and Exchange Online security

|Area|Information to visualise|Measure against|Executive visualisations|Detail sections|
|---|---|---|---|---|
|Mailbox activity|Active mailboxes, inactive licensed mailboxes, mailbox size, archive usage|Usage report baseline, retention policy, licence policy|Mailbox usage and storage trend|Mailbox usage table|
|Mail flow risk|Forwarding rules, inbox rules to external domains, transport rules, accepted domains, connectors|Exchange security baseline, data loss policy|External forwarding risk card|Forwarding and transport rule evidence|
|Authentication|SMTP AUTH exposure, legacy protocol activity, mailbox protocol settings|Modern authentication policy|Legacy protocol exposure chart|Protocol usage table|
|Anti-phishing and protection|Defender for Office policies, safe links, safe attachments, anti-spam, anti-phishing|Microsoft Defender for Office baseline, Secure Score|Email protection coverage matrix|Policy comparison table|
|DMARC posture|SPF, DKIM, DMARC records for accepted domains|Public DNS standards, NCSC email security guidance, Microsoft guidance|Domain email authentication status|Domain DNS evidence table|

This is an area where you will probably need Exchange Online PowerShell alongside Graph. Graph usage reports can provide email activity detail, but many protection and transport settings remain workload-specific.

---

## 7. SharePoint, OneDrive and Teams collaboration risk

|Area|Information to visualise|Measure against|Executive visualisations|Detail sections|
|---|---|---|---|---|
|SharePoint estate|Site count, active sites, inactive sites, storage used, ownership, sensitivity labels where available|Information architecture standard, site lifecycle policy|Site sprawl and storage trend|Site inventory table|
|External sharing|Anonymous links, external users, externally shared files, sharing settings by site|Collaboration governance policy, sensitivity model|External sharing exposure card|External sharing evidence table|
|OneDrive usage|Active users, storage, inactive OneDrive accounts, orphaned OneDrives|Leaver process, retention policy, usage expectations|OneDrive adoption and orphaned storage|OneDrive usage table|
|Teams usage|Active teams, inactive teams, private channels, shared channels, guest access, meetings, chat and call activity|Teams governance standard, lifecycle policy|Teams adoption and risk quadrant|Teams activity and governance table|
|Information ownership|Sites and teams without owners, single-owner teams, stale owners|Ownership policy|Ownership risk card|Owner exception table|

TBSC explicitly references usage analysis across Teams, SharePoint, OneDrive and Exchange, and Microsoft Graph has workload usage report endpoints including active users and Teams user activity detail.

---

## 8. Data protection, Purview and Copilot readiness

|Area|Information to visualise|Measure against|Executive visualisations|Detail sections|
|---|---|---|---|---|
|Sensitivity labelling|Published labels, label policies, label adoption, unlabelled sensitive repositories where available|Purview information protection design|Data protection maturity card|Label policy and adoption table|
|DLP|DLP policies, locations covered, test versus active mode, rule matches, policy gaps|DLP operating model, regulatory needs, GDPR obligations|DLP coverage by workload|DLP policy evidence table|
|Retention|Retention labels, retention policies, unmanaged repositories, inactive mailboxes|Records management policy, legal hold requirements|Retention coverage card|Retention policy table|
|Audit|Audit enabled, audit retention, high value audit events, privileged operations|Audit and investigation standard|Audit readiness status|Audit evidence table|
|Copilot readiness|Copilot licences, active users, adoption, high-risk sharing, unlabelled content, overshared sites|Microsoft 365 Copilot readiness baseline, data governance standard|Copilot readiness score|Oversharing, label and usage evidence|

The Microsoft 365 Copilot usage report supports 7, 30, 90 and 180 day views, but the Graph Copilot user detail endpoint is currently documented under beta, so I would isolate it as an optional module rather than a core dependency.

---

## 9. Defender, incidents and operational security

|Area|Information to visualise|Measure against|Executive visualisations|Detail sections|
|---|---|---|---|---|
|Incidents|Open incidents, severity, status, age, assigned owner, affected users and devices|Security operations SLA, incident response process|Incident exposure card|Incident detail table|
|Alerts|Alert count, severity, source, status, category, age|SOC triage SLA, Defender baseline|Alert trend by severity|Alert evidence table|
|Risk exposure|Risky users, risky service principals, compromised sign-ins, unresolved alerts|Identity Protection, Defender XDR, Zero Trust operating model|Active risk heatmap|Risk register|
|Device security score|Endpoint configuration state, vulnerable devices, Defender coverage|Microsoft Secure Score for Devices, Defender Vulnerability Management baseline|Endpoint risk posture|Device exposure table|

Microsoft Graph Security API provides a unified interface for Microsoft and partner security solutions, and Microsoft documents incident and alert resources for Microsoft Defender XDR through Graph.

---

## 10. Service health and operational resilience

|Area|Information to visualise|Measure against|Executive visualisations|Detail sections|
|---|---|---|---|---|
|Service health|Current service health by subscribed service, advisories, incidents, restored incidents|Microsoft service health feed|Current service status board|Service health table|
|Message centre|High impact changes, retirement notices, feature changes, admin action required|Change management process|Upcoming change timeline|Message centre action table|
|Backup and recovery posture|Entra backup capability, third-party backup coverage, retention dependencies, Exchange and SharePoint restore posture|Business continuity requirements, RPO and RTO, SaaS backup policy|Recovery confidence card|Backup coverage table|
|Admin operations|Recent privileged changes, risky configuration changes, change drift|CAB and change policy|Change drift summary|Audit change evidence|

Graph service communications APIs expose service health status and Message Centre posts for subscribed Microsoft 365 and Dynamics 365 services.

---

# What to measure against

Use five measurement layers rather than one universal baseline.

## 1. Microsoft native baselines

Use these for immediate posture measurement:

|Baseline|Use|
|---|---|
|Microsoft Secure Score|Security posture, recommended actions, trend tracking|
|Microsoft Entra recommendations|Identity health, security and usage recommendations|
|Intune compliance and security baselines|Endpoint configuration and compliance|
|Defender recommendations and incidents|Threat exposure and operational risk|
|Microsoft 365 usage reports|Adoption, activity, workload consumption|
|Service Health and Message Centre|Operational resilience and change readiness|

## 2. External frameworks

Use these for credibility and audit-friendly mapping:

|Framework|Use|
|---|---|
|CIS Microsoft 365 Foundations Benchmark|Secure configuration baseline|
|NIST CSF 2.0|Broad cyber risk management alignment|
|NCSC Cyber Essentials|UK baseline cyber hygiene, especially SMB and public sector adjacent customers|
|NCSC CAF|UK public sector, regulated and essential service resilience framing|
|ISO 27001 control mapping|Governance and assurance alignment|
|GDPR principles|Data protection, access control, retention and audit evidence|

CloudCapsule explicitly references mapping assessments to frameworks such as CIS Controls, NIST CSF 2.0 and Essential 8, which validates this style of framework-led reporting in the market.

## 3. Customer policy baseline

This should be configurable:

|Baseline|Example|
|---|---|
|MFA policy|All users covered by Conditional Access, break glass excluded but monitored|
|Admin model|No standing Global Admin except emergency accounts|
|Device standard|Only compliant managed devices access business data|
|Sharing standard|No anonymous links on sensitive SharePoint sites|
|Lifecycle policy|Disabled users reviewed after 30 days, stale guests removed after 90 days|
|Licence policy|Licence removed after 60 or 90 days inactivity unless exception exists|

## 4. Historical tenant baseline

This is essential for MSP value:

|Baseline|Use|
|---|---|
|Previous scan|Show improvement or regression|
|First scan|Establish starting position|
|Monthly scan trend|Show managed service value|
|Control drift|Identify configuration changes and recurring hygiene issues|

## 5. Commercial and adoption baseline

This should drive the executive conversation:

|Baseline|Use|
|---|---|
|Purchased licences versus active usage|Licence efficiency|
|Assigned services versus enabled services|Entitlement realisation|
|Workload usage versus persona expectations|Adoption opportunity|
|Add-on usage|Teams Phone, Copilot, Defender, Purview, Power BI, Audio Conferencing|
|Third-party overlap|Potential ISV displacement|

---

# Executive visualisations to include

## Core executive dashboard

|Visual|Purpose|
|---|---|
|Overall health score by domain|One-page view of tenant condition|
|Security posture trend|Show whether risk is improving or degrading|
|Risk heatmap|Severity versus likelihood or exposure|
|Top 10 executive risks|Make the report decision-oriented|
|Licence efficiency score|Show financial opportunity|
|Adoption heatmap|Show where Microsoft 365 value is or is not being realised|
|Remediation roadmap|Convert assessment into action|
|Framework coverage matrix|Show control maturity against CIS, NCSC, NIST or internal baseline|
|Change since last scan|Show MSP managed service value|
|Business impact cards|Translate technical issues into cost, risk, productivity or compliance impact|

## Suggested executive score domains

Use separate scores, not one blended number only:

1. **Identity security**
    
2. **Endpoint management**
    
3. **Collaboration governance**
    
4. **Data protection**
    
5. **Threat protection**
    
6. **Licence efficiency**
    
7. **Workload adoption**
    
8. **Operational resilience**
    
9. **Copilot readiness**
    
10. **Remediation progress**
    

A single “tenant health score” can sit above these, but it should always be decomposable.

---

# Architect and MSP evidence sections

These are the tables I would include in the detailed evidence pack.

## 1. Findings register

|Column|
|---|
|Finding ID|
|Domain|
|Severity|
|Business impact|
|Technical impact|
|Affected objects|
|Current state|
|Recommended state|
|Benchmark reference|
|Evidence source|
|Remediation summary|
|Estimated effort|
|Dependencies|
|Owner|
|Target date|
|Status|

## 2. Control mapping table

|Column|
|---|
|Control ID|
|Control name|
|Framework|
|Requirement|
|Tenant evidence|
|Pass fail partial not assessed|
|Impacted objects|
|Remediation action|
|Exception rationale|
|Last assessed|

## 3. Identity evidence table

|Column|
|---|
|User|
|User type|
|Licence|
|MFA capable|
|Authentication methods|
|Last sign-in|
|Risk state|
|Admin roles|
|Conditional Access coverage|
|Account enabled|
|Department|
|Exception flag|

## 4. Conditional Access policy matrix

|Column|
|---|
|Policy name|
|State|
|Included users|
|Excluded users|
|Included apps|
|Conditions|
|Grant controls|
|Session controls|
|Report-only or enforced|
|Break glass impact|
|Gaps identified|

## 5. Privileged access table

|Column|
|---|
|Principal|
|Principal type|
|Role|
|Assignment type|
|Permanent or eligible|
|Scope|
|MFA status|
|Last sign-in|
|PIM enabled|
|Owner|
|Risk note|

## 6. App registration and consent table

|Column|
|---|
|App name|
|App ID|
|Owner|
|Publisher|
|Single or multi-tenant|
|Credential type|
|Credential expiry|
|Application permissions|
|Delegated permissions|
|Admin consent granted|
|Last sign-in|
|Risk classification|
|Recommended action|

## 7. Device compliance table

|Column|
|---|
|Device name|
|User|
|Platform|
|OS version|
|Ownership|
|Managed by|
|Compliance state|
|Last check-in|
|Encryption|
|Defender status|
|Jailbroken or rooted|
|Risk note|

## 8. Licence optimisation table

|Column|
|---|
|User|
|Assigned SKU|
|Cost estimate|
|Last activity by workload|
|Services used|
|Services unused|
|Suggested licence|
|Potential saving|
|Confidence level|
|Exception reason|

## 9. Workload adoption table

|Column|
|---|
|User or department|
|Exchange activity|
|Teams activity|
|SharePoint activity|
|OneDrive activity|
|Microsoft 365 Apps activity|
|Copilot activity|
|Last active date|
|Adoption segment|

## 10. SharePoint and Teams governance table

|Column|
|---|
|Site or Team|
|Owner count|
|Last activity|
|Guest access|
|External sharing status|
|Anonymous links|
|Sensitivity label|
|Storage used|
|Connected group|
|Risk classification|
|Recommended action|

## 11. Exchange security evidence table

|Column|
|---|
|Mailbox|
|Forwarding enabled|
|External forwarding target|
|Inbox rule risk|
|SMTP AUTH|
|Archive enabled|
|Litigation hold or retention|
|Last activity|
|Risk classification|

## 12. Service health and change table

|Column|
|---|
|Service|
|Advisory or incident|
|Status|
|Impact|
|Start time|
|Last update|
|Admin action required|
|Workload affected|
|Business relevance|
|Owner|

---

# Recommended product modules

## MVP module set

Start with the modules that offer the strongest executive value and the cleanest API access:

1. Tenant and licence overview
    
2. Microsoft 365 workload usage
    
3. Secure Score and security recommendations
    
4. Users, guests and stale accounts
    
5. Conditional Access summary
    
6. Privileged roles
    
7. App registrations and credentials
    
8. Intune device compliance
    
9. Service health and Message Centre
    
10. Findings register and remediation roadmap
    

## Phase two modules

Add these once the product has enough customer evidence:

1. Exchange Online deep security posture
    
2. SharePoint and Teams external sharing analysis
    
3. Purview labels, DLP and retention posture
    
4. Defender XDR incidents and alerts
    
5. Copilot readiness and adoption
    
6. ISV displacement and entitlement realisation
    
7. Multi-tenant MSP dashboard
    
8. Monthly drift detection
    
9. Proposal builder for MSP remediation projects
    
10. Board pack export and technical appendix export
    

---

# Recommended data model for each finding

Every finding should be stored as a structured object, not just report text.

|Field|Purpose|
|---|---|
|Finding ID|Stable reference|
|Domain|Identity, endpoint, data, licence, adoption|
|Severity|Critical, high, medium, low, advisory|
|Confidence|High, medium, low|
|Evidence|The exact tenant evidence|
|Impacted objects|Users, devices, apps, sites, policies|
|Benchmark|Microsoft, CIS, NCSC, custom|
|Recommended state|What good looks like|
|Remediation|Human-readable remediation|
|Automation|Optional script or Graph action|
|Effort|Low, medium, high|
|Dependency|Licence, role, business decision, change window|
|Business impact|Risk, cost, compliance, productivity|
|MSP service opportunity|Discovery, remediation, managed service, adoption|
|Status|New, accepted, remediated, exception, not applicable|

---

# Strong product differentiators

The product should not simply say “you have 42 recommendations”. It should say:

|Capability|Why it matters|
|---|---|
|Executive to evidence drill-through|Prevents the board pack and technical pack becoming disconnected|
|Licence value and security posture in one report|Reflects how Microsoft 365 decisions are actually funded|
|Framework mapping|Helps MSPs and internal IT justify remediation|
|Change since last scan|Creates managed service value|
|Proposal-ready remediation packs|Turns assessment into pipeline|
|Exception management|Prevents repeated false positives|
|Persona-aware licence analysis|Avoids simplistic licence waste conclusions|
|Pseudonymised executive mode|Reduces privacy friction|
|Multi-tenant MSP view|Makes it commercially scalable|
|Benchmark versioning|Maintains audit credibility when CIS, Microsoft or NCSC guidance changes|

---

# Suggested report outputs

|Output|Audience|Format|
|---|---|---|
|Executive health report|Board, SLT, IT leadership|PDF or PowerPoint|
|Technical evidence workbook|Architects, internal IT, MSP consultants|Excel or interactive web tables|
|Remediation roadmap|IT leadership, project managers|Kanban, CSV, Planner, DevOps export|
|Control mapping pack|Compliance, audit, security|Excel or PDF|
|Licence optimisation pack|IT, finance, procurement|Excel and executive summary|
|MSP proposal pack|MSP sales and pre-sales|Word or PowerPoint|
|Monthly drift report|Managed service customers|Portal and PDF|
|Exception register|Security governance|Web table and export|

---

# My recommended navigation model

Use these top-level sections in the app:

1. **Overview**
    
2. **Security Posture**
    
3. **Identity**
    
4. **Devices**
    
5. **Apps and Permissions**
    
6. **Collaboration**
    
7. **Data Protection**
    
8. **Email Security**
    
9. **Defender and Incidents**
    
10. **Licensing**
    
11. **Adoption**
    
12. **Service Health**
    
13. **Framework Mapping**
    
14. **Remediation Plan**
    
15. **Evidence Export**
    

The executive overview should only show the first-level story. The technical sections should carry the detail.

---

# Final design principle executive overview should only show the first-level story. The technical sections should carry the detail.

---

# Final

Build the app around this logic:

**What do we own?**  
Licences, users, devices, apps, services, policies and data locations.

**What is being used?**  
Workload activity, adoption, service consumption and inactive spend.

**What is exposed?**  
Identity risk, weak access controls, unmanaged devices, over-permissive apps, external sharing and unprotected data.

**What should be true?**  
Microsoft recommendations, CIS, NCSC, internal policy and licence entitlement.

---

Below is a sprint-based delivery plan that assumes **two-week sprints**, with the initial release constrained to data that can be retrieved through **Microsoft Graph and other Microsoft APIs using an app registration**.

The current repository is a sensible foundation. It already appears to be a TypeScript pnpm monorepo, with an Express API server, React and Vite dashboard, Recharts, TanStack Table, shadcn/ui, PostgreSQL and Drizzle ORM. The current dashboard sections are listed as Overview, Users & Identity, Licences, Security, Exchange Online, Teams & SharePoint, Compliance & Health and Intune. The current API integration is already app-registration based, using `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`. ([GitHub](https://raw.githubusercontent.com/TimHayward/TenentDiscovery/main/replit.md "raw.githubusercontent.com"))

# Delivery principle

The product should move through four clear product horizons:

|Horizon|Product intent|Outcome|
|---|---|---|
|MVP|API-backed tenant visibility|A working health report based on Microsoft Graph and app-registration accessible Microsoft APIs|
|Release 1|Evidence completeness|Manual checks clearly labelled, exportable, and structured for architect use|
|Release 2|Automation expansion|Additional Microsoft APIs, PowerShell collectors, third-party APIs and ingestion jobs|
|Release 3|Security baseline alignment|Findings mapped to Microsoft, CIS, NCSC, Cyber Essentials and custom baselines|
|Release 4|Licence intelligence|Deeper recommendations for licence uplift, consolidation, right-sizing and value realisation|

# Data confidence model

Every report section should carry a data confidence label from the first release.

| Label                     | Meaning                                                                                                   | Example                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **API Backed**            | The finding is directly evidenced from Microsoft Graph or another supported Microsoft API                 | Secure Score, user registration details, subscribed SKUs                                   |
| **Partially API Backed**  | The product can evidence part of the finding, but not the full configuration state                        | Teams and SharePoint governance indicators                                                 |
| **Manual Check Required** | The product cannot currently retrieve reliable evidence through the supported API model                   | Some Exchange Online transport and protection policies                                     |
| **Automation Candidate**  | Not available in MVP, but should be collected later through PowerShell, workload APIs or third-party APIs | Defender for Office policy depth, Exchange transport rules, Purview advanced configuration |
| **Not Assessed**          | Out of scope, missing permissions, missing licence, or API unavailable                                    | Defender data when the target tenant lacks the required service or consent                 |

This distinction matters because Microsoft’s client credentials flow uses the application’s own identity rather than a signed-in user, and application permissions must be granted to the app by an administrator. Microsoft also states that delegated permissions cannot be used when authenticating as an application because there is no user for the app to act on behalf of. ([Microsoft Learn](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-client-creds-grant-flow "OAuth 2.0 client credentials flow on the Microsoft identity platform - Microsoft identity platform | Microsoft Learn"))

# MVP target

## MVP goal

Deliver a Microsoft 365 tenant health dashboard that provides:

1. Executive tenant overview
    
2. Security posture summary
    
3. Identity and MFA visibility
    
4. Conditional Access visibility
    
5. User, guest and stale account evidence
    
6. Licence allocation and utilisation indicators
    
7. App registration and enterprise app risk indicators
    
8. Intune and device posture summary
    
9. Microsoft 365 usage indicators
    
10. Service health and Message Centre visibility
    
11. Clear “Manual Check Required” labelling where evidence is not API-backed
    

Microsoft Graph usage reports are appropriate for MVP because Microsoft states they can show how people are using Microsoft 365 services, including identifying heavy users, quota pressure and users who might not need a Microsoft 365 licence. Microsoft also notes that user information in Microsoft 365 reports can be concealed, with `adminReportSettings` controlling the display of identifiable data. ([Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/resources/report?view=graph-rest-1.0 "Working with Microsoft 365 usage reports in Microsoft Graph - Microsoft Graph v1.0 | Microsoft Learn"))

---

# Sprint 0: Foundation hardening

## Objective

Stabilise the existing proof of concept so it can support repeatable tenant discovery, evidence labelling and future reporting.

## Capabilities

|Capability|Description|Status|
|---|---|---|
|Repository clean-up|Confirm naming, structure, build process and environment configuration|MVP foundation|
|API route inventory|Document every existing `/m365/*` route and map it to dashboard sections|MVP foundation|
|Permission manifest|Create a single app-registration permissions manifest with required, optional and future permissions|MVP foundation|
|Data source registry|Create a data-source catalogue for every metric, including endpoint, permission, licence dependency and confidence label|MVP foundation|
|Evidence status framework|Add `apiBacked`, `partial`, `manual`, `automationCandidate`, `notAssessed` status fields|MVP foundation|
|Error and permission handling|Replace silent nulls with visible permission, licence or API errors|MVP foundation|
|Manual check framework|Standardise “Manual Check Required” as a first-class result, not a gap or failure|MVP foundation|

## Deliverables

|Deliverable|Detail|
|---|---|
|API coverage matrix|Dashboard section, metric, endpoint, permission, status|
|App registration permissions list|Required permissions and consent notes|
|Manual check schema|Standard object model for non-API checks|
|Data freshness indicator|Cached time, last successful collection, failed collection reason|
|Tenant connection test|Validate Graph token, tenant, organisation and permissions|

## Acceptance criteria

|Criterion|Pass condition|
|---|---|
|App-only authentication works|Tenant data can be retrieved using app registration credentials|
|Every metric has a data source status|No metric appears without evidence classification|
|Permission errors are visible|The dashboard explains missing permissions rather than showing misleading zeroes|
|Manual checks are standardised|All non-API-backed items show “Manual Check Required” consistently|

---

# Sprint 1: MVP executive overview

## Objective

Create the executive landing page that answers: **What is the tenant, how healthy is it, where is the risk, and where should action focus first?**

The existing `/m365/overview` route already retrieves organisation data, users, subscribed SKUs, Secure Score, MFA registration and service health overview data. ([GitHub](https://raw.githubusercontent.com/TimHayward/TenentDiscovery/main/artifacts/api-server/src/routes/m365Overview.ts "raw.githubusercontent.com"))

## Capabilities

|Capability|Source|Status|
|---|---|---|
|Tenant identity|`organization`|API Backed|
|Total users|`users`|API Backed|
|Active, disabled and guest users|`users`|API Backed|
|Total and assigned licences|`subscribedSkus`|API Backed|
|MFA registration percentage|authentication methods registration report|API Backed|
|Secure Score headline|`security/secureScores`|API Backed|
|Service health count|service announcements health overview|API Backed|
|Top risks summary|Derived from security, identity and licence data|API Backed or Partial|
|Manual check count|Derived from checklist framework|API Backed|

## Visualisations

|Visual|Purpose|
|---|---|
|Tenant health summary cards|Show users, licences, Secure Score, MFA, guests and disabled users|
|Risk priority panel|Show top findings by severity|
|Licence allocation gauge|Show assigned versus purchased licences|
|MFA coverage gauge|Show proportion of users registered for MFA|
|Secure Score trend placeholder|Initially single value, then trend in Sprint 3|
|Service health status card|Show affected Microsoft services|
|Manual check count|Show where human validation is still required|

## Detail sections

|Table|Columns|
|---|---|
|Executive findings|Finding, severity, business impact, evidence status, recommended action|
|Tenant summary|Tenant name, tenant ID, user count, guest count, licence count, services|
|Manual check summary|Section, check, why manual, future automation route|

## Acceptance criteria

|Criterion|Pass condition|
|---|---|
|Executive view is understandable without technical drill-down|A non-technical stakeholder can see risk, value and priority|
|Every KPI drills into evidence|No headline card exists without detail|
|Manual checks are visible|Executive users can see where data is incomplete|

---

# Sprint 2: Users, identity and MFA

## Objective

Provide architect-ready identity hygiene evidence.

The existing `/m365/users` route already retrieves users, account status, user type, sign-in activity, licence count, department, job title and MFA registration details. ([GitHub](https://raw.githubusercontent.com/TimHayward/TenentDiscovery/main/artifacts/api-server/src/routes/m365Users.ts "raw.githubusercontent.com"))

## Capabilities

|Capability|Source|Status|
|---|---|---|
|User inventory|Graph users|API Backed|
|Member versus guest users|Graph users|API Backed|
|Enabled versus disabled users|Graph users|API Backed|
|Last sign-in|Graph user `signInActivity`|API Backed|
|Never signed in|Derived from sign-in activity|API Backed|
|MFA registration|Authentication methods registration report|API Backed|
|Passwordless capability|Authentication methods registration report|API Backed|
|SSPR registration|Authentication methods registration report|API Backed|
|Users by department|User profile attributes|API Backed, where populated|
|Joiner, mover, leaver process quality|Requires HR comparison|Manual Check Required|

## Visualisations

|Visual|Purpose|
|---|---|
|Identity hygiene score|Summary of active, stale, guest and disabled users|
|MFA registration gauge|Coverage across users|
|MFA method strength chart|Shows stronger versus weaker methods|
|Stale account trend placeholder|Trend from future scans|
|Guest user risk card|Highlights external identity exposure|

## Detail sections

|Table|Columns|
|---|---|
|User inventory|User, UPN, type, enabled, last sign-in, department, job title, assigned licence count|
|MFA registration|User, registered, methods, passwordless capable, SSPR registered|
|Stale users|User, last sign-in, account state, licence state, recommended action|
|Guest users|Guest, domain, last sign-in, account state, evidence status|

## Manual checks

|Check|Reason|
|---|---|
|HR leaver reconciliation|Requires HR system or manual customer data|
|Service account classification|Requires customer naming convention or owner validation|
|Break glass account confirmation|Can be partly inferred, but intended purpose requires customer validation|

## Acceptance criteria

|Criterion|Pass condition|
|---|---|
|Identity evidence is exportable|Architects can export the user and MFA tables|
|Stale accounts are identifiable|Users can be grouped by last sign-in and account state|
|Manual checks are separated|The report does not infer HR or service account intent without evidence|

---

# Sprint 3: Security posture, Secure Score and Conditional Access

## Objective

Surface security posture and access control maturity using Microsoft Graph evidence.

The existing `/m365/security` route already retrieves Secure Score, Secure Score history, Conditional Access policies, MFA registration details, risk detections and risky users. It also summarises Conditional Access users, apps and grant controls. ([GitHub](https://raw.githubusercontent.com/TimHayward/TenentDiscovery/main/artifacts/api-server/src/routes/m365Security.ts "raw.githubusercontent.com"))

Secure Score is a suitable data source because Microsoft defines the Graph `secureScore` resource as tenant secure score data at tenant and control level, with 90 days held by default. ([Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/resources/securescore?view=graph-rest-1.0 "secureScore resource type - Microsoft Graph v1.0 | Microsoft Learn")) Conditional Access policies are also suitable because Graph represents their conditions, grant controls, session controls and state. ([Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/resources/conditionalaccesspolicy?view=graph-rest-1.0 "conditionalAccessPolicy resource type - Microsoft Graph v1.0 | Microsoft Learn"))

## Capabilities

|Capability|Source|Status|
|---|---|---|
|Secure Score current score|Graph Secure Score|API Backed|
|Secure Score trend|Graph Secure Score history|API Backed|
|Secure Score control list|Graph Secure Score control scores|API Backed|
|Conditional Access policy inventory|Graph Conditional Access policies|API Backed|
|Enabled, disabled and report-only CA policies|Conditional Access policy state|API Backed|
|Grant controls summary|Conditional Access grant controls|API Backed|
|Session controls summary|Conditional Access session controls|API Backed|
|Risk detections|Identity Protection risk detections|API Backed, subject to licensing and permission|
|Risky users|Identity Protection risky users|API Backed, subject to licensing and permission|
|Whether policies are operationally correct|Requires customer intent and testing|Manual Check Required|

## Visualisations

|Visual|Purpose|
|---|---|
|Secure Score trend|Shows improvement or regression|
|Secure Score category chart|Shows strongest and weakest control categories|
|Conditional Access state chart|Enabled, disabled, report-only|
|MFA method strength distribution|Shows weak versus phishing-resistant registration|
|Risk detections timeline|Shows identity risk over time|
|Risky users table|Architect evidence|

## Detail sections

|Table|Columns|
|---|---|
|Secure Score controls|Control, category, score, percentage, implementation status, last synced|
|Conditional Access policies|Name, state, users, apps, grant controls, session controls, modified date|
|Risk detections|Date, risk level, risk detail, timing type|
|Risky users|User, risk level, risk state, last updated|
|Security findings|Finding, source, severity, evidence, action|

## Manual checks

|Check|Reason|
|---|---|
|Break glass account exclusion design|Graph can show exclusions, but not whether the design is approved|
|Conditional Access policy intent|Requires comparison with a documented access model|
|Conditional Access test results|Requires sign-in testing or simulation|
|Named location quality|API can retrieve objects later, but business validity needs review|

## Acceptance criteria

|Criterion|Pass condition|
|---|---|
|Security posture is explainable|Secure Score and control data are visible, not just a headline score|
|CA policies are auditable|Architect can see policy state, users, apps and controls|
|Identity risk is separated from posture|Risk detections and Secure Score are not blended into one opaque score|

---

# Sprint 4: Licences and usage foundation

## Objective

Provide the first usable view of Microsoft 365 value realisation without making premature licence downgrade recommendations.

## Capabilities

|Capability|Source|Status|
|---|---|---|
|Subscribed SKUs|`subscribedSkus`|API Backed|
|Consumed versus available licences|`subscribedSkus`|API Backed|
|User assigned licences|Graph users|API Backed|
|Microsoft 365 active users|Graph reports|API Backed|
|Exchange activity|Graph reports|API Backed|
|OneDrive activity|Graph reports|API Backed|
|SharePoint activity|Graph reports|API Backed|
|Teams activity|Graph reports|API Backed|
|Microsoft 365 Apps activity|Graph reports|API Backed|
|Cost calculation|Requires pricing catalogue|Manual Check Required in MVP|
|Licence right-sizing|Requires rules engine and commercial model|Automation Candidate|

## Visualisations

|Visual|Purpose|
|---|---|
|Licence allocation card|Purchased, assigned, available|
|Workload usage heatmap|Shows usage across Exchange, Teams, SharePoint, OneDrive and Apps|
|Inactive licensed user list|Shows candidates for review|
|Entitlement realisation chart|Shows services licensed versus used|
|Usage by department|Where profile data exists|

## Detail sections

|Table|Columns|
|---|---|
|Licence inventory|SKU, purchased, assigned, available, service plans|
|User licence table|User, SKU, assigned service plans, last activity, status|
|Workload usage table|User, Exchange, Teams, SharePoint, OneDrive, Apps, last active|
|Review candidates|User, licence, inactivity period, confidence, manual review reason|

## Manual checks

|Check|Reason|
|---|---|
|Contract pricing|Requires CSP, EA, NCE or customer pricing source|
|Licence downgrade suitability|Requires persona, role and business context|
|Shared mailbox and leaver policy|Requires business policy and retention context|
|Third-party displacement|Requires ISV inventory and customer validation|

## Acceptance criteria

|Criterion|Pass condition|
|---|---|
|Report avoids overclaiming savings|Licence findings are review candidates, not automatic savings|
|Usage is workload-specific|Teams activity does not imply full Microsoft 365 adoption|
|Inactive users are explainable|Findings include evidence and confidence level|

---

# Sprint 5: Applications, enterprise apps and consent risk

## Objective

Add high-value security evidence around app registrations, enterprise apps, credentials and OAuth consent.

Graph is well suited to this section because the `application` resource represents Entra application registrations, including credentials, owners, required resource access, sign-in audience and publisher details. Microsoft also notes that application owners should be assigned, and the resource includes password and key credential collections. ([Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/resources/application?view=graph-rest-1.0 "application resource type - Microsoft Graph v1.0 | Microsoft Learn"))

The current security estate route already retrieves devices, managed devices, service principals and OAuth permission grants, then builds SaaS app and OAuth app views. ([GitHub](https://raw.githubusercontent.com/TimHayward/TenentDiscovery/main/artifacts/api-server/src/routes/m365Security.ts "raw.githubusercontent.com"))

## Capabilities

|Capability|Source|Status|
|---|---|---|
|App registrations|Graph applications|API Backed|
|Enterprise applications|Graph service principals|API Backed|
|App owners|Application owners relationship|API Backed|
|Password credentials|Application `passwordCredentials`|API Backed|
|Certificate credentials|Application `keyCredentials`|API Backed|
|Expired and expiring credentials|Derived from credential expiry|API Backed|
|Multi-tenant apps|Application `signInAudience`|API Backed|
|Required permissions|`requiredResourceAccess`|API Backed|
|OAuth grants|`oauth2PermissionGrants`|API Backed|
|Consent risk classification|Rules engine|Partial in MVP|
|Whether app is still required|Requires owner/business validation|Manual Check Required|

## Visualisations

|Visual|Purpose|
|---|---|
|App risk summary|Ownerless apps, expired secrets, high privilege grants|
|Credential expiry timeline|Shows upcoming secret and certificate expiry|
|Consent exposure chart|Org-wide versus user consent|
|First-party versus third-party app split|Shows external dependency exposure|

## Detail sections

|Table|Columns|
|---|---|
|App registration inventory|App, app ID, owner, sign-in audience, created date, credential status|
|Credential expiry|App, credential type, display name, expiry, days remaining|
|Enterprise apps|App, publisher, first-party or third-party, created date|
|OAuth grants|App, consent type, scopes, org-wide, risk classification|
|Ownerless apps|App, credential state, permissions, recommended owner action|

## Manual checks

|Check|Reason|
|---|---|
|Business owner confirmation|Ownership field may be missing or technically assigned only|
|App decommission suitability|Requires application dependency validation|
|High privilege permission approval|Requires governance evidence|

## Acceptance criteria

|Criterion|Pass condition|
|---|---|
|App risk is actionable|Expiring credentials and ownerless apps are clearly listed|
|OAuth consent is visible|Org-wide grants are separated from user grants|
|Risk classification is transparent|Rules explain why an app is high, medium or low risk|

---

# Sprint 6: Devices, Intune and endpoint posture

## Objective

Provide an endpoint management and compliance view using Graph.

The Graph `managedDevice` resource is designed for Intune-managed devices and exposes device properties such as device name, OS, compliance state, enrolment and management details. ([Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/resources/intune-devices-manageddevice?view=graph-rest-1.0 "managedDevice resource type - Microsoft Graph v1.0 | Microsoft Learn"))

## Capabilities

|Capability|Source|Status|
|---|---|---|
|Entra device inventory|Graph devices|API Backed|
|Intune managed devices|Graph device management|API Backed|
|Managed versus unmanaged|Derived from device and Intune data|API Backed|
|Compliant versus non-compliant|Intune managed devices|API Backed|
|OS distribution|Device and managed device data|API Backed|
|Last sync or last sign-in|Device and Intune data|API Backed|
|Defender for Endpoint machines|Defender API|API Backed where permission and licence exist|
|Compliance policy detail|Graph device compliance policies|Automation Candidate|
|Security baseline setting compliance|Intune reporting depth|Automation Candidate|
|Device ownership and exception validity|Requires customer review|Manual Check Required|

## Visualisations

|Visual|Purpose|
|---|---|
|Device management coverage|Managed versus unmanaged|
|Compliance status chart|Compliant, non-compliant, unknown|
|OS distribution|Windows, macOS, iOS, Android, Linux|
|Stale device list|Devices not seen recently|
|Defender coverage card|Devices seen by Defender where available|

## Detail sections

|Table|Columns|
|---|---|
|Device inventory|Device, OS, trust type, managed, compliant, last seen|
|Intune managed devices|Device, user, OS, compliance, last sync, management agent|
|Defender devices|Device, platform, last seen, onboarding state where available|
|Non-compliant devices|Device, state, last sync, owner, recommended action|
|Stale devices|Device, last seen, source, risk note|

## Manual checks

|Check|Reason|
|---|---|
|Device ownership accuracy|User and ownership records may not reflect business ownership|
|Endpoint build quality|Requires configuration profile and policy detail|
|Patch compliance|Requires update reporting and baseline definition|
|Unsupported OS exposure|Requires support lifecycle logic|

## Acceptance criteria

|Criterion|Pass condition|
|---|---|
|Managed device coverage is clear|Entra, Intune and Defender sources are separated|
|Non-compliant devices are visible|Architects can export an exception list|
|Missing licence or permission is explicit|Defender or Intune gaps are not hidden|

---

# Sprint 7: Service health, Message Centre and operational readiness

## Objective

Add operational context so the report is not only a point-in-time security snapshot.

Microsoft Graph exposes service communications through the `serviceAnnouncement` resource, including health overviews, issues and service update messages. ([Microsoft Learn](https://learn.microsoft.com/en-us/graph/api/resources/serviceannouncement?view=graph-rest-1.0 "serviceAnnouncement resource type - Microsoft Graph v1.0 | Microsoft Learn"))

## Capabilities

|Capability|Source|Status|
|---|---|---|
|Service health overview|Graph service announcements|API Backed|
|Active incidents|Graph service health issues|API Backed|
|Service advisories|Graph service health issues|API Backed|
|Message Centre posts|Graph service update messages|API Backed|
|Admin action required|Message Centre metadata|API Backed|
|Business impact classification|Rules engine|Partial|
|CAB process maturity|Customer process|Manual Check Required|

## Visualisations

|Visual|Purpose|
|---|---|
|Current service health board|Shows Microsoft service status|
|Active advisory list|Shows current risk and degradation|
|Message Centre action timeline|Shows upcoming changes|
|Operational readiness card|Shows untriaged changes and advisories|

## Detail sections

|Table|Columns|
|---|---|
|Service health|Service, status, issue count, last update|
|Incidents and advisories|ID, title, service, status, impact, start time, last update|
|Message Centre|Title, category, severity, action required, effective date|
|Operational findings|Finding, service, action, owner, target date|

## Manual checks

|Check|Reason|
|---|---|
|Whether Message Centre is operationally managed|Requires customer process validation|
|Whether advisories are assessed by IT|Requires workflow or ITSM integration|
|Business impact of Microsoft changes|Requires customer-specific service mapping|

## Acceptance criteria

|Criterion|Pass condition|
|---|---|
|Service health is visible|Current status and active issues are shown|
|Message Centre items are actionable|Admin action items are separated from informational posts|
|Operational gaps are not inferred|Customer process items are manual unless integrated|

---

# Sprint 8: MVP reporting, exports and evidence pack

## Objective

Turn the dashboard into a usable client-facing report and architect evidence pack.

## Capabilities

|Capability|Description|Status|
|---|---|---|
|Executive PDF or HTML report|Concise management view|MVP|
|Architect evidence export|CSV or Excel export of key tables|MVP|
|Findings register|Consolidated findings across sections|MVP|
|Manual check register|All manual checks in one place|MVP|
|Permission report|Shows missing, granted and optional permissions|MVP|
|Collection log|Shows what was collected and when|MVP|
|Evidence source references|Metric, source endpoint, confidence, timestamp|MVP|

## Visualisations

|Visual|Purpose|
|---|---|
|Executive summary page|Decision-maker overview|
|Findings by severity|Prioritisation|
|Findings by domain|Planning|
|API-backed versus manual evidence|Transparency|
|Remediation effort matrix|Initial planning|
|Export coverage status|Shows what can be taken into remediation|

## Detail sections

|Table|Columns|
|---|---|
|Findings register|ID, domain, severity, finding, evidence, source, status, recommendation|
|Manual check register|Section, check, why manual, evidence required, future automation route|
|Collection log|Endpoint, status, permission, last run, record count, error|
|Permission matrix|Permission, purpose, required or optional, admin consent, section dependent|
|Export manifest|File, included sections, generated date|

## Acceptance criteria

|Criterion|Pass condition|
|---|---|
|Report can be given to a client|Executive and technical views are separate|
|Evidence is exportable|Architects can use the output to plan remediation|
|Manual checks are not hidden|Incomplete API coverage is explicit|
|Product is demo-ready|A tenant scan can be presented end to end|

---

# MVP backlog by current repository section

|Current section|MVP treatment|Notes|
|---|---|---|
|Overview|Keep and harden|Already aligned to API-backed tenant summary|
|Users & Identity|Keep and expand|Add stale users, guest users, MFA method strength and sign-in evidence|
|Licences|Keep and expand|Focus on allocation and usage, not deep recommendations yet|
|Security|Keep and expand|Secure Score, Conditional Access, MFA, risky users, risk detections|
|Exchange Online|Keep but label many checks manual|Graph can cover activity, but many deep Exchange security settings need later automation|
|Teams & SharePoint|Keep as partial|Usage, groups, sites and some sharing indicators can be API-backed, but governance intent needs manual checks|
|Compliance & Health|Refactor|DLP and labels may be API-backed, but the current retention proxy should be removed or marked manual|
|Intune|Keep and expand|Device and compliance summary are valid MVP targets|
|Enterprise Apps|Promote to first-class section|App registrations, service principals, OAuth grants and credentials are high-value findings|

The Compliance route currently retrieves Secure Score, eDiscovery, DLP policies and sensitivity labels, but it also uses Intune app protection policies as a proxy count for retention policies. That proxy should not remain in an executive or architect report because it risks presenting unrelated data as retention evidence. It should be reclassified as **Manual Check Required** or replaced with a proper Purview collection path in a later sprint. ([GitHub](https://raw.githubusercontent.com/TimHayward/TenentDiscovery/main/artifacts/api-server/src/routes/m365Compliance.ts "raw.githubusercontent.com"))

# Manual Check Required items for MVP

These should appear in the product from the first release.

|Section|Manual check|Why manual in MVP|
|---|---|---|
|Exchange Online|Transport rules reviewed|Workload-specific PowerShell or deeper Exchange API automation required|
|Exchange Online|External forwarding policy reviewed|Can be partly inferred, but configuration and exception intent need deeper collection|
|Exchange Online|Defender for Office policies reviewed|Requires Defender for Office policy retrieval beyond MVP Graph coverage|
|Teams|Teams lifecycle process confirmed|API can show Teams, not governance process quality|
|SharePoint|External sharing exceptions approved|API can show sharing exposure, not business approval|
|Purview|Retention policy design reviewed|Requires Purview-specific collection and policy interpretation|
|Purview|DLP policy effectiveness reviewed|API may show policies, but effectiveness requires matches, mode, scope and business process|
|Identity|Break glass accounts validated|API can show accounts and exclusions, but intent must be confirmed|
|Identity|Service accounts validated|Requires customer naming, owner and dependency evidence|
|Licensing|Licence savings confirmed|Usage data alone is not a commercial decision|
|Endpoint|Device ownership validated|Device records do not always reflect business ownership|
|Operations|Message Centre process confirmed|Requires operational governance review|

# Post-MVP automation sprints

## Sprint 9: Exchange Online automation

|Capability|Collection route|Status|
|---|---|---|
|Mailbox forwarding|Exchange Online PowerShell or Graph where available|Automation Candidate|
|Inbox rule forwarding|Exchange Online PowerShell|Automation Candidate|
|SMTP AUTH status|Exchange Online PowerShell|Automation Candidate|
|Transport rules|Exchange Online PowerShell|Automation Candidate|
|Accepted domains|Exchange Online PowerShell|Automation Candidate|
|Connectors|Exchange Online PowerShell|Automation Candidate|
|Mailbox archive and litigation hold|Exchange Online PowerShell|Automation Candidate|
|Defender for Office policy posture|Security and Compliance PowerShell or Defender APIs|Automation Candidate|

## Sprint 10: SharePoint and Teams governance automation

|Capability|Collection route|Status|
|---|---|---|
|Site sharing settings|Graph and SharePoint APIs|Automation Candidate|
|Anonymous links|SharePoint APIs and reporting|Automation Candidate|
|Site owners|Graph and SharePoint APIs|Automation Candidate|
|Teams owners and members|Graph Teams and Groups APIs|Automation Candidate|
|Inactive Teams|Graph usage reports and groups|Automation Candidate|
|Guest access by team|Graph Teams and Groups APIs|Automation Candidate|
|Sensitivity labels on sites and groups|Graph and Purview integration|Automation Candidate|

## Sprint 11: Purview and data protection automation

|Capability|Collection route|Status|
|---|---|---|
|Sensitivity labels|Graph information protection APIs|API Backed or beta dependent|
|Label policies|Purview APIs or PowerShell|Automation Candidate|
|DLP policies|Graph security information protection or Purview PowerShell|Automation Candidate|
|DLP mode and scope|Purview APIs or PowerShell|Automation Candidate|
|Retention policies|Purview PowerShell or compliance APIs|Automation Candidate|
|Audit configuration|Purview audit and compliance APIs|Automation Candidate|
|eDiscovery presence|Graph security cases|Partial|

## Sprint 12: Defender XDR and security operations automation

|Capability|Collection route|Status|
|---|---|---|
|Incidents|Microsoft Graph Security API or Defender XDR APIs|Automation Candidate|
|Alerts|Microsoft Graph Security API or Defender XDR APIs|Automation Candidate|
|Defender for Endpoint devices|Defender API|Partially present|
|Vulnerability exposure|Defender Vulnerability Management API|Future|
|Secure Score recommendations|Graph Secure Score|Already in MVP|
|Security operations metrics|Defender XDR APIs|Future|

# Baseline alignment sprints

## Sprint 13: Baseline engine

## Objective

Move from “show me the data” to “measure this tenant against a defined standard”.

## Capabilities

|Capability|Description|
|---|---|
|Baseline object model|Control ID, title, description, severity, evidence query, pass logic|
|Baseline versioning|Store baseline name, version and date|
|Evidence mapping|Link each control to source data|
|Applicability logic|Not every control applies to every tenant|
|Exception model|Accept risk, compensate, not applicable|
|Control scoring|Pass, fail, partial, manual, not assessed|
|Export|Baseline control pack for client evidence|

## Initial baselines

|Baseline|Use|
|---|---|
|Microsoft recommended baseline|Default product baseline|
|CIS Microsoft 365 Benchmark|Secure configuration benchmark|
|NCSC Cyber Essentials|UK cyber hygiene alignment|
|NCSC CAF|Public sector and regulated resilience framing|
|Custom MSP baseline|Your own delivery standard|
|Customer baseline|Client-specific policy model|

## Sprint 14: Identity and access baseline pack

|Control family|Examples|
|---|---|
|MFA and strong authentication|All users protected, admins protected, weak methods reviewed|
|Conditional Access|MFA, device compliance, location, session controls, exclusions|
|Privileged access|Global admins, PIM, permanent roles, dormant admins|
|Guest governance|Stale guests, guest access review, external domains|
|App consent|Ownerless apps, high privilege grants, org-wide consent|

## Sprint 15: Collaboration and data baseline pack

|Control family|Examples|
|---|---|
|SharePoint external sharing|Anonymous links, guest access, site sensitivity|
|Teams governance|Owners, guests, inactive teams, shared channels|
|Purview|Labels, DLP, retention, audit|
|Exchange security|Forwarding, SMTP AUTH, anti-phishing, DKIM, DMARC|
|Copilot readiness|Oversharing, labels, guest exposure, sensitive content risk|

# Licence intelligence sprints

## Sprint 16: Licence normalisation and pricing model

|Capability|Description|
|---|---|
|SKU catalogue|Normalise Microsoft SKU names and service plans|
|Service plan mapping|Map capabilities to products|
|Pricing source model|Manual price input first, CSP integration later|
|Licence hierarchy|Business Basic, Standard, Premium, E3, E5, add-ons|
|Persona model|Executive, frontline, knowledge worker, admin, shared, leaver|
|Confidence score|High, medium, low recommendation confidence|

## Sprint 17: Licence optimisation recommendations

|Recommendation type|Example|
|---|---|
|Remove|Disabled licensed users with no hold or exception|
|Review|Users inactive for 90 or 180 days|
|Consolidate|Multiple add-ons replaced by higher suite|
|Uplift|Business Standard to Business Premium for security requirement|
|Rationalise|E5 assigned but E5 services unused|
|Protect|Users with risk exposure needing stronger licensing|
|Prepare|Copilot readiness gaps requiring governance before licence allocation|

## Sprint 18: ISV displacement and value realisation

|Capability|Description|
|---|---|
|Microsoft capability mapping|Map Microsoft 365 E5, Defender, Purview, Teams Premium, Intune Suite to capability areas|
|Third-party inventory|Manual initially, then app discovery and SaaS integrations|
|Displacement candidates|Backup, email security, DLP, CASB, endpoint, password manager, meeting tools|
|Risk caveat|Avoid automatic “replace” recommendations|
|Commercial summary|Potential consolidation, uplift and renewal planning|

# Suggested release packaging

## MVP release: Tenant Visibility

|Included|Deferred|
|---|---|
|Tenant overview|Deep Exchange configuration|
|Users and guests|Deep Defender for Office policy review|
|MFA registration|Full Purview retention analysis|
|Conditional Access inventory|Full CIS/NCSC scoring|
|Secure Score|Deep licence recommendations|
|Licence allocation|ISV displacement|
|Usage reports|PowerShell collectors|
|App registrations and OAuth grants|Third-party APIs|
|Device and Intune summary|ITSM integration|
|Service health and Message Centre|Remediation automation|

## Release 1: Evidence and Reporting

|Included|
|---|
|Findings register|
|Manual check register|
|Exportable architect evidence|
|Executive report|
|Collection and permission log|
|Evidence confidence model|

## Release 2: Automation Expansion

|Included|
|---|
|Exchange Online collector|
|SharePoint and Teams collector|
|Purview collector|
|Defender XDR collector|
|Optional PowerShell execution model|
|Scheduled collection|

## Release 3: Baseline Alignment

|Included|
|---|
|Baseline rules engine|
|Microsoft recommended baseline|
|CIS mapping|
|NCSC and Cyber Essentials mapping|
|Custom baseline support|
|Exception management|

## Release 4: Commercial Intelligence

|Included|
|---|
|Licence right-sizing|
|Uplift recommendations|
|Consolidation recommendations|
|Third-party displacement candidates|
|Renewal and value realisation report|
|MSP proposal pack|

# Immediate development priorities

I would prioritise the next engineering work as follows:

|Priority|Work item|Reason|
|---|---|---|
|1|Create the data source and evidence status registry|Prevents ambiguous reporting|
|2|Refactor manual checks into a shared object model|Makes unsupported checks intentional|
|3|Harden permissions and error handling|Essential for client tenant onboarding|
|4|Fix or remove proxy metrics|Especially the retention proxy in Compliance|
|5|Build the findings register|Turns the dashboard into a remediation tool|
|6|Promote app registrations and OAuth grants|High-value security area|
|7|Add export capability|Required for architects and MSP proposal development|
|8|Add historical scan storage|Needed for drift, trend and managed service value|

# Recommended MVP definition

The MVP should be described as:

**A Microsoft 365 tenant visibility report that uses app-registration based Microsoft API access to provide an executive overview and technical evidence pack covering identity, security posture, licensing, usage, applications, devices and service health. Where tenant evidence cannot yet be retrieved reliably through the supported API model, the report marks the item as Manual Check Required and records the future automation route.**