"use client";
import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

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

export default function EnhancedBookingChatbot() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "👋 Welcome to Dr. Smile Dental Clinic! I'm your AI booking assistant and I'll help you schedule your appointment step by step.\n\n🎯 **Let's get started!**\n\nTo ensure we have all the information needed for your appointment, could you please tell me your full name?"
    }
  ]);
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [bookingState, setBookingState] = useState<BookingState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages]);

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isTyping) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: [...messages, userMessage] }),
      });
      
      const data = await res.json();
      
      // Simulate realistic typing delay
      setTimeout(() => {
        setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
        if (data.bookingState) {
          setBookingState(data.bookingState);
        }
        setIsTyping(false);
      }, 1500);
      
    } catch (error) {
      setIsTyping(false);
      setMessages((prev) => [...prev, { 
        role: "assistant", 
        content: "I apologize, but I'm having trouble connecting right now. Please try again in a moment or call us directly at (555) 123-SMILE." 
      }]);
    }
  }

  const quickReplies = getQuickReplies(bookingState);

  return (
    <>
      {/* Chat Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 z-50 w-16 h-16 rounded-full shadow-2xl transition-all duration-300 transform hover:scale-110 ${
          isOpen 
            ? 'bg-red-500 hover:bg-red-600 rotate-45' 
            : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 animate-pulse'
        }`}
      >
        <div className="flex items-center justify-center text-white text-xl">
          {isOpen ? '✕' : '🦷'}
        </div>
        
        {/* Booking indicator */}
        {!isOpen && bookingState && !bookingState.isComplete && (
          <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full border-2 border-white flex items-center justify-center">
            <span className="text-white text-xs font-bold">{bookingState.step}</span>
          </div>
        )}
      </button>

      {/* Chat Window */}
      <div
        className={`fixed bottom-24 right-6 z-40 w-96 max-w-[calc(100vw-3rem)] h-[600px] transition-all duration-500 transform ${
          isOpen 
            ? 'opacity-100 translate-y-0 scale-100' 
            : 'opacity-0 translate-y-4 scale-95 pointer-events-none'
        }`}
      >
        <div className="bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden h-full flex flex-col">
          {/* Header */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-4 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
                <span className="text-xl">🦷</span>
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-white">Dr. Smile Booking Agent</h3>
                <p className="text-blue-100 text-xs">
                  {isTyping ? 'AI is typing...' : bookingState ? `Step ${bookingState.step}/7` : 'Ready to help'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                <span className="text-xs text-blue-100">Online</span>
              </div>
            </div>
            
            {/* Progress Bar */}
            {bookingState && (
              <div className="mt-3">
                <div className="flex justify-between text-xs text-blue-100 mb-1">
                  <span>Booking Progress</span>
                  <span>{bookingState.step}/7</span>
                </div>
                <div className="w-full bg-blue-800/30 rounded-full h-2">
                  <div 
                    className="bg-green-400 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${(bookingState.step / 7) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} animate-in slide-in-from-bottom-2 duration-300`}
              >
                <div
                  className={`max-w-[85%] px-4 py-3 rounded-2xl shadow-sm ${
                    message.role === "user"
                      ? "bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-br-md"
                      : "bg-gray-100 text-gray-800 rounded-bl-md border border-gray-200"
                  }`}
                >
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
                  <div className={`text-xs mt-2 opacity-70 ${
                    message.role === "user" ? "text-blue-100" : "text-gray-500"
                  }`}>
                    {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
            
            {/* Typing Indicator */}
            {isTyping && (
              <div className="flex justify-start animate-in slide-in-from-bottom-2 duration-300">
                <div className="bg-gray-100 border border-gray-200 px-4 py-3 rounded-2xl rounded-bl-md shadow-sm">
                  <div className="flex gap-1 items-center">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce delay-100"></div>
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce delay-200"></div>
                    <span className="ml-2 text-xs text-gray-500">Processing your information...</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Quick Replies */}
          {quickReplies.length > 0 && !isTyping && (
            <div className="px-4 pb-2">
              <div className="flex flex-wrap gap-2">
                {quickReplies.map((reply, index) => (
                  <button
                    key={index}
                    onClick={() => setInput(reply)}
                    className="text-xs px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-full border border-blue-200 transition-colors duration-200"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input Form */}
          <div className="border-t border-gray-200 p-4 bg-gray-50/80 flex-shrink-0">
            <form onSubmit={sendMessage} className="flex gap-3">
              <input
                className="flex-1 bg-white border border-gray-200 rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-500 shadow-sm transition-all duration-200"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={getInputPlaceholder(bookingState)}
                disabled={isTyping}
              />
              <button
                type="submit"
                disabled={!input.trim() || isTyping}
                className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-2.5 rounded-full hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

function getQuickReplies(bookingState: BookingState | null): string[] {
  if (!bookingState) return [];

  switch (bookingState.step) {
    case 4: // Service selection
      return ["Cleaning", "Checkup", "Whitening", "Filling", "Emergency"];
    case 5: // Date selection
      return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
    case 6: // Time selection
      return ["10:00 AM", "2:00 PM", "4:00 PM"];
    case 7: // Confirmation
      return ["Yes, confirm", "Make changes"];
    default:
      return [];
  }
}

function getInputPlaceholder(bookingState: BookingState | null): string {
  if (!bookingState) return "Type your message...";

  switch (bookingState.step) {
    case 1:
      return "Enter your full name...";
    case 2:
      return "Enter your phone number...";
    case 3:
      return "Enter your email address...";
    case 4:
      return "Choose a service...";
    case 5:
      return "Choose your preferred day...";
    case 6:
      return "Choose your preferred time...";
    case 7:
      return "Confirm your appointment...";
    default:
      return "Type your message...";
  }
}