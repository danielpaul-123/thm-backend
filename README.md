# THM Registration Backend API

Backend API for THM25 registration system with MongoDB, ImgBB integration, Google Sheets sync, and comprehensive validation.

## Features

- ✅ Complete registration API endpoint
- ✅ UUID and short ticket ID generation (THM-XXXXXXXX format)
- ✅ ImgBB integration for transaction screenshot uploads
- ✅ **Google Sheets automatic sync (background task)**
- ✅ MongoDB with unique email/ticket validation
- ✅ Comprehensive input validation
- ✅ Rate limiting (5 requests per 15 minutes)
- ✅ CORS enabled
- ✅ Error handling and logging
- ✅ Duplicate email prevention

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (local or Atlas)
- ImgBB API key ([Get one here](https://api.imgbb.com/))
- Google Cloud Service Account (optional, for Google Sheets sync)

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create `.env` file from example:
```bash
copy .env.example .env
```

3. Configure your `.env` file:
```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
IMGBB_API_KEY=your_imgbb_api_key

# Optional: Google Sheets Integration
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}
GOOGLE_SHEET_ID=your_spreadsheet_id
GOOGLE_SHEET_RANGE=Sheet1!A:Q
```

**For Google Sheets setup**, see [GOOGLE_SHEETS_SETUP.md](./GOOGLE_SHEETS_SETUP.md)

## Running the Server

Development mode (with nodemon):
```bash
npm run dev
```

Or manually:
```bash
node index.js
```

## API Endpoints

### 1. Register User
**POST** `/api/register`

**Content-Type:** `multipart/form-data`

**Request Body:**
```javascript
{
  // Personal Details
  fullName: string,           // Min 2 characters
  email: string,              // Valid email format
  phone: string,              // Format: +91XXXXXXXXXX
  college: string,
  branch: string,
  year: string,               // "1", "2", "3" or "4"
  workshopTrack: string,      // Optional
  
  // Preferences
  accommodation: string,      // "yes" or "no"
  foodPreference: string,     // "veg" or "non-veg"
  
  // Membership
  ieeeStatus: string,         // "member" or "non-member"
  ieeeMembershipId: string,   // Required only for IEEE members
  ticketType: string,         // "ieee" or "non-ieee"
  
  // Payment
  transactionScreenshot: File, // Image file (JPEG/PNG/WebP, max 5MB)
  agreeToTerms: boolean       // Must be true
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Registration successful",
  "data": {
    "ticketId": "550e8400-e29b-41d4-a716-446655440000",
    "shortTicketId": "THM-550e8400",
    "email": "user@example.com"
  }
}
```

**Error Response (400/500):**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": ["Error message 1", "Error message 2"]
}
```

### 2. Health Check
**GET** `/api/health`

**Response:**
```json
{
  "success": true,
  "message": "Server is running",
  "timestamp": "2025-11-22T10:30:00.000Z"
}
```

### 3. Get Registration by Ticket ID
**GET** `/api/registration/:ticketId`

Accepts either full UUID or short ticket ID (THM-XXXXXXXX)

**Response:**
```json
{
  "success": true,
  "data": {
    "ticketId": "550e8400-e29b-41d4-a716-446655440000",
    "shortTicketId": "THM-550e8400",
    "fullName": "John Doe",
    "email": "john@example.com",
    // ... other fields
  }
}
```

## Database Schema

MongoDB collection: `registrations`

```javascript
{
  ticketId: string,              // Full UUID (unique)
  shortTicketId: string,         // THM-XXXXXXXX format (unique)
  fullName: string,
  email: string,                 // Unique, lowercase
  phone: string,
  college: string,
  branch: string,
  year: string,
  workshopTrack: string,         // Nullable
  accommodation: string,
  foodPreference: string,
  ieeeStatus: string,
  ieeeMembershipId: string,      // Nullable
  ticketType: string,
  transactionScreenshotUrl: string,
  transactionScreenshotDeleteUrl: string,
  agreeToTerms: boolean,
  status: string,                // "pending", "approved", "rejected"
  createdAt: Date,
  updatedAt: Date
}
```

## Validation Rules

- **fullName:** Minimum 2 characters
- **email:** Valid email format, unique in database
- **phone:** Must match `+91XXXXXXXXXX` format
- **year:** Must be "1", "2", "3", or "4"
- **accommodation:** Must be "yes" or "no"
- **foodPreference:** Must be "veg" or "non-veg"
- **ieeeStatus:** Must be "member" or "non-member"
- **ieeeMembershipId:** Required (min 5 chars) if IEEE member
- **ticketType:** Must be "ieee" or "non-ieee"
- **transactionScreenshot:** Required, max 5MB, JPEG/PNG/WebP only
- **agreeToTerms:** Must be true

## Rate Limiting

- **5 requests per IP** per 15-minute window
- Applies to `/api/register` endpoint only

## Google Sheets Integration

The backend automatically syncs all registration data to Google Sheets as a **background task**:

- ✅ Non-blocking: API responds immediately to users
- ✅ Automatic sync after each successful registration
- ✅ Fault-tolerant: If sync fails, registration still succeeds
- ✅ Detailed logging for monitoring

**Setup Instructions:** See [GOOGLE_SHEETS_SETUP.md](./GOOGLE_SHEETS_SETUP.md) for complete configuration guide.

**Sheet Columns:**
- Ticket ID, Short Ticket ID, Full Name, Email, Phone
- College, Branch, Year, Workshop Track
- Accommodation, Food Preference
- IEEE Status, IEEE Membership ID, Ticket Type
- Transaction Screenshot URL, Status, Created At

## Error Handling

The API includes comprehensive error handling for:
- ✅ Validation errors
- ✅ Duplicate email registration
- ✅ File upload errors
- ✅ ImgBB upload failures
- ✅ MongoDB connection issues
- ✅ Rate limit exceeded

## Security Features

- Rate limiting to prevent spam
- Email uniqueness validation
- File type and size restrictions
- Unique indexes on email, ticketId, and shortTicketId
- CORS enabled for cross-origin requests

## Logging

The server logs:
- New registration attempts
- Successful registrations with processing time
- Duplicate email attempts
- Upload operations
- Google Sheets sync status
- Errors and failures

## Testing with cURL

```bash
curl -X POST http://localhost:5000/api/register \
  -F "fullName=John Doe" \
  -F "email=john@example.com" \
  -F "phone=+919876543210" \
  -F "college=Example College" \
  -F "branch=Computer Science" \
  -F "year=3" \
  -F "accommodation=yes" \
  -F "foodPreference=veg" \
  -F "ieeeStatus=member" \
  -F "ieeeMembershipId=12345678" \
  -F "ticketType=ieee" \
  -F "agreeToTerms=true" \
  -F "transactionScreenshot=@/path/to/screenshot.jpg"
```

## License

ISC

## Author

Daniel Paul Perinchery
