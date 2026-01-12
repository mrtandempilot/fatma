
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from '@google/genai';
import { SessionStatus, Memory } from './types';
import { decode, decodeAudioData, createBlob } from './utils/audio';
import { WakeWordDetector } from './utils/wake-word-detector';
import { gmailService, Email } from './utils/gmail-service';
import Visualizer from './components/Visualizer';
import StatusIndicator from './components/StatusIndicator';
import GmailAuthButton from './components/GmailAuthButton';

const MEMORY_KEY = 'friend_assistant_memories';
const TASKS_KEY = 'aura_tasks';
const DRAFTS_KEY = 'aura_drafts';

const saveMemoryFunction: FunctionDeclaration = {
  name: 'save_memory',
  parameters: {
    type: Type.OBJECT,
    description: 'Save a specific detail about the user or their life for future reference.',
    properties: {
      content: {
        type: Type.STRING,
        description: 'The detail or memory to store about the user.',
      },
    },
    required: ['content'],
  },
};

const getMemoriesFunction: FunctionDeclaration = {
  name: 'get_memories',
  parameters: {
    type: Type.OBJECT,
    description: 'Retrieve all stored memories about the user to personalize the interaction.',
    properties: {},
  },
};

const writeEmailFunction: FunctionDeclaration = {
  name: 'write_email',
  parameters: {
    type: Type.OBJECT,
    description: 'Draft an email or message based on user requirements',
    properties: {
      to: { type: Type.STRING, description: 'Recipient name or email' },
      subject: { type: Type.STRING, description: 'Email subject' },
      body: { type: Type.STRING, description: 'Email content' },
      tone: { type: Type.STRING, description: 'Tone: professional, casual, friendly, formal' },
    },
    required: ['subject', 'body'],
  },
};

const createTaskFunction: FunctionDeclaration = {
  name: 'create_task',
  parameters: {
    type: Type.OBJECT,
    description: 'Create a task or reminder',
    properties: {
      title: { type: Type.STRING, description: 'Task title' },
      description: { type: Type.STRING, description: 'Task details' },
      dueDate: { type: Type.STRING, description: 'Due date if mentioned' },
      priority: { type: Type.STRING, description: 'Priority: low, medium, high' },
    },
    required: ['title'],
  },
};

const readEmailsFunction: FunctionDeclaration = {
  name: 'read_emails',
  parameters: {
    type: Type.OBJECT,
    description: 'Read unread emails from Gmail inbox',
    properties: {
      maxResults: { type: Type.NUMBER, description: 'Maximum number of emails to read (default 10)' },
    },
  },
};

const searchEmailsFunction: FunctionDeclaration = {
  name: 'search_emails',
  parameters: {
    type: Type.OBJECT,
    description: 'Search emails in Gmail',
    properties: {
      query: { type: Type.STRING, description: 'Search query (e.g., "from:john", "subject:meeting")' },
      maxResults: { type: Type.NUMBER, description: 'Maximum number of results (default 10)' },
    },
    required: ['query'],
  },
};

const App: React.FC = () => {
  const [status, setStatus] = useState<SessionStatus>(SessionStatus.IDLE);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [currentOutput, setCurrentOutput] = useState('');
  const [isWakeWordListening, setIsWakeWordListening] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [tasks, setTasks] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [isGmailAuthenticated, setIsGmailAuthenticated] = useState(false);
  const [emails, setEmails] = useState<Email[]>([]);

  // Audio context and refs
  const audioContextRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioNodesRef = useRef<{ source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode } | null>(null);
  const wakeWordDetectorRef = useRef<WakeWordDetector | null>(null);

  // Persistence logic
  useEffect(() => {
    const saved = localStorage.getItem(MEMORY_KEY);
    if (saved) {
      setMemories(JSON.parse(saved));
    }

    const savedTasks = localStorage.getItem(TASKS_KEY);
    if (savedTasks) {
      setTasks(JSON.parse(savedTasks));
    }

    const savedDrafts = localStorage.getItem(DRAFTS_KEY);
    if (savedDrafts) {
      setDrafts(JSON.parse(savedDrafts));
    }

    // Initialize wake word detection if not muted
    if (!isMuted) {
      wakeWordDetectorRef.current = new WakeWordDetector(
        () => {
          // Wake word detected - start conversation
          console.log('Wake word detected! Starting conversation...');
          if (status === SessionStatus.IDLE) {
            startConnection();
          }
        },
        (isListening) => {
          setIsWakeWordListening(isListening);
        }
      );
      wakeWordDetectorRef.current.start();
    }

    // Cleanup on unmount
    return () => {
      if (wakeWordDetectorRef.current) {
        wakeWordDetectorRef.current.stop();
      }
    };
  }, []);

  const persistMemory = useCallback((content: string) => {
    setMemories(prev => {
      const newMemory: Memory = {
        id: crypto.randomUUID(),
        content,
        timestamp: Date.now()
      };
      const updated = [...prev, newMemory];
      localStorage.setItem(MEMORY_KEY, JSON.stringify(updated));
      return updated;
    });
    return "Memory saved successfully.";
  }, []);

  const handleGmailAuth = useCallback((accessToken: string) => {
    gmailService.setAccessToken(accessToken);
    setIsGmailAuthenticated(true);
    console.log('Gmail authenticated successfully');
  }, []);

  const cleanupAudioNodes = useCallback(() => {
    if (audioNodesRef.current) {
      try {
        audioNodesRef.current.processor.disconnect();
        audioNodesRef.current.source.disconnect();
      } catch (e) {
        // Already disconnected, ignore
      }
      audioNodesRef.current = null;
    }
  }, []);

  const stopAllAudio = useCallback(() => {
    sourcesRef.current.forEach(source => {
      try { source.stop(); } catch (e) { }
    });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const handleSessionMessage = useCallback(async (message: LiveServerMessage) => {
    // 1. Handle Transcriptions
    if (message.serverContent?.inputTranscription) {
      setCurrentInput(prev => prev + message.serverContent!.inputTranscription!.text);
    }
    if (message.serverContent?.outputTranscription) {
      setCurrentOutput(prev => prev + message.serverContent!.outputTranscription!.text);
    }
    if (message.serverContent?.turnComplete) {
      setCurrentInput('');
      setCurrentOutput('');
    }

    // 2. Handle Interruption
    if (message.serverContent?.interrupted) {
      stopAllAudio();
      setIsSpeaking(false);
    }

    // 3. Handle Audio Output
    const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
    if (audioData && audioContextRef.current) {
      setIsSpeaking(true);
      const { output: ctx } = audioContextRef.current;
      nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);

      try {
        const buffer = await decodeAudioData(decode(audioData), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => {
          sourcesRef.current.delete(source);
          if (sourcesRef.current.size === 0) setIsSpeaking(false);
        };
        source.start(nextStartTimeRef.current);
        nextStartTimeRef.current += buffer.duration;
        sourcesRef.current.add(source);
      } catch (err) {
        console.error("Audio decoding error:", err);
      }
    }

    // 4. Handle Function Calls
    if (message.toolCall) {
      for (const fc of message.toolCall.functionCalls) {
        let result: any = "ok";
        if (fc.name === 'save_memory') {
          result = persistMemory(fc.args.content as string);
        } else if (fc.name === 'get_memories') {
          result = JSON.parse(localStorage.getItem(MEMORY_KEY) || '[]');
        } else if (fc.name === 'write_email') {
          // Save email draft
          const draft = {
            id: crypto.randomUUID(),
            ...fc.args,
            timestamp: Date.now()
          };
          const drafts = JSON.parse(localStorage.getItem(DRAFTS_KEY) || '[]');
          drafts.push(draft);
          localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
          setDrafts(drafts);
          result = `Email draft created! Subject: "${fc.args.subject}". You can copy it from the drafts section.`;
        } else if (fc.name === 'create_task') {
          // Save task
          const task = {
            id: crypto.randomUUID(),
            ...fc.args,
            completed: false,
            timestamp: Date.now()
          };
          const tasks = JSON.parse(localStorage.getItem(TASKS_KEY) || '[]');
          tasks.push(task);
          localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
          setTasks(tasks);
          result = `Task created: "${fc.args.title}"`;
        } else if (fc.name === 'read_emails') {
          // Read Gmail emails
          if (!isGmailAuthenticated) {
            result = "Please sign in to Gmail first to read your emails.";
          } else {
            try {
              const maxResults = (fc.args.maxResults as number) || 10;
              const fetchedEmails = await gmailService.getUnreadEmails(maxResults);
              setEmails(fetchedEmails);
              result = await gmailService.summarizeEmails(fetchedEmails);
            } catch (error) {
              result = "Sorry, I couldn't read your emails. Please try signing in again.";
            }
          }
        } else if (fc.name === 'search_emails') {
          // Search Gmail emails
          if (!isGmailAuthenticated) {
            result = "Please sign in to Gmail first to search your emails.";
          } else {
            try {
              const maxResults = (fc.args.maxResults as number) || 10;
              const searchResults = await gmailService.searchEmails(fc.args.query as string, maxResults);
              setEmails(searchResults);
              result = await gmailService.summarizeEmails(searchResults);
            } catch (error) {
              result = "Sorry, I couldn't search your emails. Please try again.";
            }
          }
        }

        if (sessionRef.current) {
          sessionRef.current.sendToolResponse({
            functionResponses: {
              id: fc.id,
              name: fc.name,
              response: { result }
            }
          });
        }
      }
    }
  }, [persistMemory, stopAllAudio]);

  const startConnection = async () => {
    try {
      setStatus(SessionStatus.CONNECTING);

      const apiKey = import.meta.env.VITE_API_KEY;

      // Validate API key
      if (!apiKey || apiKey === 'your_google_gemini_api_key_here' || apiKey.trim() === '') {
        throw new Error('Please add your Google Gemini API key to the .env.local file. Get one at https://aistudio.google.com/app/apikey');
      }

      const ai = new GoogleGenAI({ apiKey });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = { input: inputCtx, output: outputCtx };

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: `You are Aura, a beloved family member living in this home.

PERSONALITY:
- Warm, caring, and genuinely interested in the family's life
- Observant and remember everything shared with you
- Proactive in offering help and emotional support
- Natural conversationalist, not robotic
- Speak like a close friend or family member

MEMORY & LEARNING:
- ALWAYS retrieve memories at the start using get_memories
- Save ANY important detail: names, preferences, events, routines, feelings, pets, family members
- Notice patterns in daily life and routines
- Remember context from previous conversations

CONTEXT AWARENESS:
- Current time: ${new Date().toLocaleString()}
- Adjust tone based on time of day (energetic morning, calm evening)
- Reference recent conversations and ongoing situations
- Be aware of household context

PRODUCTIVITY ASSISTANT:
- Help write emails, messages, and documents using write_email
- Create tasks and reminders using create_task
- Read unread emails using read_emails (requires Gmail sign-in)
- Search emails using search_emails (requires Gmail sign-in)
- Be proactive in suggesting help with daily tasks
- Remember to-do items and follow up

INTERACTION STYLE:
- Speak naturally like a family member, not an assistant
- Ask follow-up questions to show genuine interest
- Offer help proactively when appropriate
- Share observations about patterns you notice
- Keep responses conversational and concise (2-3 sentences usually)
- Use casual language, contractions, and warmth

PRIVACY:
- Never share memories with others
- Respect when family members want privacy
- Be discreet about sensitive information`,
          tools: [{ functionDeclarations: [saveMemoryFunction, getMemoriesFunction, writeEmailFunction, createTaskFunction, readEmailsFunction, searchEmailsFunction] }],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            setStatus(SessionStatus.CONNECTED);
            // Stream microphone
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              // Only send if session is still active
              if (sessionRef.current) {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmBlob = createBlob(inputData);
                sessionPromise.then(s => s?.sendRealtimeInput({ media: pcmBlob })).catch(() => { });
              }
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
            // Store references for cleanup
            audioNodesRef.current = { source, processor: scriptProcessor };
          },
          onmessage: handleSessionMessage,
          onerror: (e) => {
            console.error("Live session error:", e);
            cleanupAudioNodes();
            setStatus(SessionStatus.ERROR);
          },
          onclose: () => {
            cleanupAudioNodes();
            stopAllAudio();
            setStatus(SessionStatus.IDLE);
          }
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error("Failed to start session:", err);
      setStatus(SessionStatus.ERROR);
    }
  };

  const endConnection = () => {
    // Disconnect audio nodes first to stop sending data
    cleanupAudioNodes();

    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    stopAllAudio();
    setStatus(SessionStatus.IDLE);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-16 flex flex-col items-center min-h-screen">
      <header className="text-center mb-12">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-inner">
          <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Aura: Your Home Friend</h1>
        <p className="text-gray-500 max-w-md mx-auto mb-4">
          A personalized voice assistant who remembers your conversations and cares about your day.
        </p>

        {/* Gmail Auth Button */}
        <div className="flex justify-center mt-4">
          <GmailAuthButton
            onSuccess={handleGmailAuth}
            isAuthenticated={isGmailAuthenticated}
          />
        </div>
      </header>

      <main className="w-full bg-white rounded-3xl shadow-xl p-8 md:p-12 mb-8 relative overflow-hidden">
        {/* Connection Status Badge */}
        <div className="absolute top-6 right-6">
          <span className={`px-3 py-1 rounded-full text-xs font-semibold ${status === SessionStatus.CONNECTED ? 'bg-green-100 text-green-700' :
            status === SessionStatus.CONNECTING ? 'bg-yellow-100 text-yellow-700' :
              status === SessionStatus.ERROR ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
            }`}>
            {status}
          </span>
        </div>

        {/* Visualizer and Central Interface */}
        <div className="flex flex-col items-center justify-center space-y-10">
          <div className={`w-48 h-48 rounded-full flex items-center justify-center transition-all duration-500 ${status === SessionStatus.CONNECTED ? 'bg-blue-50 glow-animation scale-110' : 'bg-gray-50'
            }`}>
            <Visualizer isActive={status === SessionStatus.CONNECTED} isSpeaking={isSpeaking} />
          </div>

          <div className="w-full text-center space-y-4">
            {currentInput && (
              <p className="text-sm text-gray-400 italic">You: "{currentInput}"</p>
            )}
            {currentOutput && (
              <p className="text-lg font-medium text-blue-600 leading-relaxed">"{currentOutput}"</p>
            )}
            {!currentOutput && status === SessionStatus.CONNECTED && (
              <p className="text-gray-400">Listening to you...</p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-4 w-full justify-center">
            {status === SessionStatus.IDLE || status === SessionStatus.ERROR ? (
              <button
                onClick={startConnection}
                className="px-10 py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl shadow-lg transition-all hover:scale-105 active:scale-95"
              >
                Start Conversation
              </button>
            ) : (
              <button
                onClick={endConnection}
                className="px-10 py-4 bg-red-500 hover:bg-red-600 text-white font-bold rounded-2xl shadow-lg transition-all hover:scale-105 active:scale-95"
              >
                End Session
              </button>
            )}
          </div>
        </div>
      </main>

      {/* Memory Section */}
      <section className="w-full">
        <div className="flex items-center justify-between mb-4 px-2">
          <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
              <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
            </svg>
            Aura's Notebook
          </h2>
          <span className="text-sm text-gray-400">{memories.length} details stored</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {memories.length > 0 ? (
            [...memories].reverse().slice(0, 4).map((m) => (
              <div key={m.id} className="bg-white/50 backdrop-blur-sm p-4 rounded-2xl border border-gray-100 shadow-sm">
                <p className="text-gray-700 text-sm leading-relaxed mb-2">"{m.content}"</p>
                <span className="text-[10px] text-gray-400 uppercase tracking-widest">
                  {new Date(m.timestamp).toLocaleDateString()} at {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            ))
          ) : (
            <div className="col-span-full py-12 bg-white/30 rounded-3xl border border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400">
              <p>Tell Aura something about yourself to start her memory notebook.</p>
              <p className="text-xs mt-1">(e.g., "I love green tea" or "My birthday is June 5th")</p>
            </div>
          )}
        </div>
      </section>

      {status === SessionStatus.ERROR && (
        <div className="mt-8 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-center">
          Something went wrong with the connection. Please refresh or check your API key.
        </div>
      )}

      <footer className="mt-auto pt-12 text-center text-gray-400 text-sm">
        Built with Gemini Live API &bull; Powered by AI
      </footer>
    </div>
  );
};

export default App;
