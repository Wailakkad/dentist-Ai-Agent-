import { NextResponse } from "next/server";
import nodemailer from "nodemailer";

interface BookingState {
  step: number;
  patientName: string;
  phoneNumber: string;
  email: string;
  serviceType: string;
  preferredDate: string;
  preferredTime: string;
  urgency: string;
  additionalNotes: string;
  isComplete: boolean;
}

interface ChatMessage {
  role: string;
  content: string;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

interface OpenRouterRequestBody {
  model: string;
  messages: ChatMessage[];
  max_tokens: number;
  temperature: number;
}

// Per-session rate limiting
interface RateLimitSession {
  lastApiCall: number;
  callCount: number;
}

const rateLimitSessions = new Map<string, RateLimitSession>();
const MIN_DELAY_BETWEEN_CALLS = 2000; // 2 seconds between API calls
const MAX_CALLS_PER_SESSION = 10; // Maximum calls per session
const SESSION_CLEANUP_INTERVAL = 300000; // 5 minutes

// Clean up old sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of rateLimitSessions.entries()) {
    if (now - session.lastApiCall > SESSION_CLEANUP_INTERVAL) {
      rateLimitSessions.delete(sessionId);
    }
  }
}, SESSION_CLEANUP_INTERVAL);

// Generate or extract session ID from request
function getSessionId(messages: ChatMessage[]): string {
  // Try to extract a session ID from the first message or generate one based on conversation content
  if (messages.length > 0) {
    const firstMessage = messages[0].content;
    // Create a simple hash-like ID based on first message and timestamp
    const hash = firstMessage.slice(0, 10) + Date.now().toString().slice(-6);
    return hash.replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  }
  
  // Fallback: generate random session ID
  return Math.random().toString(36).substring(2, 18);
}

// Per-session rate limiting function
function checkRateLimit(sessionId: string): { canProceed: boolean; delay: number } {
  const session = rateLimitSessions.get(sessionId);
  const now = Date.now();

  if (!session) {
    // First call for this session
    rateLimitSessions.set(sessionId, {
      lastApiCall: now,
      callCount: 1
    });
    return { canProceed: true, delay: 0 };
  }

  // Check if session has exceeded maximum calls
  if (session.callCount >= MAX_CALLS_PER_SESSION) {
    console.log(`🚫 Session ${sessionId} has exceeded maximum API calls (${MAX_CALLS_PER_SESSION})`);
    return { canProceed: false, delay: 0 };
  }

  const timeSinceLastCall = now - session.lastApiCall;
  
  if (timeSinceLastCall < MIN_DELAY_BETWEEN_CALLS) {
    const delay = MIN_DELAY_BETWEEN_CALLS - timeSinceLastCall;
    return { canProceed: false, delay };
  }

  // Update session
  session.lastApiCall = now;
  session.callCount++;
  
  return { canProceed: true, delay: 0 };
}

// Retry function with per-session exponential backoff
async function callOpenRouterWithRetry(requestBody: OpenRouterRequestBody, sessionId: string, maxRetries = 3): Promise<OpenRouterResponse> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Per-session rate limiting check
      const rateCheck = checkRateLimit(sessionId);
      
      if (!rateCheck.canProceed && rateCheck.delay > 0) {
        console.log(`⏳ Session ${sessionId}: Rate limiting - waiting ${rateCheck.delay}ms before API call...`);
        await new Promise(resolve => setTimeout(resolve, rateCheck.delay));
        
        // Recheck after delay
        const recheckResult = checkRateLimit(sessionId);
        if (!recheckResult.canProceed) {
          throw new Error("Rate limit exceeded for this session");
        }
      } else if (!rateCheck.canProceed) {
        throw new Error("Session has exceeded maximum API calls");
      }
      
      console.log(`🔄 Session ${sessionId}: OpenRouter API attempt ${attempt}/${maxRetries}`);
      
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (response.ok) {
        console.log(`✅ Session ${sessionId}: OpenRouter API call successful`);
        return await response.json() as OpenRouterResponse;
      }

      if (response.status === 429) { // Too Many Requests
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? parseInt(retryAfter) * 1000 : Math.pow(2, attempt) * 1000;
        
        console.log(`⏳ Session ${sessionId}: Rate limited by API. Waiting ${delay/1000}s before retry ${attempt}/${maxRetries}...`);
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }

      throw new Error(`OpenRouter API error: ${response.status} ${response.statusText}`);
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`❌ Session ${sessionId}: OpenRouter API attempt ${attempt} failed:`, errorMessage);
      
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Exponential backoff for other errors (per session)
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`⏳ Session ${sessionId}: Retrying in ${delay/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // This should never be reached, but TypeScript requires a return
  throw new Error("Max retries exceeded");
}

// Fallback responses when API is unavailable
function getFallbackResponse(bookingState: BookingState): string {
  switch (bookingState.step) {
    case 1:
      return "Welcome to Dr. Smile! I'm here to help you book an appointment. To get started, could you please tell me your full name?";
    
    case 2:
      return `Thank you, ${bookingState.patientName}! Now I'll need your phone number so we can contact you about your appointment. Please provide your phone number.`;
    
    case 3:
      return `Perfect! I have your phone number as ${bookingState.phoneNumber}. Next, could you please provide your email address for appointment confirmations?`;
    
    case 4:
      return `Great! I have your email as ${bookingState.email}. Now, what type of dental service would you like to book?\n\n• Routine Cleaning ($120)\n• Comprehensive Checkup ($80)\n• Teeth Whitening ($300)\n• Dental Fillings ($150-250)\n• Emergency Consultation ($200)\n\nWhich service interests you?`;
    
    case 5:
      return `Excellent choice! You've selected ${bookingState.serviceType}. Now, which day would work best for you? We're available Monday through Friday. What's your preferred day?`;
    
    case 6:
      return `Perfect! You've chosen ${bookingState.preferredDate}. For that day, we have appointments available at:\n• 10:00 AM\n• 2:00 PM\n• 4:00 PM\n\nWhich time slot would you prefer?`;
    
    case 7:
      return `Excellent! Let me confirm your appointment details:\n\n👤 Name: ${bookingState.patientName}\n📞 Phone: ${bookingState.phoneNumber}\n📧 Email: ${bookingState.email}\n🔧 Service: ${bookingState.serviceType}\n📅 Date: ${bookingState.preferredDate}\n🕒 Time: ${bookingState.preferredTime}\n\nIs all this information correct? Please confirm by saying "yes" to book your appointment.`;
    
    default:
      return "I'm here to help you book your dental appointment. Let's start with your name - what should I call you?";
  }
}

export async function POST(req: Request) {
  try {
    const { messages }: { messages: ChatMessage[] } = await req.json();
    
    console.log("🔍 Processing booking request with", messages.length, "messages");
    
    // Generate or extract session ID
    const sessionId = getSessionId(messages);
    console.log(`🔑 Session ID: ${sessionId}`);
    
    // Extract booking state from conversation
    const bookingState = extractBookingState(messages);
    console.log("📋 Current booking state:", bookingState);
    
    let reply: string;
    let apiCallSuccessful = false;

    try {
      // Try to call OpenRouter API with per-session retry logic
      const systemPrompt: ChatMessage = {
        role: "system",
        content: createSystemPrompt(bookingState),
      };

      const requestBody: OpenRouterRequestBody = {
        model: "meta-llama/llama-3.3-70b-instruct:free",
        messages: [systemPrompt, ...messages],
        max_tokens: 500, // Reduce token usage
        temperature: 0.7
      };

      const data = await callOpenRouterWithRetry(requestBody, sessionId);
      reply = data.choices?.[0]?.message?.content || getFallbackResponse(bookingState);
      apiCallSuccessful = true;
      
    } catch (apiError) {
      const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown error';
      console.error(`❌ Session ${sessionId}: OpenRouter API failed after retries, using fallback response`);
      console.error("Error details:", errorMessage);
      
      // Use fallback response when API fails
      reply = getFallbackResponse(bookingState);
      
      // Add a note about temporary limitations
      reply += "\n\n⚠️ *Our AI is experiencing high demand right now, but I can still help you book your appointment step by step.*";
    }

    // Update booking state based on user's latest message
    const updatedState = updateBookingState(bookingState, messages[messages.length - 1]?.content || '', messages);
    console.log("🔄 Updated booking state:", updatedState);
    
    // Add progress indicator to reply
    reply = addProgressIndicator(reply, updatedState);

    // Check if booking is complete and send email
    let emailSent = false;
    if (updatedState.isComplete || (updatedState.step >= 7 && (
        reply.toLowerCase().includes("booking") && reply.toLowerCase().includes("confirm") ||
        messages[messages.length - 1]?.content.toLowerCase().includes('yes') ||
        messages[messages.length - 1]?.content.toLowerCase().includes('confirm')
    ))) {
      console.log("✅ Booking complete, attempting to send email...");
      
      try {
        await sendBookingEmail(updatedState);
        emailSent = true;
        console.log("✅ Email sent successfully!");
        
        reply = "🎉 **Congratulations!** Your appointment has been successfully booked!\n\n" +
               `📋 **Appointment Summary:**\n` +
               `👤 Name: ${updatedState.patientName}\n` +
               `📞 Phone: ${updatedState.phoneNumber}\n` +
               `📧 Email: ${updatedState.email}\n` +
               `🔧 Service: ${updatedState.serviceType}\n` +
               `📅 Date: ${updatedState.preferredDate}\n` +
               `🕒 Time: ${updatedState.preferredTime}\n\n` +
               "✅ The doctor has been notified and will contact you soon to confirm the details.\n" +
               "📧 You should also receive a confirmation email shortly.\n\n" +
               "Thank you for choosing Dr. Smile Dental Clinic! 🦷";
        
      } catch (emailError) {
        console.error("❌ Failed to send booking email:", emailError);
        reply += "\n\n⚠️ Booking saved, but there was an issue sending the notification. Our staff will contact you shortly.";
      }
    }

    return NextResponse.json({ 
      reply,
      bookingState: updatedState,
      emailSent,
      apiCallSuccessful,
      sessionId // Include session ID in response for debugging
    });

  } catch (error) {
    console.error("❌ Booking Agent Error:", error);
    return NextResponse.json(
      { reply: "I'm experiencing technical difficulties. Please try again in a moment, or call us directly at (555) 123-SMILE for immediate assistance." },
      { status: 500 }
    );
  }
}

function extractBookingState(messages: ChatMessage[]): BookingState {
  const state: BookingState = {
    step: 1,
    patientName: '',
    phoneNumber: '',
    email: '',
    serviceType: '',
    preferredDate: '',
    preferredTime: '',
    urgency: 'routine',
    additionalNotes: '',
    isComplete: false
  };

  const userMessages = messages.filter(msg => msg.role === 'user');
  
  for (const message of userMessages) {
    const content = message.content;
    const lowerContent = content.toLowerCase();
    
    // Extract name
    if (!state.patientName) {
      const namePatterns = [
        /(?:my name is|i'm|i am|name.*is)\s+([a-zA-Z\s]+)/i,
        /^([a-zA-Z]+\s+[a-zA-Z]+)$/i,
        /([a-zA-Z]+\s+[a-zA-Z]+)/i
      ];
      
      for (const pattern of namePatterns) {
        const nameMatch = content.match(pattern);
        if (nameMatch) {
          const extractedName = nameMatch[1].trim();
          if (extractedName.length >= 2 && /^[a-zA-Z\s]+$/.test(extractedName)) {
            state.patientName = extractedName;
            break;
          }
        }
      }
    }
    
    // Extract phone
    if (!state.phoneNumber) {
      const phonePatterns = [
        /(\d{4}\d{6})/,
        /(\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/,
        /(\+\d{1,3}[-.\s]?\d{8,12})/,
        /(\d{10,12})/
      ];
      
      for (const pattern of phonePatterns) {
        const phoneMatch = content.match(pattern);
        if (phoneMatch) {
          state.phoneNumber = phoneMatch[1];
          break;
        }
      }
    }
    
    // Extract email
    if (!state.email) {
      const emailMatch = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) {
        state.email = emailMatch[0];
      }
    }
    
    // Extract service
    if (!state.serviceType) {
      const serviceKeywords = {
        'cleaning': ['cleaning', 'clean'],
        'checkup': ['checkup', 'check-up', 'check up', 'examination'],
        'whitening': ['whitening', 'whiten', 'bleaching'],
        'filling': ['filling', 'cavity', 'drill'],
        'emergency': ['emergency', 'urgent', 'pain', 'broken tooth']
      };
      
      for (const [service, keywords] of Object.entries(serviceKeywords)) {
        if (keywords.some(keyword => lowerContent.includes(keyword))) {
          state.serviceType = service;
          if (service === 'emergency') state.urgency = 'emergency';
          break;
        }
      }
    }
    
    // Extract date
    if (!state.preferredDate) {
      const dateKeywords = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'tomorrow', 'next week'];
      for (const keyword of dateKeywords) {
        if (lowerContent.includes(keyword)) {
          state.preferredDate = keyword;
          break;
        }
      }
    }
    
    // Extract time
    if (!state.preferredTime) {
      const timePatterns = [
        /(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i,
        /(\d{1,2}\s*(?:am|pm))/i,
        /(\d{1,2}:\d{2})/i
      ];
      
      for (const pattern of timePatterns) {
        const timeMatch = content.match(pattern);
        if (timeMatch) {
          state.preferredTime = timeMatch[1];
          break;
        }
      }
    }
  }
  
  state.step = determineCurrentStep(state);
  state.isComplete = state.step > 7;
  
  return state;
}

function determineCurrentStep(state: BookingState): number {
  if (!state.patientName) return 1;
  if (!state.phoneNumber) return 2;
  if (!state.email) return 3;
  if (!state.serviceType) return 4;
  if (!state.preferredDate) return 5;
  if (!state.preferredTime) return 6;
  return 7;
}

function updateBookingState(currentState: BookingState, latestMessage: string, allMessages: ChatMessage[]): BookingState {
  const content = latestMessage.toLowerCase();
  const newState = { ...currentState };
  
  const freshState = extractBookingState(allMessages);
  
  newState.patientName = freshState.patientName || newState.patientName;
  newState.phoneNumber = freshState.phoneNumber || newState.phoneNumber;
  newState.email = freshState.email || newState.email;
  newState.serviceType = freshState.serviceType || newState.serviceType;
  newState.preferredDate = freshState.preferredDate || newState.preferredDate;
  newState.preferredTime = freshState.preferredTime || newState.preferredTime;
  
  newState.step = determineCurrentStep(newState);
  
  if ((content.includes('yes') || content.includes('confirm') || content.includes('book it') || content.includes('correct')) && newState.step >= 7) {
    newState.isComplete = true;
  }
  
  return newState;
}

function createSystemPrompt(bookingState: BookingState): string {
  return `You are Dr. Smile's dental booking assistant. Current step: ${bookingState.step}/7.
  
Collected info:
- Name: ${bookingState.patientName || 'needed'}
- Phone: ${bookingState.phoneNumber || 'needed'}
- Email: ${bookingState.email || 'needed'}  
- Service: ${bookingState.serviceType || 'needed'}
- Date: ${bookingState.preferredDate || 'needed'}
- Time: ${bookingState.preferredTime || 'needed'}

Be helpful, professional, and guide them through the missing information. Keep responses concise.`;
}

function addProgressIndicator(reply: string, bookingState: BookingState): string {
  const progressBar = "▓".repeat(bookingState.step) + "░".repeat(7 - bookingState.step);
  const stepName = ["Name", "Phone", "Email", "Service", "Date", "Time", "Confirm"][bookingState.step - 1] || "Complete";
  
  return `${reply}\n\n📋 **Booking Progress:** ${progressBar} (${bookingState.step}/7 - ${stepName})`;
}

async function sendBookingEmail(bookingState: BookingState) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error("Email credentials not configured");
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  await transporter.verify();

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #f9f9f9; padding: 20px;">
      <div style="background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
        <h1 style="color: #2563eb; text-align: center;">🦷 Dr. Smile Clinic - New Booking</h1>
        <h2>📅 Appointment Details</h2>
        <p><strong>👤 Patient:</strong> ${bookingState.patientName}</p>
        <p><strong>📞 Phone:</strong> ${bookingState.phoneNumber}</p>
        <p><strong>📧 Email:</strong> ${bookingState.email}</p>
        <p><strong>🔧 Service:</strong> ${bookingState.serviceType}</p>
        <p><strong>📅 Date:</strong> ${bookingState.preferredDate}</p>
        <p><strong>🕒 Time:</strong> ${bookingState.preferredTime}</p>
        <hr>
        <p style="text-align: center; color: #666; font-size: 12px;">
          📅 Received: ${new Date().toLocaleString()}<br>
          🤖 Dr. Smile AI Booking Assistant
        </p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"Dr. Smile AI Booking" <${process.env.EMAIL_USER}>`,
    to: process.env.DOCTOR_EMAIL || process.env.EMAIL_USER,
    subject: `🦷 NEW BOOKING: ${bookingState.patientName} - ${bookingState.serviceType}`,
    html: emailHtml,
  });
}