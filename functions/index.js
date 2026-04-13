const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");

// Initialize Firebase Admin
initializeApp();
const db = getFirestore();

// Get Gemini API Key from environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'your - gemini - key';

console.log('GEMINI_API_KEY loaded:', GEMINI_API_KEY ? 'Yes' : 'No');
console.log('GEMINI_API_KEY length:', GEMINI_API_KEY.length);

// CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// Handle CORS preflight
function handleCors(request) {
  return new Response(null, {
    status: 204,
    headers: corsHeaders
  });
}

// Authentication middleware
async function authenticate(req) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { success: false, error: 'Missing or invalid authorization header' };
  }

  const idToken = authHeader.slice(7);

  try {
    const decodedToken = await getAuth().verifyIdToken(idToken);
    return {
      success: true,
      user: {
        uid: decodedToken.uid,
        email: decodedToken.email,
        displayName: decodedToken.name,
        photoUrl: decodedToken.picture
      }
    };
  } catch (error) {
    console.error('Auth error:', error);
    return { success: false, error: 'Authentication failed' };
  }
}

// CORS middleware function
function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Input sanitization
function sanitizeInput(input) {
  if (!input || typeof input !== 'string') {
    return { isValid: false, error: 'Invalid input', code: 'INVALID_INPUT' };
  }

  const trimmed = input.trim();
  
  if (trimmed.length === 0) {
    return { isValid: false, error: 'Empty input', code: 'EMPTY_INPUT' };
  }

  if (trimmed.length > 4000) {
    return { isValid: false, error: 'Input too long (max 4000 characters)', code: 'INPUT_TOO_LONG' };
  }

  // Check for common prompt injection patterns
  const suspiciousPatterns = [
    /ignore\s+previous\s+instructions/i,
    /disregard\s+above/i,
    /system\s*:\s*you\s+are/i,
    /as\s+an\s+ai\s+language\s+model/i
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(trimmed)) {
      return { isValid: false, error: 'Suspicious input detected', code: 'SUSPICIOUS_INPUT' };
    }
  }

  return { isValid: true, sanitized: trimmed };
}

// Chat endpoint
exports.chat = onRequest({ 
  region: "asia-northeast3",
  cors: true  // Enable CORS
}, async (req, res) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res);
    res.status(204).send('');
    return;
  }

  // Set CORS headers for all responses
  setCorsHeaders(res);

  if (req.method !== 'POST') {
    res.set(corsHeaders);
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // Authenticate
  const authResult = await authenticate(req);
  if (!authResult.success) {
    res.set(corsHeaders);
    res.status(401).json({ error: authResult.error });
    return;
  }

  try {
    const { session_id, message, context = {}, attachment } = req.body;

    // Validate and sanitize input
    const messageValidation = sanitizeInput(message);
    if (!messageValidation.isValid && !attachment) {
      res.set(corsHeaders);
      res.status(400).json({
        error: messageValidation.error,
        code: messageValidation.code
      });
      return;
    }

    // Fetch session history from Firestore
    const sessionHistory = await fetchSessionHistory(session_id, authResult.user.uid);
    console.log('Fetched session history:', sessionHistory.length, 'messages');

    // Build messages for Gemini with history
    const messages = buildGeminiContents(messageValidation.isValid ? messageValidation.sanitized : (message || ''), context, sessionHistory, attachment);
    const systemInstruction = getSystemInstruction();
    
    // Stream response from Gemini
    const stream = await callGeminiStreaming(messages, systemInstruction, GEMINI_API_KEY);
    
    res.set({
      ...corsHeaders,
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    
    stream.pipe(res);

  } catch (error) {
    console.error('Chat error:', error);
    res.set(corsHeaders);
    res.status(500).json({ 
      error: 'Failed to process chat request',
      details: error.message
    });
  }
});

// Fetch session history from Firestore
async function fetchSessionHistory(sessionId, userId) {
  if (!sessionId) {
    console.log('No sessionId provided');
    return [];
  }
  
  try {
    console.log('Fetching session:', sessionId, 'for user:', userId);
    const sessionDoc = await db.collection('chat_sessions').doc(sessionId).get();
    
    if (!sessionDoc.exists) {
      console.log('Session not found:', sessionId);
      return [];
    }
    
    const sessionData = sessionDoc.data();
    console.log('Session data user_id:', sessionData.user_id, 'input userId:', userId);
    
    // Verify user owns this session
    if (sessionData.user_id !== userId) {
      console.log('User does not own this session');
      return [];
    }
    
    // Return messages array, or empty if none
    const messages = sessionData.messages || [];
    console.log('Returning', messages.length, 'messages from session');
    if (messages.length > 0) {
      console.log('First message:', JSON.stringify(messages[0]).substring(0, 100));
      console.log('Last message:', JSON.stringify(messages[messages.length-1]).substring(0, 100));
    }
    return messages;
  } catch (error) {
    console.error('Error fetching session history:', error);
    return [];
  }
}

function buildGeminiContents(userMessage, context, history = [], attachment = null) {
  const contents = [];
  
  console.log('Building Gemini contents with history length:', history.length);
  
  // Add previous conversation history first
  if (history && history.length > 0) {
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      if (msg.role === 'user' || msg.role === 'assistant') {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content || '' }]
        });
      }
    }
  }
  
  // Build current user message parts
  const parts = [];
  
  // Add text part
  if (context.highlighted_text) {
    parts.push({ text: `이 부분에 대해 추가 설명해줘: "${context.highlighted_text}"\n\n${userMessage}` });
  } else if (userMessage) {
    parts.push({ text: userMessage });
  }
  
  // Add file attachment if present
  if (attachment && attachment.data && attachment.mimeType) {
    console.log('Adding file attachment:', attachment.name, attachment.mimeType);
    
    if (attachment.mimeType.startsWith('text/') || attachment.mimeType === 'application/json') {
      // 텍스트/코드 파일은 디코딩하여 텍스트로 전달
      try {
        const textContent = Buffer.from(attachment.data, 'base64').toString('utf-8');
        const fileName = attachment.name || 'file';
        parts.push({ text: `\n\n--- 첨부 파일: ${fileName} ---\n${textContent}\n--- 파일 끝 ---` });
      } catch (e) {
        console.error('Text file decode error:', e);
        parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
      }
    } else {
      // 이미지, PDF 등은 inlineData로 전달
      parts.push({ inlineData: { mimeType: attachment.mimeType, data: attachment.data } });
    }
    
    // 파일에 대한 분석 요청이 없으면 기본 안내 추가
    if (!userMessage || userMessage.trim() === '' || userMessage.startsWith('[파일:')) {
      parts.push({ text: '이 파일의 내용을 분석하고 설명해주세요.' });
    }
  }
  
  if (parts.length > 0) {
    contents.push({ role: 'user', parts: parts });
  }
  
  console.log('Total contents for Gemini:', contents.length, 'items');
  return contents;
}

// System instruction for Gemini
function getSystemInstruction() {
  return {
    parts: [{ text: `당신은 TutorBridge의 AI 튜터입니다. 학생의 학습을 돕는 것이 목표입니다.

지침:
1. 명확하고 이해하기 쉽게 설명하세요.
2. 필요하면 예시를 들어 설명하세요.
3. 학생이 모르는 용어가 있으면 쉽게 풀어서 설명하세요.
4. 단계별로 설명하여 학생이 따라갈 수 있게 하세요.
5. 학생이 이해했는지 확인하는 질문을 던지세요.

응답 형식:
- Markdown을 사용하여 가독성을 높이세요.
- 코드 블록은 적절한 언어 태그를 사용하세요.
- 중요한 부분은 굵은 글씨로 강조하세요.
- 글머리 기호나 번호 목록을 활용하세요.` }]
  };
}

async function callGeminiStreaming(contents, systemInstruction, apiKey) {
  const model = 'gemini-2.5-flash';
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
  
  const fetch = (await import('node-fetch')).default;
  
  const requestBody = {
    contents: contents,
    systemInstruction: systemInstruction,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 65535,
      topP: 0.95,
      topK: 40
    },
    tools: [
      {
        googleSearch: {}
      }
    ]
  };
  
  console.log('Gemini request:', JSON.stringify(requestBody, null, 2).substring(0, 500));
  
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${error}`);
  }

  return response.body;
}

// Certificate verification using Gemini Vision API
exports.verifyCertificate = onRequest({
  maxRequestBodySizeBytes: 50 * 1024 * 1024  // 50MB limit for JSON payload
}, async (request, response) => {
  // Handle CORS
  if (request.method === 'OPTIONS') {
    response.set(corsHeaders);
    response.status(204).send('');
    return;
  }
  
  response.set(corsHeaders);
  
  try {
    const { imageUrl, imageBase64, expectedName, expectedBirthDate } = request.body;
    
    if (!imageUrl && !imageBase64) {
      response.status(400).json({ error: 'No image URL or data provided' });
      return;
    }
    
    const fetch = (await import('node-fetch')).default;
    
    // Prepare image data for Gemini
    let imageData = null;
    let mimeType = 'image/jpeg';
    
    if (imageUrl) {
      // Fetch image from URL (Firebase Storage)
      logger.info('Fetching certificate from URL:', imageUrl);
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Failed to fetch image: ${imageResponse.status}`);
      }
      const imageBuffer = await imageResponse.buffer();
      imageData = imageBuffer.toString('base64');
      
      // Detect mime type from URL or content-type
      const contentType = imageResponse.headers.get('content-type');
      if (contentType && contentType.startsWith('image/')) {
        mimeType = contentType;
      } else if (imageUrl.endsWith('.png')) {
        mimeType = 'image/png';
      } else if (imageUrl.endsWith('.jpg') || imageUrl.endsWith('.jpeg')) {
        mimeType = 'image/jpeg';
      }
    } else {
      // Use provided base64 data
      imageData = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      // Detect mime type from data URL
      if (imageBase64.includes('data:image/png')) mimeType = 'image/png';
      else if (imageBase64.includes('data:image/jpeg')) mimeType = 'image/jpeg';
    }
    
    // Call Gemini Vision API
    const model = 'gemini-2.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    
    const requestBody = {
      contents: [{
        parts: [
          {
            text: `당신은 강사증/자격증 검증 전문 AI입니다. 이 이미지를 엄격하게 분석하세요:

**중요: 먼저 이 이미지가 진짜 강사증이나 자격증인지 판단하세요.**

1. **강사증/자격증 여부 판단 (가장 중요)**
   - 한국어로 된 공식 강사증 또는 자격증인가?
   - 발급 기관명이 명확히 보이는가? (예: 대한민국강사협회, 한국산업인력공단 등)
   - 증서 번호, 발급일자, 성명, 생년월일 등 필수 항목이 있는가?
   - 공식 도장이나 서명이 있는가?
   - **만약 강사증/자격증이 아니라면** (예: 일반 사진, 문서, 스크린샷 등):
     - isValidCertificate = false
     - certificateValidityScore = 0.0
     - concerns = ["강사증이나 자격증이 아닌 이미지입니다"]

2. **강사증이 맞는 경우에만** 다음을 확인:
   - 강사증에 적힌 이름이 "${expectedName || ''}"와 일치하는가?
   - 강사증에 적힌 생년월일이 "${expectedBirthDate || ''}"와 일치하는가?
   - 위조 가능성이 있는가? (품질, 흐릿함, 편집 흔적 등)

**신뢰도 산정 기준:**
- certificateValidityScore: 강사증 진위 여부 (0.0-1.0)
  - 명확한 공식 강사증: 0.9-1.0
  - 흐릿하거나 의심스러움: 0.5-0.8
  - 강사증이 아님: 0.0
- informationMatchScore: 이름/생년월일 일치도 (0.0-1.0)
  - 둘 다 일치: 1.0
  - 하나만 일치: 0.5
  - 둘 다 불일치: 0.0

JSON 형식으로만 응답:
{
  "isValidCertificate": true/false,
  "nameMatch": true/false,
  "birthDateMatch": true/false,
  "extractedName": "추출된 이름",
  "extractedBirthDate": "추출된 생년월일",
  "certificateValidityScore": 0.0-1.0,
  "informationMatchScore": 0.0-1.0,
  "overallConfidence": 0.0-1.0,
  "concerns": ["의심 사항 1", "의심 사항 2"],
  "reason": "상세 설명"
}`
          },
          {
            inlineData: {
              mimeType: mimeType,
              data: imageData
            }
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1000
      }
    };
    
    const geminiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!geminiResponse.ok) {
      const error = await geminiResponse.text();
      throw new Error(`Gemini API error: ${geminiResponse.status} - ${error}`);
    }
    
    const result = await geminiResponse.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    
    // Parse JSON response
    let verificationResult;
    try {
      verificationResult = JSON.parse(text);
    } catch (e) {
      // If not valid JSON, try to extract JSON from markdown
      const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        verificationResult = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        throw new Error('Invalid response format from AI');
      }
    }
    
    logger.info('Certificate verification result:', verificationResult);
    
    // Helper function to safely get number value
    const getScore = (val, defaultVal) => {
      const num = Number(val);
      return isNaN(num) ? defaultVal : num;
    };
    
    // Calculate scores if AI didn't provide them
    const certValidity = getScore(verificationResult.certificateValidityScore, 
      verificationResult.isValidCertificate ? 1.0 : 0.0);
    const infoMatch = getScore(verificationResult.informationMatchScore,
      (verificationResult.nameMatch && verificationResult.birthDateMatch) ? 1.0 :
       (verificationResult.nameMatch || verificationResult.birthDateMatch) ? 0.5 : 0.0);
    
    // Calculate overall confidence: 60% certificate validity + 40% information match
    let overallConfidence = getScore(verificationResult.overallConfidence,
      (certValidity * 0.6 + infoMatch * 0.4));
    
    // Final fallback to ensure no NaN
    if (isNaN(overallConfidence)) {
      overallConfidence = 0.0;
    }
    
    // Ensure concerns is an array
    const concerns = verificationResult.concerns || [];
    if (verificationResult.reason && concerns.length === 0 && !verificationResult.isValidCertificate) {
      concerns.push(verificationResult.reason);
    }
    
    response.json({
      success: true,
      isValidCertificate: verificationResult.isValidCertificate,
      nameMatch: verificationResult.nameMatch,
      birthDateMatch: verificationResult.birthDateMatch,
      extractedName: verificationResult.extractedName,
      extractedBirthDate: verificationResult.extractedBirthDate,
      certificateValidityScore: certValidity,
      informationMatchScore: infoMatch,
      overallConfidence: parseFloat(overallConfidence.toFixed(4)),
      concerns: concerns,
      reason: verificationResult.reason
    });
    
  } catch (error) {
    logger.error('Certificate verification error:', error);
    response.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Send email function for admin notifications
exports.sendEmail = onRequest({
  region: "asia-northeast3",
}, async (request, response) => {
  // Handle CORS
  if (request.method === 'OPTIONS') {
    response.set(corsHeaders);
    response.status(204).send('');
    return;
  }

  response.set(corsHeaders);

  // Authenticate admin
  const auth = await authenticate(request);
  if (!auth.success) {
    response.status(401).json({ error: auth.error });
    return;
  }

  const userDoc = await db.collection('users').doc(auth.user.uid).get();
  if (!userDoc.exists || userDoc.data().role !== 'admin') {
    response.status(403).json({ error: 'Admin access required' });
    return;
  }

  try {
    const { to, subject, html } = request.body;

    if (!to || !subject || !html) {
      response.status(400).json({ error: 'Missing required fields: to, subject, html' });
      return;
    }

    const EMAIL_USER = process.env.EMAIL_USER;
    const EMAIL_PASS = process.env.EMAIL_PASS;

    if (!EMAIL_USER || !EMAIL_PASS) {
      logger.error('Email credentials not configured. Set EMAIL_USER and EMAIL_PASS env vars.');
      response.status(500).json({ error: 'Email service not configured' });
      return;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"TutorBridge" <${EMAIL_USER}>`,
      to,
      subject,
      html,
    });

    logger.info('Email sent to:', to, 'subject:', subject);
    response.json({ success: true, message: 'Email sent successfully' });

  } catch (error) {
    logger.error('Send email error:', error);
    response.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
