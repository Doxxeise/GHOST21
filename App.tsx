import React, { useState, useEffect, useRef } from 'react';
import {
  Send, User, Ghost, LogOut, Sparkles, AlertCircle, RefreshCw, Reply, X, EyeOff
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth, signInAnonymously, onAuthStateChanged, signOut, User as FirebaseUser
} from 'firebase/auth';
import {
  getDatabase, ref, push, onValue, query,
  orderByChild, limitToLast, serverTimestamp, onChildAdded, set, remove
} from 'firebase/database';

// --- FIREBASE CONFIGURATION ---
const firebaseConfig = {
  apiKey: "AIzaSyABZ0cV_uVNRUyEBb6d8XiAyepEritY7Uk",
  authDomain: "ghost-d48ab.firebaseapp.com",
  databaseURL: "https://ghost-d48ab-default-rtdb.firebaseio.com",
  projectId: "ghost-d48ab",
  storageBucket: "ghost-d48ab.firebasestorage.app",
  messagingSenderId: "571108471028",
  appId: "1:571108471028:web:d9e1d78cb4828081a22ea1",
  measurementId: "G-JGSHZWL4WZ"
};

const appId = "ghost-d48ab";
const sanitizedAppId = appId.replace(/[.#$[\]]/g, '_');

// Singleton Init
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const db = getDatabase(app);

// --- TYPES ---
interface UserProfile {
  name: string;
  color: string;
  id: string;
}

interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName: string;
  senderColor: string;
  timestamp: any;
  replyTo?: {
    id: string;
    senderName: string;
    text: string;
  };
  isPoltergeist?: boolean;
}

// ==========================================
// === ANIMATED EMOJI LIBRARY (START) ===
// ==========================================

const LIBRARY_EMOJIS = ["👻", "🔥", "💜", "💀", "👁️", "✨", "🌑"];

interface FloatingEmoji {
  id: string;
  emoji: string;
  left: number;      // 0-100%
  size: number;      // rem
  duration: number;  // seconds
  delay: number;     // seconds
  wobble: number;    // px offset
}

/**
 * Hook: Handles sending reactions to DB and listening for new reactions to animate.
 */
const useEmojiLibrary = (user: FirebaseUser | null) => {
  const [floatingEmojis, setFloatingEmojis] = useState<FloatingEmoji[]>([]);

  useEffect(() => {
    if (!user) return;

    // Listen for new reactions added to the node
    // Increased limit to catch rapid-fire reactions
    const reactionsRef = query(
      ref(db, `artifacts/${sanitizedAppId}/public/data/reactions`),
      limitToLast(10)
    );

    const unsubscribe = onChildAdded(reactionsRef, (snapshot) => {
      const val = snapshot.val();
      if (!val || !val.timestamp) return;

      // Only animate if the reaction happened recently (prevents flood on page load)
      // Using 10s window to be safe with client timestamps
      const isRecent = Date.now() - val.timestamp < 10000;

      if (isRecent) {
        const newEmoji: FloatingEmoji = {
          id: Math.random().toString(36).substr(2, 9),
          emoji: val.emoji,
          left: Math.random() * 80 + 10,       // Random position 10% - 90%
          size: Math.random() * 1.5 + 1.5,     // Random size 1.5rem - 3rem
          duration: Math.random() * 2 + 3,     // Random duration 3s - 5s
          delay: 0,
          wobble: Math.random() * 40 - 20      // Random horizontal drift
        };

        setFloatingEmojis(prev => [...prev, newEmoji]);

        // Cleanup after animation finishes
        setTimeout(() => {
          setFloatingEmojis(prev => prev.filter(e => e.id !== newEmoji.id));
        }, (newEmoji.duration + 1) * 1000);
      }
    });

    return () => unsubscribe();
  }, [user]);

  const triggerReaction = (emoji: string) => {
    if (!user) return;
    // Using Date.now() instead of serverTimestamp() ensures immediate local execution validity
    push(ref(db, `artifacts/${sanitizedAppId}/public/data/reactions`), {
      emoji,
      senderId: user.uid,
      timestamp: Date.now()
    }).catch(err => console.error("Reaction failed", err));
  };

  return { floatingEmojis, triggerReaction };
};

/**
 * Hook: Manages Global Poltergeist Mode
 */
/**
 * Hook: Manages Local Poltergeist Mode (Sender preference)
 */
const usePoltergeistMode = () => {
  const [enabled, setEnabled] = useState(false);
  const toggleMode = () => setEnabled(prev => !prev);
  return { enabled, toggleMode };
};

/**
 * Component: Renders the layer of floating emojis.
 */
const EmojiOverlay = ({ emojis }: { emojis: FloatingEmoji[] }) => {
  return (
    <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
      <style>{`
        @keyframes libraryFloatUp {
          0% { opacity: 0; transform: translateY(0) scale(0.5); }
          10% { opacity: 1; transform: translateY(-50px) scale(1.1); }
          50% { transform: translateY(-40vh) scale(1) translateX(var(--wobble)); }
          100% { opacity: 0; transform: translateY(-80vh) scale(0.8) translateX(calc(var(--wobble) * -1)); }
        }
      `}</style>
      {emojis.map(e => (
        <div
          key={e.id}
          className="absolute bottom-20 transition-transform will-change-transform"
          style={{
            left: `${e.left}%`,
            fontSize: `${e.size}rem`,
            animation: `libraryFloatUp ${e.duration}s ease-out forwards`,
            // @ts-ignore
            '--wobble': `${e.wobble}px`
          }}
        >
          {e.emoji}
        </div>
      ))}
    </div>
  );
};

/**
 * Component: The button dock for triggering reactions.
 */
const EmojiDock = ({ onReact }: { onReact: (emoji: string) => void }) => {
  return (
    <div className="flex items-center justify-center gap-1 mb-2 animate-slide-up">
      {LIBRARY_EMOJIS.map(emoji => (
        <button
          key={emoji}
          onClick={() => onReact(emoji)}
          className="group relative p-2 rounded-xl hover:bg-white/5 transition-all duration-200 active:scale-95"
        >
          <span className="text-xl filter drop-shadow-md group-hover:scale-110 transition-transform block">{emoji}</span>
        </button>
      ))}
    </div>
  );
};

// ==========================================
// === ANIMATED EMOJI LIBRARY (END) ===
// ==========================================


// --- ASSETS & HELPERS ---
const AVATAR_COLORS = [
  "from-pink-500 to-rose-600 shadow-pink-500/20",
  "from-violet-500 to-purple-600 shadow-purple-500/20",
  "from-cyan-400 to-blue-600 shadow-cyan-500/20",
  "from-emerald-400 to-teal-600 shadow-emerald-500/20",
  "from-orange-400 to-red-600 shadow-orange-500/20",
  "from-fuchsia-500 to-pink-600 shadow-fuchsia-500/20"
];

const GHOST_NAMES = [
  "NeonPhantom", "CyberSoul", "MidnightWalker", "VoidEcho",
  "ShadowDancer", "GlitchWraith", "DigitalSpectre", "NebulaDrifter"
];

const getRandomName = () => GHOST_NAMES[Math.floor(Math.random() * GHOST_NAMES.length)];
const getRandomColor = () => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

// --- VISUAL EFFECTS ---
const SpiritDust = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let animationId: number;
    const particles: any[] = [];
    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', resize);
    resize();
    for (let i = 0; i < 60; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.5 + 0.1,
        phase: Math.random() * Math.PI * 2,
        speed: 0.01 + Math.random() * 0.02
      });
    }
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        p.x += p.vx; p.y += p.vy; p.phase += p.speed;
        if (p.x < 0) p.x = canvas.width; if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height; if (p.y > canvas.height) p.y = 0;
        const currentAlpha = p.alpha + Math.sin(p.phase) * 0.15;
        ctx.fillStyle = `rgba(167, 139, 250, ${Math.max(0, currentAlpha)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      });
      animationId = requestAnimationFrame(animate);
    };
    animate();
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(animationId); };
  }, []);
  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0 mix-blend-screen" />;
};

export default function GhostChat() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>({ name: '', color: '', id: '' });
  const [view, setView] = useState('LOGIN');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { enabled: poltergeistMode, toggleMode: togglePoltergeist } = usePoltergeistMode();

  // Initialize Emoji Library
  const { floatingEmojis, triggerReaction } = useEmojiLibrary(user);

  // Auth Initialization
  useEffect(() => {
    const initAuth = async () => {
      if (!auth.currentUser) {
        try {
          await signInAnonymously(auth);
        } catch (err: any) {
          if (err.code === 'auth/admin-restricted-operation') {
            setAuthError("Configuration Missing: Enable 'Anonymous' in Firebase Console.");
          } else {
            setAuthError(`Connection Error: ${err.message}`);
          }
        }
      }
    };
    initAuth();

    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        setAuthError(null);
        const saved = localStorage.getItem('ghost_profile');
        if (saved) {
          setProfile(JSON.parse(saved));
          setView('CHAT');
        }
      } else {
        setUser(null);
        setView('LOGIN');
      }
    });
    return () => unsubscribe();
  }, []);

  // Messages Listener
  useEffect(() => {
    if (!user || view !== 'CHAT') return;

    const messagesRef = query(
      ref(db, `artifacts/${sanitizedAppId}/public/data/ghost_messages`),
      orderByChild('timestamp'),
      limitToLast(50)
    );

    const unsubscribe = onValue(messagesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const msgs = Object.entries(data).map(([id, val]) => ({ id, ...val as any }));
        msgs.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        setMessages(msgs as Message[]);
      } else {
        setMessages([]);
      }
      scrollToBottom();
    }, (err) => {
      showNotification("Disconnected from the void.");
    });

    return () => unsubscribe();
  }, [user, view]);

  useEffect(() => {
    if (replyingTo && inputRef.current) {
      inputRef.current.focus();
    }
  }, [replyingTo]);

  const scrollToBottom = () => {
    setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, 100);
  };

  const handleLogin = (name: string, color: string) => {
    if (!user) return;
    const newProfile = { name: name || getRandomName(), color: color || getRandomColor(), id: user.uid };
    setProfile(newProfile);
    localStorage.setItem('ghost_profile', JSON.stringify(newProfile));
    setView('CHAT');
  };

  const handleLogout = () => {
    localStorage.removeItem('ghost_profile');
    signOut(auth);
    setView('LOGIN');
    setProfile({ name: '', color: '', id: '' });
  };

  const postMessage = async (text: string) => {
    if (!text.trim() || !user) return;
    try {
      const messagesListRef = ref(db, `artifacts/${sanitizedAppId}/public/data/ghost_messages`);
      const payload: any = {
        text: text,
        senderId: user.uid,
        senderName: profile.name,
        senderColor: profile.color,
        isPoltergeist: poltergeistMode,
        timestamp: serverTimestamp()
      };

      if (replyingTo) {
        payload.replyTo = {
          id: replyingTo.id,
          senderName: replyingTo.senderName,
          text: replyingTo.text
        };
      }

      await push(messagesListRef, payload);
      setReplyingTo(null);
      scrollToBottom();
    } catch (err) {
      showNotification("Failed to broadcast.");
    }
  };

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;
    await postMessage(inputText);
    setInputText('');
  };

  const handleReaction = (emoji: string) => {
    triggerReaction(emoji);
    postMessage(emoji);
  };

  useEffect(() => {
    if (!user) return;
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      messages.forEach(msg => {
        if (msg.senderId === user.uid && msg.isPoltergeist) {
          const timeSince = now - (msg.timestamp || now);
          if (timeSince > 30500) { // Slight buffer over 30s to allow fade animation to finish on clients
            remove(ref(db, `artifacts/${sanitizedAppId}/public/data/ghost_messages/${msg.id}`))
              .catch(err => console.error("Cleanup failed", err));
          }
        }
      });
    }, 5000);
    return () => clearInterval(cleanupInterval);
  }, [user, messages]);

  const showNotification = (msg: string) => {
    setNotification(msg);
    setTimeout(() => setNotification(null), 4000);
  };

  const retryAuth = async () => {
    setAuthError(null);
    try { await signInAnonymously(auth); }
    catch (err: any) {
      if (err.code === 'auth/admin-restricted-operation') {
        setAuthError("Configuration Missing: Enable 'Anonymous' in Firebase Console.");
      } else {
        setAuthError(err.message);
      }
    }
  };

  if (view === 'LOGIN') {
    return <LoginScreen onJoin={handleLogin} isAuthReady={!!user} authError={authError} onRetry={retryAuth} />;
  }

  return (
    <div className="flex flex-col h-screen w-full bg-[#050505] text-slate-200 font-sans overflow-hidden relative selection:bg-purple-500/30">

      {/* Background Visuals */}
      <SpiritDust />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,_rgba(24,24,27,0)_0%,_rgba(0,0,0,0.8)_100%)] z-0 pointer-events-none" />
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.02] z-0 mix-blend-overlay" />

      {/* Global CSS for Animations */}
      <style>{`
        @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }
        .animate-float { animation: float 6s ease-in-out infinite; }
        
        @keyframes pulse-glow { 0%, 100% { opacity: 0.5; box-shadow: 0 0 15px rgba(167, 139, 250, 0.1); } 50% { opacity: 1; box-shadow: 0 0 25px rgba(167, 139, 250, 0.3); } }
        .animate-status { animation: pulse-glow 3s infinite; }

        @keyframes glitch { 0% { transform: translate(0) } 20% { transform: translate(-1px, 1px) } 40% { transform: translate(-1px, -1px) } 60% { transform: translate(1px, 1px) } 80% { transform: translate(1px, -1px) } 100% { transform: translate(0) } }
        .glitch-hover:hover { animation: glitch 0.2s cubic-bezier(.25, .46, .45, .94) both infinite; color: #d8b4fe; text-shadow: 2px 2px #4c1d95; }
        
        @keyframes messageEnter { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .animate-enter { animation: messageEnter 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards; }

        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        .animate-slide-up { animation: slideUp 0.6s ease-out forwards; }

        @keyframes fadeOut { from { opacity: 1; filter: blur(0px); } to { opacity: 0; filter: blur(4px); } }
      `}</style>

      {/* Render the Library's Emoji Layer */}
      <EmojiOverlay emojis={floatingEmojis} />

      {/* Notifications */}
      {notification && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 animate-enter">
          <div className="bg-slate-900/80 backdrop-blur-md border border-purple-500/30 px-6 py-2 rounded-full shadow-[0_0_30px_rgba(168,85,247,0.2)] flex items-center gap-2">
            <Sparkles size={14} className="text-purple-400" />
            <span className="text-xs font-medium text-purple-100 tracking-wide">{notification}</span>
          </div>
        </div>
      )}

      <header className="relative z-20 h-16 border-b border-white/5 bg-black/20 backdrop-blur-2xl flex items-center justify-between px-6 shadow-2xl">
        <div className="flex items-center gap-3 group cursor-default">
          <div className="p-2 animate-float">
            <img src="/logo.png" alt="GhostChat Logo" className="w-[32px] h-[32px] drop-shadow-[0_0_10px_rgba(167,139,250,0.5)]" />
          </div>
          <div>
            <h1 className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 tracking-tight leading-none glitch-hover transition-all cursor-pointer">GhostChat</h1>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981] animate-status"></span>
              <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-widest">Live Channel</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 hover:border-white/10 transition-all cursor-default">
            <div className={`w-2 h-2 rounded-full bg-gradient-to-r ${profile.color} shadow-lg`}></div>
            <span className="text-xs font-bold text-slate-300 tracking-wide">{profile.name}</span>
          </div>

          <button
            onClick={togglePoltergeist}
            className={`p-2.5 rounded-xl transition-all duration-300 ${poltergeistMode ? 'bg-red-500/10 text-red-400 shadow-[0_0_15px_rgba(248,113,113,0.3)]' : 'text-slate-500 hover:text-white hover:bg-white/10'}`}
            title={poltergeistMode ? "Disable Poltergeist Mode" : "Enable Poltergeist Mode"}
          >
            {poltergeistMode ? <EyeOff size={18} /> : <Ghost size={18} />}
          </button>

          <button
            onClick={handleLogout}
            className="p-2.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all duration-300 hover:rotate-90 active:scale-90"
            title="Disconnect"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className="relative z-10 flex-1 overflow-y-auto p-4 md:p-6 space-y-6 scrollbar-thin scrollbar-thumb-white/5 scrollbar-track-transparent">
        {/* Welcome Banner */}
        <div className="flex justify-center py-6 animate-slide-up">
          <div className="group relative flex items-center gap-2 px-5 py-1.5 rounded-full bg-white/5 border border-white/5 backdrop-blur-md transition-all duration-500 hover:bg-white/10 hover:border-white/10 cursor-help">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 group-hover:scale-125 transition-all"></div>
            <span className="text-[10px] font-medium text-slate-500 uppercase tracking-[0.2em] group-hover:text-slate-300 transition-colors">
              Encrypted Frequency
            </span>
          </div>
        </div>

        {messages.map((msg, idx) => {
          const isMe = user ? msg.senderId === user.uid : false;
          const showHeader = idx === 0 || messages[idx - 1].senderId !== msg.senderId;

          const timeSince = Date.now() - (msg.timestamp || Date.now());
          const fadeDuration = 5000; // 5 seconds
          const lifeTime = 30000; // 30 seconds total life
          const fadeStart = lifeTime - fadeDuration; // 29 seconds

          const shouldFade = msg.isPoltergeist && timeSince < lifeTime;
          const isGone = msg.isPoltergeist && timeSince >= lifeTime;

          if (isGone) return null;

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} group animate-enter`}
              style={shouldFade ? {
                animation: `messageEnter 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards, fadeOut ${fadeDuration}ms ease-out forwards`,
                animationDelay: `0s, ${Math.max(0, fadeStart - timeSince)}ms`
              } : {}}
            >
              {showHeader && (
                <div className={`flex items-center gap-2 mb-1.5 opacity-60 ${isMe ? 'flex-row-reverse' : 'flex-row'} transition-opacity group-hover:opacity-100`}>
                  <span className={`text-[10px] font-bold tracking-wide ${isMe ? 'text-indigo-300' : 'text-slate-400'}`}>{msg.senderName}</span>
                </div>
              )}
              <div
                className={`max-w-[85%] md:max-w-[65%] px-5 py-3.5 rounded-[1.2rem] text-sm leading-relaxed relative transition-all duration-300 
                  ${isMe
                    ? `bg-gradient-to-br from-indigo-600/90 to-violet-700/90 text-white rounded-tr-sm shadow-[0_4px_15px_rgba(79,70,229,0.3)]`
                    : 'bg-white/5 backdrop-blur-md border border-white/5 text-slate-200 rounded-tl-sm hover:bg-white/10 shadow-lg'
                  }
                `}
              >
                {/* Reply Context in Message */}
                {msg.replyTo && (
                  <div className={`mb-2 pb-2 border-b border-white/10 text-[11px] ${isMe ? 'text-indigo-200/70' : 'text-slate-400'}`}>
                    <div className="flex items-center gap-1 font-bold mb-0.5 opacity-80">
                      <Reply size={10} className="scale-x-[-1]" />
                      {msg.replyTo.senderName}
                    </div>
                    <div className="truncate opacity-60 italic">"{msg.replyTo.text}"</div>
                  </div>
                )}

                {msg.text}

                {/* Reply Button */}
                <button
                  onClick={() => setReplyingTo(msg)}
                  className={`absolute top-1/2 -translate-y-1/2 ${isMe ? '-left-10' : '-right-10'} p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 opacity-0 group-hover:opacity-100 transition-all duration-300 hover:text-white`}
                  title="Reply"
                >
                  <Reply size={14} className="scale-x-[-1]" />
                </button>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </main>

      {/* Input Dock */}
      <footer className="relative z-20 p-4 pt-0">

        {/* Emoji Library Dock */}
        <EmojiDock onReact={handleReaction} />

        {/* Reply Preview Banner */}
        {replyingTo && (
          <div className="flex items-center justify-between bg-indigo-900/30 border border-white/10 border-b-0 rounded-t-2xl px-5 py-2 mx-2 -mb-2 z-0 backdrop-blur-xl animate-slide-up">
            <div className="flex items-center gap-3 text-xs text-slate-300 overflow-hidden">
              <Reply size={14} className="scale-x-[-1] text-indigo-400 shrink-0" />
              <div className="flex flex-col">
                <span className="font-bold text-indigo-300">Replying to {replyingTo.senderName}</span>
                <span className="opacity-60 truncate max-w-[200px] md:max-w-md italic">"{replyingTo.text}"</span>
              </div>
            </div>
            <button onClick={() => setReplyingTo(null)} className="p-1.5 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors">
              <X size={14} />
            </button>
          </div>
        )}

        <div className={`
          relative bg-black/40 backdrop-blur-3xl border border-white/10 transition-all duration-500 rounded-3xl p-1.5 flex items-end gap-2 shadow-2xl focus-within:border-white/20 z-10
        `}>

          {/* Text Area */}
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Broadcast a message..."
              className={`w-full bg-transparent text-white text-base px-4 py-3.5 focus:outline-none resize-none min-h-[50px] max-h-[120px] scrollbar-hide rounded-xl transition-colors placeholder:text-slate-600`}
              rows={1}
            />
          </div>

          {/* Send Button */}
          <button
            type="submit"
            onClick={sendMessage}
            disabled={!inputText.trim()}
            className={`p-3.5 mb-1 rounded-[1rem] shadow-lg transition-all transform active:scale-95 disabled:opacity-50 disabled:scale-100 bg-white text-black hover:bg-slate-200`}
          >
            <Send size={18} className="ml-0.5" strokeWidth={2.5} />
          </button>
        </div>
      </footer>
    </div>
  );
}

function LoginScreen({ onJoin, isAuthReady, authError, onRetry }: { onJoin: (name: string, color: string) => void, isAuthReady: boolean, authError: string | null, onRetry: () => void }) {
  const [name, setName] = useState('');
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[0]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#030304] relative overflow-hidden p-6 font-sans selection:bg-indigo-500/30 selection:text-white">
      <SpiritDust />
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-purple-900/20 rounded-full blur-[150px] animate-pulse" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-indigo-900/20 rounded-full blur-[150px] animate-pulse" />

      <div className="w-full max-w-sm bg-white/5 backdrop-blur-3xl border border-white/10 rounded-[2rem] p-8 shadow-2xl relative z-10 animate-slide-up ring-1 ring-white/5">
        <style>{`
          @keyframes float { 0%, 100% { transform: translateY(0px); } 50% { transform: translateY(-6px); } }
          .animate-float { animation: float 6s ease-in-out infinite; }
          @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
          .animate-slide-up { animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        `}</style>

        <div className="text-center mb-10">
          <div className="w-24 h-24 flex items-center justify-center mx-auto mb-6 animate-float">
            <img src="/logo.png" alt="GhostChat Logo" className="w-[80px] h-[80px] drop-shadow-[0_0_25px_rgba(167,139,250,0.6)]" />
          </div>
          <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">GhostChat</h1>
          <p className="text-slate-400 text-sm font-medium tracking-wide">Enter the void. Leave no trace.</p>
        </div>

        <div className="space-y-8">
          {authError && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-300 p-4 rounded-2xl flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2"><AlertCircle size={16} className="shrink-0" /><p className="font-bold">Access Denied</p></div>
              <p className="text-xs opacity-80 leading-relaxed">{authError}</p>
              <button onClick={onRetry} className="flex items-center gap-2 mt-2 text-xs font-bold text-white bg-red-500/20 hover:bg-red-500/30 py-2.5 px-4 rounded-xl transition self-start"><RefreshCw size={12} /> Retry Connection</button>
            </div>
          )}

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-3 ml-2">Identify Yourself</label>
            <div className="relative group">
              <User className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" size={20} />
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={getRandomName()}
                className="w-full bg-black/40 border border-white/10 rounded-2xl py-4 pl-14 pr-4 text-white text-base placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-4 focus:ring-indigo-500/10 transition-all hover:bg-black/50 hover:border-white/20"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4 ml-2">Aura Color</label>
            <div className="grid grid-cols-6 gap-2">
              {AVATAR_COLORS.map((color) => (
                <button key={color} onClick={() => setSelectedColor(color)} className={`w-full aspect-square rounded-xl bg-gradient-to-br ${color} transition-all duration-300 ${selectedColor === color ? 'ring-2 ring-white scale-110 shadow-lg' : 'opacity-40 hover:opacity-100 hover:scale-105 grayscale hover:grayscale-0'}`} />
              ))}
            </div>
          </div>

          <button
            onClick={() => onJoin(name, selectedColor)}
            disabled={!isAuthReady}
            className={`w-full py-4 rounded-2xl font-bold text-lg shadow-xl shadow-indigo-900/20 transition-all transform 
              ${isAuthReady
                ? 'bg-white text-black hover:bg-slate-100 hover:scale-[1.02] active:scale-[0.98]'
                : 'bg-white/10 text-slate-500 cursor-not-allowed'}`}
          >
            {isAuthReady ? "Connect to Channel" : "Initializing..."}
          </button>
        </div>

        <div className="mt-8 text-center"><p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest hover:text-slate-400 transition-colors cursor-default">End-to-End Encrypted</p></div>
      </div>
    </div>
  );
}