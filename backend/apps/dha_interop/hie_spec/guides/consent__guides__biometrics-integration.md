# Biometrics Integration Guide
Biometrics is the primary way a facility verifies a patient's identity and captures consent before
starting a visit, creating a preauthorization, or discharging a patient. This guide walks a new integrator
through the entire journey: installing and setting up HealthID (the desktop application that talks
to your fingerprint scanner), obtaining staging credentials, confirming the device works, and then driving
the authorization flow through to a matched, usable authorization - including how to recover when the
capture iframe expires.
For the endpoint-by-endpoint reference of the consent step, see the
Biometrics Consent process doc. This guide is the end-to-end
walkthrough.
## The full flow at a glance
## Step 1 - Set up HealthID
HealthID is the application installed on the workstation that the biometric scanner is plugged into. It
detects the scanner and exposes a local status endpoint your integration reads before creating an
authorization.
### 1.1 Download and install
- Download the HealthID Windows installer (UAT)
- Download the HealthID Android app (UAT)
Install it on the machine (or device) where the biometric scanner will be connected. On Windows it runs a
background service that keeps running even when the application window is closed.
### 1.2 Request staging credentials
HealthID staging accounts are created by the HIE team. Request one by sharing the email address the
account should use. A setup email with a temporary password is then sent to that address.
### Account setup email
The account is created against the email you share, and an activation email with a temporary password is
sent to it. Use the temporary password for your first login, then set a permanent password.
### 1.3 Log in and detect the scanner
- Open HealthID and log in with your credentials.
- Plug the biometric scanner into the workstation via USB. HealthID should detect the scanner
automatically.
- Click the Test button in HealthID and attempt a test capture to confirm the scanner can read
fingerprints before you go live.
## Step 2 - Confirm the local status endpoint
Once the test capture works, confirm your integration can read the device details from HealthID's local
status endpoint:
Code 
GET http://localhost:18065/status
This returns the connected device(s) and your workstationID. Both are used in your API requests -
in particular, workstationID is required when creating a biometrics authorization.
### If /status is unreachable or the device is missing
Ensure HealthID is running (restart its service if needed), confirm the scanner is plugged in, and
re-run the test capture. The device must appear in the status response before you create an
authorization.
## Step 3 - Create and complete an authorization
Create the authorization using the workstationID (and the other required consent fields). The
authorization is created in PENDING status and the response includes an iframe link.
Render the iframe in your UI. It detects the connected scanner and shows a Start button.
Click Start. The scanner wakes and the patient places their finger. The iframe captures the print
and matches it against the patient's SHA-registered prints, then shows success.
Get the authorization to fetch the record and confirm the status has moved on:
- AUTHORIZED - a standard visit; ready to use.
- AUTHORIZED_PENDING_VISIT - an elective case; the authorization is matched and waits for the visit to
be created after the preauth is approved.
If the status has moved to one of these, the capture succeeded. Use
Get Authorizations to check.
## Step 4 - When the iframe expires
The capture iframe is time-limited. If the timer expires before a capture is made, the authorization
does not complete and remains stuck in PENDING. A stuck PENDING authorization blocks you from creating
a new one for the same context, so you must clear it first.
### Reject the stuck authorization, then retry
Transition the stuck PENDING authorization to rejected using
Reject Authorization, then create a fresh authorization and
retry the capture. Do not leave it in PENDING.
## Related resources
- Biometrics Consent - endpoint reference for the consent step.
- Get Authorizations - check an authorization's status.
- Reject Authorization - clear a stuck PENDING authorization.
- Start Visit Workflow - using the authorization to start a visit.
- Elective Preauth - the AUTHORIZED_PENDING_VISIT path.
- OTP Whitelist Request - the OTP fallback when biometrics cannot be used.
- Consent Services API Reference
Last modified on September 28, 2026
