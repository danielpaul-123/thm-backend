require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 5000;

// CORS configuration for Vercel
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://thm.ieee-link.org',
      'http://localhost:3000',
      'http://localhost:5173'
    ];
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200
};

// Middleware
app.use(cors(corsOptions));

// Additional CORS headers for Vercel
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || 'https://thm.ieee-link.org');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting middleware
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 requests per windowMs
  message: {
    success: false,
    message: 'Too many registration attempts, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Configure multer for file uploads (memory storage)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.'));
    }
  },
});

// Google Sheets configuration
let sheets;
let auth;

const initializeGoogleSheets = async () => {
  try {
    // Parse the service account JSON from environment variable
    const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}');
    
    if (!credentials.client_email) {
      console.warn('⚠️  Google Sheets credentials not configured. Sheet sync will be disabled.');
      return;
    }

    auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    sheets = google.sheets({ version: 'v4', auth });
    console.log('✅ Google Sheets API initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize Google Sheets:', error.message);
    sheets = null;
  }
};

// Function to append data to Google Sheets (background task)
const appendToGoogleSheets = async (registrationData) => {
  // Run as background task - don't block the response
  setImmediate(async () => {
    try {
      if (!sheets || !process.env.GOOGLE_SHEET_ID) {
        console.log('⏭️  Skipping Google Sheets sync (not configured)');
        return;
      }

      const row = [
        registrationData.ticketId,
        registrationData.shortTicketId,
        registrationData.fullName,
        registrationData.email,
        registrationData.phone,
        registrationData.college,
        registrationData.branch,
        registrationData.year,
        registrationData.gender,
        registrationData.accommodation,
        registrationData.foodPreference,
        registrationData.ieeeStatus,
        registrationData.ieeeMembershipId || '',
        registrationData.ticketType,
        registrationData.transactionScreenshotUrl,
        registrationData.status,
        registrationData.createdAt.toISOString(),
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: process.env.GOOGLE_SHEET_RANGE || 'Sheet1!A:Q',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: {
          values: [row],
        },
      });

      console.log(`📊 Successfully synced to Google Sheets: ${registrationData.shortTicketId}`);
    } catch (error) {
      console.error(`❌ Failed to sync to Google Sheets for ${registrationData.shortTicketId}:`, error.message);
      // Don't throw error - this is a background task
    }
  });
};

// MongoDB connection
let db;
let registrationsCollection;
let client;
let isConnecting = false;

const connectDB = async () => {
  // If already connected, return
  if (registrationsCollection) {
    return;
  }

  // If connection is in progress, wait
  if (isConnecting) {
    await new Promise(resolve => {
      const checkConnection = setInterval(() => {
        if (registrationsCollection || !isConnecting) {
          clearInterval(checkConnection);
          resolve();
        }
      }, 100);
    });
    return;
  }

  isConnecting = true;
  try {
    client = new MongoClient(process.env.MONGODB_URI);
    await client.connect();
    db = client.db('thm25');
    registrationsCollection = db.collection('tickets');
    
    // Create indexes
    await registrationsCollection.createIndex({ email: 1 }, { unique: true });
    await registrationsCollection.createIndex({ ticketId: 1 }, { unique: true });
    await registrationsCollection.createIndex({ shortTicketId: 1 }, { unique: true });
    
    console.log('✅ Connected to MongoDB successfully');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    registrationsCollection = null;
    throw error;
  } finally {
    isConnecting = false;
  }
};

// Validation middleware
const validateRegistration = (req, res, next) => {
  const {
    fullName,
    email,
    phone,
    college,
    branch,
    year,
    gender,
    accommodation,
    foodPreference,
    ieeeStatus,
    ieeeMembershipId,
    ticketType,
    agreeToTerms,
  } = req.body;

  const errors = [];

  // Validate fullName
  if (!fullName || fullName.trim().length < 2) {
    errors.push('Full name must be at least 2 characters long');
  }

  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    errors.push('Valid email address is required');
  }

  // Validate phone
  const phoneRegex = /^\+91[6-9]\d{9}$/;
  if (!phone || !phoneRegex.test(phone)) {
    errors.push('Phone number must be in format: +91XXXXXXXXXX');
  }

  // Validate college
  if (!college || college.trim().length < 2) {
    errors.push('College name is required');
  }

  // Validate branch
  if (!branch || branch.trim().length < 2) {
    errors.push('Branch is required');
  }

  // Validate year
  if (!year || !['1', '2', '3', '4'].includes(year)) {
    errors.push('Year must be 1, 2, 3, or 4');
  }

  // Validate gender
  if (!gender || !['male', 'female', 'other'].includes(gender.toLowerCase())) {
    errors.push('Gender must be "male", "female", or "other"');
  }

  // Validate accommodation
  if (!accommodation || !['yes', 'no'].includes(accommodation)) {
    errors.push('Accommodation must be "yes" or "no"');
  }

  // Validate foodPreference
  if (!foodPreference || !['veg', 'non-veg'].includes(foodPreference)) {
    errors.push('Food preference must be "veg" or "non-veg"');
  }

  // Validate ieeeStatus
  if (!ieeeStatus || !['member', 'non-member'].includes(ieeeStatus)) {
    errors.push('IEEE status must be "member" or "non-member"');
  }

  // Validate ieeeMembershipId for members
  if (ieeeStatus === 'member' && (!ieeeMembershipId || ieeeMembershipId.trim().length < 5)) {
    errors.push('IEEE Membership ID is required for IEEE members');
  }

  // Validate ticketType
  if (!ticketType || !['ieee', 'non-ieee'].includes(ticketType)) {
    errors.push('Ticket type must be "ieee" or "non-ieee"');
  }

  // Validate agreeToTerms
  if (agreeToTerms !== true && agreeToTerms !== 'true') {
    errors.push('You must agree to the terms and conditions');
  }

  // Validate file upload
  if (!req.file) {
    errors.push('Transaction screenshot is required');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors,
    });
  }

  next();
};

// ImgBB upload function
const uploadToImgBB = async (imageBuffer, imageName) => {
  try {
    const formData = new FormData();
    const base64Image = imageBuffer.toString('base64');
    
    const response = await axios.post(
      `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
      new URLSearchParams({
        image: base64Image,
        name: imageName,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    if (response.data && response.data.success) {
      return {
        success: true,
        url: response.data.data.url,
        deleteUrl: response.data.data.delete_url,
      };
    } else {
      throw new Error('ImgBB upload failed');
    }
  } catch (error) {
    console.error('ImgBB upload error:', error.message);
    throw new Error('Failed to upload image to ImgBB: ' + error.message);
  }
};

// Generate short ticket ID from UUID
const generateShortTicketId = (uuid) => {
  // Take first 8 characters of UUID
  const shortId = uuid.split('-')[0];
  return `THM-${shortId}`;
};

// Registration endpoint
app.post('/api/register', registrationLimiter, upload.single('transactionScreenshot'), validateRegistration, async (req, res) => {
  const registrationStartTime = Date.now();
  
  try {
    // Ensure database connection for serverless
    await connectDB();

    const {
      fullName,
      email,
      phone,
      college,
      branch,
      year,
      gender,
      accommodation,
      foodPreference,
      ieeeStatus,
      ieeeMembershipId,
      ticketType,
      agreeToTerms,
    } = req.body;

    console.log(`📝 New registration attempt: ${email}`);

    // Check ticket limit (configurable via environment variable)
    const maxTickets = parseInt(process.env.MAX_TICKETS) || 150;
    const totalTickets = await registrationsCollection.countDocuments();
    if (totalTickets >= maxTickets) {
      console.log(`🚫 Ticket limit reached: ${totalTickets}/${maxTickets}`);
      return res.status(400).json({
        success: false,
        message: 'Registration closed',
        error: `Maximum ticket limit of ${maxTickets} has been reached. Registration is now closed.`,
      });
    }

    // Check if email already exists
    const existingRegistration = await registrationsCollection.findOne({ email: email.toLowerCase() });
    if (existingRegistration) {
      console.log(`⚠️  Duplicate email attempt: ${email}`);
      return res.status(400).json({
        success: false,
        message: 'Email already registered',
        error: 'This email address has already been used for registration',
      });
    }

    // Generate ticket IDs
    const fullTicketId = uuidv4();
    const shortTicketId = generateShortTicketId(fullTicketId);

    console.log(`🎫 Generated ticket IDs - Full: ${fullTicketId}, Short: ${shortTicketId}`);

    // Upload transaction screenshot to ImgBB
    console.log(`📤 Uploading transaction screenshot to ImgBB...`);
    const uploadResult = await uploadToImgBB(
      req.file.buffer,
      `transaction_${shortTicketId}_${Date.now()}`
    );

    if (!uploadResult.success) {
      throw new Error('Failed to upload transaction screenshot');
    }

    console.log(`✅ Screenshot uploaded successfully: ${uploadResult.url}`);

    // Prepare registration document
    const registrationDoc = {
      ticketId: fullTicketId,
      shortTicketId: shortTicketId,
      fullName: fullName.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      college: college.trim(),
      branch: branch.trim(),
      year: year,
      gender: gender.toLowerCase().trim(),
      accommodation: accommodation,
      foodPreference: foodPreference,
      ieeeStatus: ieeeStatus,
      ieeeMembershipId: ieeeStatus === 'member' ? ieeeMembershipId.trim() : null,
      ticketType: ticketType,
      transactionScreenshotUrl: uploadResult.url,
      transactionScreenshotDeleteUrl: uploadResult.deleteUrl,
      agreeToTerms: agreeToTerms === true || agreeToTerms === 'true',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Insert into MongoDB
    const result = await registrationsCollection.insertOne(registrationDoc);

    const processingTime = Date.now() - registrationStartTime;
    console.log(`✅ Registration successful for ${email} (${processingTime}ms)`);

    // Sync to Google Sheets in background (non-blocking)
    appendToGoogleSheets(registrationDoc);

    // Return success response
    res.status(201).json({
      success: true,
      message: 'Registration successful',
      data: {
        ticketId: fullTicketId,
        shortTicketId: shortTicketId,
        email: email.toLowerCase().trim(),
      },
    });

  } catch (error) {
    console.error('❌ Registration error:', error.message);
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Registration already exists',
        error: 'This email or ticket ID already exists in the system',
      });
    }

    // Handle other errors
    res.status(500).json({
      success: false,
      message: 'Registration failed',
      error: error.message,
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  });
});

// Check ticket availability endpoint
app.get('/api/tickets/availability', async (req, res) => {
  try {
    // Ensure database connection for serverless
    await connectDB();

    // Check if database is connected
    if (!registrationsCollection) {
      return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable',
        error: 'Database not connected',
      });
    }

    const maxTickets = parseInt(process.env.MAX_TICKETS) || 150;
    const soldTickets = await registrationsCollection.countDocuments();
    const remainingTickets = Math.max(0, maxTickets - soldTickets);
    const isAvailable = remainingTickets > 0;

    res.json({
      success: true,
      data: {
        maxTickets: maxTickets,
        soldTickets: soldTickets,
        remainingTickets: remainingTickets,
        isAvailable: isAvailable,
        status: isAvailable ? 'open' : 'closed',
      },
    });
  } catch (error) {
    console.error('Error checking ticket availability:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to check ticket availability',
      error: error.message,
    });
  }
});

// Get registration by ticket ID (optional utility endpoint)
app.get('/api/registration/:ticketId', async (req, res) => {
  try {
    const { ticketId } = req.params;
    
    const registration = await registrationsCollection.findOne({
      $or: [
        { ticketId: ticketId },
        { shortTicketId: ticketId },
      ],
    });

    if (!registration) {
      return res.status(404).json({
        success: false,
        message: 'Registration not found',
      });
    }

    // Remove sensitive data
    const { transactionScreenshotDeleteUrl, ...safeData } = registration;

    res.json({
      success: true,
      data: safeData,
    });
  } catch (error) {
    console.error('Error fetching registration:', error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch registration',
      error: error.message,
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: 'File upload error',
      error: err.message,
    });
  }

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message,
  });
});

// Start server
const startServer = async () => {
  try {
    await connectDB();
    await initializeGoogleSheets();
    
    // Only start listening if not in serverless environment
    if (process.env.VERCEL !== '1') {
      app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📍 Registration endpoint: http://localhost:${PORT}/api/register`);
      });
    } else {
      console.log('🚀 Server ready for serverless deployment');
    }
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    // Don't exit in serverless - let it retry on next request
    if (process.env.VERCEL !== '1') {
      process.exit(1);
    }
  }
};

// Start server in development, or prepare for serverless
if (process.env.VERCEL !== '1') {
  startServer();
} else {
  // In serverless, connection will be established per request
  initializeGoogleSheets().catch(console.error);
}

// Export for Vercel serverless
module.exports = app;
