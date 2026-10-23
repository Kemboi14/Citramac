# Biometrics Consent Process Guide
## 1. Overview: Biometrics as the Primary Consent Method
Biometrics is the primary method for verifying patient identity and obtaining consent before starting a visit, creating a preauth, or discharging a patient. Most facilities are required to use biometrics - the patient's fingerprint is captured and matched against their SHA-registered prints to provide consent.
OTP is a fallback method for patients who cannot use biometrics. To use OTP, a patient must first be whitelisted through a formal request process reviewed by SHA. See:
- OTP Whitelist Request - how to request OTP access for a patient
- Get OTP Whitelist Request - how to check whitelist status
One exception needs no request: when eCitizen has no usable fingerprints for an adult patient, the HIE rejects the biometrics authorization and allows the patient OTP straight away, for a short time. See OTP Fallback When No Usable Fingerprints Are Found.
The biometrics mechanism has two components that work together:
- Hardware Server - A Windows application installed on the workstation that communicates directly with the biometric device and exposes a local API at http://localhost:18065.
- Biometrics Authorization API - The POST /api/v1/claims/authorize endpoint creates an authorization and returns an iframe link for the capture and matching process.
## 2. Hardware Server Setup
The Hardware Server must be installed and running on the workstation where the biometric device is connected before any biometrics capture can take place.
### 2.1. What the Hardware Server Does
The Hardware Server is a local Windows service that bridges web-based systems like SHA with biometric hardware - fingerprint scanners and NFC card readers - over HTTP and WebSocket. It:
- Discovers connected fingerprint scanners (Digital Persona, SecuGen, BioMini, ZKTeco) and NFC readers (ACS ACR1251/1252)
- Exposes them through a REST API
- Pushes real-time device and reader events over WebSocket (/ws/devices)
- Handles authentication, encryption of biometric data, and syncs devices and credentials with the remote identity backend
### 2.2. Installation
- Download the Hardware Server .exe installer.
- Install it on the Windows workstation that has the biometric device connected.
- Launch the application - it starts a background service on localhost:18065 that continues running even if the application window is closed.
- Login using your biometrics agent credentials.
### Biometrics Agent Account
A biometrics agent is a designated user created by the HIE team for the facility. During setup, the HIE team captures the agent's National ID number. This National ID is a required field when calling POST /api/v1/claims/authorize with biometrics fields.
### 2.3. Verify the Service is Running
Call the Hardware Server status endpoint:
Code 
GET http://localhost:18065/status
Example response:
Code 
{
  "workstationID": "WS-12345",
  "devices": [
    {
      "deviceId": "DEV-001",
      "status": "connected",
      "type": "fingerprint"
    }
  ]
}
Key fields:
- workstationID - Required field in POST /api/v1/claims/authorize
- devices - List of detected biometric devices; if empty or all disconnected, check the USB connection
### 2.4. Connecting the Device
- Plug the biometric fingerprint device into the workstation via USB.
- Recheck /status - the device should now appear in the devices array with a connected status.
- Run a test capture from the Hardware Server application interface to confirm the device can read fingerprints before going live.
### 2.5. Hardware Server Troubleshooting
 | Problem | Resolution
 | localhost:18065/status is unreachable | The background service is not running. Open the Hardware Server application and click "Restart Service", then retry /status.
 | Device not in devices list | Check USB connection. Plug in device while app is running and retry /status.
 | Test capture fails | Verify device is correctly connected; restart service and retry.
## 3. Biometrics Authorization Flow
Once the Hardware Server is set up and running, follow this flow to obtain biometrics consent.
### 3.1. Step 1 - Create an Authorization
Call POST /api/v1/claims/authorize with biometrics-specific fields:
- workstationID (from GET http://localhost:18065/status)
- Biometrics agent National ID
- Patient beneficiary CR ID
- Relevant claim and service identifiers
The system creates an authorization in PENDING status and returns an iframe link in the response.
### 3.2. Step 2 - Render the iframe
Embed the iframe URL in your application's UI. The iframe:
- Detects whether a biometric device is connected (via Hardware Server)
- Shows the patient's available registered fingerprints
- Displays a "Start" button to begin the capture process
- Expires in 10 minutes - the fingerprint capture must complete within this window
### iframe Expiry
If the iframe expires before matching completes, the authorization remains stuck in PENDING. Reject it using the Reject Authorization endpoint (POST /api/v1/claims/authorizations/{consent_token}/reject) and create a new one.
### 3.3. Step 3 - Fingerprint Capture and Matching
- The operator or patient clicks the Start button on the iframe.
- The biometric device lights up and is ready to capture.
- The patient places their finger on the device.
- The iframe captures the print and attempts to match it against the patient's registered prints.
- The iframe displays real-time feedback on the capture and matching result.
On success: Authorization transitions from PENDING to AUTHORIZED (standard visit) or AUTHORIZED_PENDING_VISIT (elective preauth pre-visit).
On failure: The iframe shows the rejection and prompts a retry. Up to 3 retry attempts are allowed. If all 3 fail, the authorization transitions to REJECTED status. At this point you must create a new authorization and begin again from Step 1.
### No usable fingerprints: switch to OTP
If eCitizen has no usable fingerprints for an adult patient, retrying cannot succeed. The authorization moves to REJECTED with authorizationReason set to BIOMETRICS_NOT_FOUND_OTP_ALLOWED, and the patient may consent by OTP instead. See OTP Fallback When No Usable Fingerprints Are Found.
### 3.4. Step 4 - Use the Authorization
Once the authorization is in AUTHORIZED or AUTHORIZED_PENDING_VISIT status, it can be used:
 | Use case | Field to include
 | Create a standard visit (POST /api/v1/claims/visit) | auth_guid (the GUID from the authorization object) instead of otp
 | Create an elective preauth (POST /api/v1/preauths) | token from the authorization object as consent_token
 | Discharge a patient | auth_guid instead of otp in the discharge endpoint
### 3.5. Supporting Authorization Workflows
Two supporting workflows help you manage an authorization through the biometrics flow:
- Get Authorizations - check an authorization's current status (PENDING, AUTHORIZED, AUTHORIZED_PENDING_VISIT, REJECTED), for example to confirm a capture moved the authorization to AUTHORIZED or AUTHORIZED_PENDING_VISIT. See Get Authorizations.
- Reject Authorization - clear a stuck PENDING authorization so you can create a new one and retry matching (for example when the iframe expires before a capture). See Reject Authorization.
For the full end-to-end walkthrough, see the Biometrics Integration Guide.
## 4. Authorization Status Reference
 | Status | Meaning
 | PENDING | Authorization created; waiting for successful fingerprint match
 | AUTHORIZED | Fingerprint matched; ready for standard visit or discharge
 | AUTHORIZED_PENDING_VISIT | Fingerprint matched (elective); waiting for visit creation after preauth approval
 | REJECTED | All 3 retry attempts failed; create a new authorization to try again. If authorizationReason is BIOMETRICS_NOT_FOUND_OTP_ALLOWED, do not retry biometrics - use OTP (OTP Fallback)
## 5. Troubleshooting Authorization Issues
### iframe Expired Before Matching
The iframe is only valid for 10 minutes. If it expires:
- Reject the stuck PENDING authorization using the Reject Authorization endpoint (POST /api/v1/claims/authorizations/{consent_token}/reject). This transitions it out of PENDING so it no longer blocks creating a new one.
- Create a new authorization via POST /api/v1/claims/authorize.
- Render the new iframe and retry the matching process.
### Authorization Stuck at PENDING
If the authorization remains in PENDING after a seemingly successful match:
- Check the current authorization status with Get Authorizations.
- If still PENDING, reject it using the Reject Authorization endpoint.
- Create a new authorization and retry.
- If issues persist, verify Hardware Server is running (GET http://localhost:18065/status) and restart the service if needed.
### All 3 Retries Failed (REJECTED status)
After 3 failed fingerprint matching attempts, the authorization transitions to REJECTED and is no longer usable. Create a new authorization and retry from Step 1.
If fingerprint matching repeatedly fails for a patient, consider submitting an OTP Whitelist Request for the patient. See OTP Whitelist Request.
### REJECTED with BIOMETRICS_NOT_FOUND_OTP_ALLOWED
eCitizen has no usable fingerprints for this patient, so biometrics cannot succeed. The patient has been allowed OTP for a short time. Send an OTP and start the visit on the OTP path. See OTP Fallback When No Usable Fingerprints Are Found.
### Device Not Detected by iframe
- Verify Hardware Server is running (check GET http://localhost:18065/status).
- Confirm the device appears in the devices list with connected status.
- Run a test capture from the Hardware Server application.
- Restart the service if needed.
## 6. Related Resources
- Biometrics Integration Guide
- Get Authorizations
- OTP Fallback When No Usable Fingerprints Are Found
- Reject Authorization
- OTP Whitelist Request
- Get OTP Whitelist Request
- Biometrics Scenarios - Scenario 1: SHIF IP Per Diem
- Biometrics Scenarios - Scenario 2: SHIF IP FFS Normal Preauth
- Biometrics Scenarios - Scenario 3: SHIF IP FFS Elective Preauth
- Biometrics Scenarios - Scenario 4: SHIF OP FFS Elective Preauth
- Start Visit Workflow Guide
- Elective Preauth Guide
- Consent Services API Reference
Last modified on September 28, 2026
