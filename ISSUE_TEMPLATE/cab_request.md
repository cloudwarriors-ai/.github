---
name: '🚀 CAB Change Request'
title: 'CAB Request: Release [VERSION] - [YYYY-MM-DD]'
labels: 'cab-review, release'
assignees: '' # Add the Tech Lead or Release Manager here

---

<!-- 
Please fill out this template completely to ensure a smooth and fast review process. 
Provide as much detail as possible for each section.
-->

## 1. Release Overview

### 🎯 Business Justification
<!-- 
What is the primary goal of this release? 
What business value does it deliver, or what problem does it solve? 
(e.g., "Launch the new user dashboard to improve customer engagement," "Patch critical security vulnerability CVE-2025-12345.")
-->

### 🗓️ Proposed Deployment Window
**Target Date:** `YYYY-MM-DD`
**Target Time:** `HH:MM` (Please specify timezone, e.g., UTC, EST)
**Expected Duration:** `(e.g., 30 minutes)`
**Expected User Impact / Downtime:** `(e.g., No downtime, 5 minutes of service degradation, full outage)`

### 📝 High-Level Summary of Changes
<!-- 
Provide a non-technical summary of the features, fixes, or changes included in this release. 
This should be understandable by business stakeholders.
-->

---

## 2. Technical Details

### 🔗 Included Pull Requests
<!-- 
List all merged Pull Requests that are part of this release.
This provides a direct audit trail to the code changes.
-->
- #123: Brief description of PR
- #125: Brief description of PR

### ⚙️ System & Service Impact
<!-- 
What applications, services, or infrastructure components are affected by this change? 
(e.g., API server, web frontend, user database, payment gateway)
-->

### 📦 Deployment Dependencies
<!-- 
Are there any prerequisites for this deployment? 
(e.g., "Requires database migration script to be run first," "Depends on successful deployment of the Auth service v2.1")
-->

---

## 3. Quality & Risk Management

### ✅ Testing & Validation Evidence
<!-- 
How do we know this release is ready? 
Summarize the testing that has been completed.
-->
- [ ] **Unit & Integration Tests:** All automated tests are passing in the CI/CD pipeline.
- [ ] **QA Verification:** All features have been manually tested and approved by the QA team in the `staging` environment.
- [ ] **User Acceptance Testing (UAT):** (If applicable) UAT has been completed and signed off by stakeholders.

### ⚠️ Risk Assessment
<!-- 
What could go wrong, what is the likelihood, and what is the impact?
-->
- **Identified Risks:** (e.g., "High load on the database after release," "Third-party API may be unresponsive.")
- **Likelihood:** `(Low / Medium / High)`
- **Impact:** `(Low / Medium / High)`
- **Mitigation Plan:** (e.g., "We will monitor database CPU closely. We have implemented retries with exponential backoff for the third-party API.")

### ⏪ Rollback Plan
<!-- 
Provide a step-by-step plan to revert the changes if the deployment fails. 
Be specific.
-->
1.  **Decision Point:** The deployment will be considered failed if `(e.g., critical error rate exceeds 5% for 10 minutes)`.
2.  **Rollback Trigger:** The on-call engineer will initiate the rollback by `(e.g., redeploying the previous stable version via the CI/CD pipeline)`.
3.  **Estimated Rollback Time:** `(e.g., 15 minutes)`
4.  **Communication:** The engineering lead will notify stakeholders in the `#releases` Slack channel.

---

## 4. Post-Deployment Plan

### 📈 Monitoring & Verification
<!-- 
How will we confirm the deployment was successful? 
-->
- **Key Metrics to Watch:** (e.g., "API latency, HTTP 5xx error rate, user signup conversion rate.")
- **Verification Steps:** (e.g., "The on-call engineer will perform a smoke test by logging in as a test user and verifying the new dashboard loads correctly.")

### 👨‍👩‍👧 Key Personnel
- **Deployment Lead:** `@github-username`
- **On-Call Engineer:** `@github-username`
- **QA Sign-off:** `@github-username`

---

## APPROVAL (To be filled out by CAB)

- [ ] **Approved**
- [ ] **Rejected**

**Reviewer:**
**Date:**
**Comments:**