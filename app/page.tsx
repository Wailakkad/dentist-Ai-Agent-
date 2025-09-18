import Chatbot from "@/components/Chatbot";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-center p-6">
      <h1 className="text-4xl font-bold text-blue-600">
        Dr. Smile Dental Clinic
      </h1>
      <p className="mt-4 text-gray-600">
        Book your dental appointment with our smart AI assistant.
      </p>
      <Chatbot />
    </main>
  );
}
