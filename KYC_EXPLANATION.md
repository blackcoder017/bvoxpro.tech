# KYC (Know Your Customer) Authentication Flow

## Overview
The KYC system has two stages for identity verification:

### Stage 1: KYC1 (`http://localhost:3000/kyc1.html`)
**Purpose:** Collect basic identity information and ID document scans

**User Input:**
- Full Name
- Certificate Type (ID Card / Driver's License / NCO Certificate)
- Certificate Number
- Image uploads:
  - ID Front Photo
  - ID Back Photo

**Data Collection:**
```javascript
{
  userid: "user123",
  username: "0x...",
  name: "John Doe",
  type: 1,  // 1=ID Card, 2=Driver's License, 3=NCO Certificate
  idnum: "123456789",
  zpqian: "/uploads/image.jpg",  // ID front photo URL
  zphou: "/uploads/image2.jpg"   // ID back photo URL
}
```

**Submission Endpoint:** `POST /User/setuserrz1`

**Process:**
1. User fills form and uploads photos
2. Photos are sent to `/api/Wallet/upload_image` (multipart/form-data)
3. Server returns file path
4. Form data + file paths sent to `/User/setuserrz1`
5. Server stores KYC1 data in `kyc_records.json`
6. User awaits manual admin approval

---

### Stage 2: KYC2 (`http://localhost:3000/kyc2.html`)
**Purpose:** Collect additional personal and financial information

**User Input:**
- Residential Address
- Phone Number
- Occupation
- Annual Income Range
- Source of Funds
- Address Proof Photo (Utility Bill/Lease Agreement)

**Data Collection:**
```javascript
{
  userid: "user123",
  username: "0x...",
  zphou: "/uploads/utility_bill.jpg"  // Proof of address
}
```

**Submission Endpoint:** `POST /User/setuserrz2`

**Process:**
1. User fills form and uploads address proof
2. Photo sent to `/api/Wallet/upload_image`
3. Form data + file path sent to `/User/setuserrz2`
4. Server stores KYC2 data in `kyc_records.json`
5. User awaits manual admin approval

---

## Backend Flow

### Image Upload Process
```
User selects image
    ↓
POST /api/Wallet/upload_image (multipart/form-data)
    ↓
Server parses multipart payload
    ↓
Extracts file bytes and saves to /uploads/
    ↓
Returns { code: 1, data: "/uploads/filename.jpg" }
    ↓
Frontend stores URL in form data
    ↓
Submits to KYC endpoint with all form data + image URL
```

### KYC1 Submission
```
User completes form + uploads 2 photos
    ↓
POST /User/setuserrz1 with:
  - userid, username, name, type, idnum
  - zpqian (front photo URL), zphou (back photo URL)
    ↓
Server stores record in kyc_records.json:
  {
    id: UUID,
    userid: "123",
    stage: 1,
    data: { name, type, idnum, zpqian, zphou },
    status: "pending",
    submitted_at: timestamp
  }
    ↓
Returns { code: 1 }
```

### KYC2 Submission
```
User completes form + uploads address proof
    ↓
POST /User/setuserrz2 with:
  - userid, username, zphou (address proof URL)
    ↓
Server stores record in kyc_records.json:
  {
    id: UUID,
    userid: "123",
    stage: 2,
    data: { zphou },
    status: "pending",
    submitted_at: timestamp
  }
    ↓
Returns { code: 1 }
```

---

## Admin Management

### Admin KYC Dashboard (Future)
- View pending KYC1 applications with photos
- View pending KYC2 applications
- Approve/Reject with notes
- Update user verification status

### KYC Status Levels
- Level 0: No KYC
- Level 1: KYC1 Approved (basic verification)
- Level 2: KYC1 + KYC2 Approved (full verification)

---

## Data Storage

### kyc_records.json
```json
[
  {
    "id": "uuid-1",
    "userid": "37282",
    "username": "0x0fe540d4A96E378C9Fe68C5FaA8Fcf75803f03d6",
    "stage": 1,
    "status": "pending",  // pending, approved, rejected
    "data": {
      "name": "John Doe",
      "type": 1,
      "idnum": "123456789",
      "zpqian": "/uploads/proof_1234567890.jpg",
      "zphou": "/uploads/proof_1234567891.jpg"
    },
    "submitted_at": "2025-12-03T10:30:00.000Z",
    "reviewed_at": null,
    "reviewed_by": null
  }
]
```

---

## Current Status
- ✅ KYC1 Frontend: Complete (form, photo uploads, submission)
- ✅ KYC2 Frontend: Complete (form, photo upload, submission)
- ❌ Backend Endpoints: Missing (`/User/setuserrz1`, `/User/setuserrz2`)
- ❌ Admin Dashboard: Not created
- ❌ KYC Records Storage: Not implemented
- ❌ Verification Status Update: Not implemented

---

## Next Steps
1. Add `/User/setuserrz1` endpoint to `server.js`
2. Add `/User/setuserrz2` endpoint to `server.js`
3. Create `kyc_records.json` storage
4. Create admin KYC management page
5. Add verification status field to users.json
