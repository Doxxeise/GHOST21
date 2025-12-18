import React, { useState, useEffect, useRef } from 'react';
import {
  Send, User, Ghost, LogOut, Sparkles, AlertCircle, RefreshCw, Reply, X, EyeOff, Image as ImageIcon, Trash2, ShieldAlert, HelpCircle
} from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth, signInAnonymously, onAuthStateChanged, signOut, User as FirebaseUser
} from 'firebase/auth';
import {
  getDatabase, ref, push, onValue, query,
  orderByChild, limitToLast, serverTimestamp, onChildAdded, set, remove, runTransaction
} from 'firebase/database';

import { askOracle } from './utils/gemini';

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
    startImage?: string;
  };
  isPoltergeist?: boolean;
  startImage?: string;
  poll?: {
    question: string;
    options: Record<string, number>;
    deadline: number;
    resolved: boolean;
    type: 'kick' | 'standard';
    target?: string;
  };
  reactions?: Record<string, Record<string, boolean>>; // emoji -> { userId: true }
  game?: {
    type: 'DICE' | 'COIN' | 'TOD';
    result: string;
  };
}

interface Invitation {
  senderId: string;
  senderName: string;
  senderColor: string;
  roomId: string;
  timestamp: number;
}

interface PrivateRoom {
  id: string;
  partnerName: string;
  partnerColor: string;
}

const compressImage = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

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

const renderMessageText = (text: string) => {
  if (!text) return "";
  // Split by @followed by non-whitespace/punctuation
  const parts = text.split(/(@[^\s\.,!?;:()\[\]{}'"]+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      return (
        <span key={i} className="px-1.5 py-0.5 rounded-md bg-white/20 text-white font-black border border-white/20 animate-pulse-subtle shadow-[0_0_10px_rgba(255,255,255,0.2)] mx-0.5 italic">
          {part}
        </span>
      );
    }
    return part;
  });
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

// ==========================================
// === SECRET ANIMATIONS (START) ===
// ==========================================

// Sound Engine (Silenced)
const useSoundEffects = () => {
  return {
    playPing: () => { },
    playWarp: () => { },
    playSecret: () => { }
  };
};

// Typing Presence Hook
const useTypingPresence = (user: UserProfile | null, roomId: string | null) => {
  const [typingUsers, setTypingUsers] = useState<{ id: string, name: string }[]>([]);

  // Listen for others typing
  useEffect(() => {
    const path = roomId
      ? `artifacts/${sanitizedAppId}/public/data/typing/${roomId}`
      : `artifacts/${sanitizedAppId}/public/data/typing/public`;

    const typingRef = ref(db, path);
    const unsubscribe = onValue(typingRef, (snap) => {
      const data = snap.val() || {};
      const activeTypers = Object.entries(data)
        .filter(([id, val]: [string, any]) => val.timestamp > Date.now() - 3000)
        .map(([id, val]: [string, any]) => ({ id, name: val.name }));
      setTypingUsers(activeTypers);
    });
    return () => unsubscribe();
  }, [roomId, user]);
  // Update my typing status
  const updateTyping = async (isTyping: boolean) => {
    if (!user) return;
    const path = roomId
      ? `artifacts/${sanitizedAppId}/public/data/typing/${roomId}/${user.id}`
      : `artifacts/${sanitizedAppId}/public/data/typing/public/${user.id}`;

    if (isTyping) {
      await set(ref(db, path), { name: user.name, timestamp: Date.now() });
    } else {
      await remove(ref(db, path));
    }
  };

  return { typingUsers, updateTyping };
};

const useKonamiCode = () => {
  const [isMatrix, setIsMatrix] = useState(false);
  const sequence = useRef<string[]>([]);
  const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      sequence.current = [...sequence.current, e.key].slice(-10);
      if (JSON.stringify(sequence.current) === JSON.stringify(KONAMI)) {
        setIsMatrix(prev => !prev);
        sequence.current = [];
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  return isMatrix;
};

const useKeywordTriggers = (inputText: string) => {
  const [effect, setEffect] = useState<string | null>(null);

  const checkTriggers = (textInput: string) => {
    const text = textInput.toLowerCase().trim();

    // Clear effects if input is empty
    if (!text) {
      setEffect(null);
      return;
    }

    // NSFW / Glitch trigger
    const NSFW_WORDS = ['boobs', 'breast', 'dick', 'suck', 'fuck', 'fine', 'fine shii', 'ugly'];
    if (NSFW_WORDS.some(w => text.includes(w))) {
      setEffect('glitch');
      setTimeout(() => setEffect(null), 500);
      return;
    }

    // Priority Check: Transient Effects (Those with timers)
    // We only trigger these if the effect isn't already active to avoid loops
    if (text.includes('boom')) {
      setEffect('boom'); setTimeout(() => setEffect(null), 500);
    } else if (text.includes('void')) {
      setEffect('void'); setTimeout(() => setEffect(null), 2000);
    } else if (text.includes('spin')) {
      setEffect('spin'); setTimeout(() => setEffect(null), 1000);
    } else if (text.includes('glitch')) {
      setEffect('glitch'); setTimeout(() => setEffect(null), 500);
    } else if (text.includes('crush') || text.includes('love')) {
      setEffect('heartbeat'); setTimeout(() => setEffect(null), 3000);
    } else if (text.includes('secret')) {
      setEffect('secret-blur'); setTimeout(() => setEffect(null), 2000);
    } else if (text.includes('67')) {
      setEffect('wiggle'); setTimeout(() => setEffect(null), 1000);
    } else if (text.includes('fly')) {
      setEffect('ascend'); setTimeout(() => setEffect(null), 3000);
    } else if (text.includes('christmas')) {
      setEffect('christmas'); setTimeout(() => setEffect(null), 10000);
    } else if (text.includes('incourse')) {
      setEffect('incourse'); setTimeout(() => setEffect(null), 5000);
    } else if (text.includes('pharmacy')) {
      setEffect('pharmacy'); setTimeout(() => setEffect(null), 3000);
    }
    // Persistent Effects (Stay as long as keyword is present)
    else if (text.includes('party')) {
      setEffect('party');
    } else if (text.includes('gravity')) {
      setEffect('gravity');
    } else if (text.includes('retro')) {
      setEffect('retro');
    } else {
      // Clear persistent effects if no longer matching
      setEffect(prev => (['party', 'gravity', 'retro'].includes(prev || '') ? null : prev));
    }
  };

  useEffect(() => {
    checkTriggers(inputText);
  }, [inputText]);

  return { effect, checkTriggers };
};

const FloatingHearts = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none z-[50]">
    {[...Array(10)].map((_, i) => (
      <div key={i} className="absolute text-pink-500 animate-float-up"
        style={{
          left: `${Math.random() * 100}%`,
          bottom: '-10%',
          fontSize: `${Math.random() * 20 + 20}px`,
          animationDelay: `${Math.random() * 2}s`,
          animationDuration: `${Math.random() * 2 + 3}s`
        }}>
        ♥
      </div>
    ))}
  </div>
);

const MatrixRain = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*";
    const fontSize = 14;
    const columns = canvas.width / fontSize;
    const drops: number[] = new Array(Math.ceil(columns)).fill(1);

    const draw = () => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#0F0";
      ctx.font = fontSize + "px monospace";
      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };
    const interval = setInterval(draw, 33);
    return () => clearInterval(interval);
  }, []);
  return <canvas ref={canvasRef} className="absolute inset-0 z-[5] pointer-events-none opacity-50 mix-blend-screen" />;
};

const SnowFall = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none z-[50]">
    {[...Array(30)].map((_, i) => (
      <div key={i} className="absolute text-white/80 animate-snow"
        style={{
          left: `${Math.random() * 100}%`,
          top: '-5%',
          fontSize: `${Math.random() * 10 + 10}px`,
          animationDelay: `${Math.random() * 5}s`,
          animationDuration: `${Math.random() * 5 + 5}s`
        }}>
        {Math.random() > 0.5 ? '❄' : '❅'}
      </div>
    ))}
  </div>
);

const StressEffects = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none z-[50]">
    {[...Array(15)].map((_, i) => (
      <div key={i} className="absolute text-orange-500/60 font-mono font-bold animate-stress text-[1.5rem]"
        style={{
          left: `${Math.random() * 100}%`,
          top: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 2}s`
        }}>
        {['📚', '⚡', '404', 'FAIL', 'DEADLINE', 'STRESS'][Math.floor(Math.random() * 6)]}
      </div>
    ))}
  </div>
);

const PharmacyGlitch = () => (
  <div className="absolute inset-0 z-[1000] pointer-events-none flex items-center justify-center overflow-hidden">
    <div className="absolute inset-0 bg-red-900/40 mix-blend-color-burn animate-glitch-ui" />
    <div className="flex flex-col items-center">
      <ShieldAlert size={120} className="text-red-600 animate-pulse mb-4" />
      <h2 className="text-6xl font-black text-red-600 tracking-tighter uppercase italic drop-shadow-[0_0_20px_rgba(220,38,38,1)] animate-shake">
        SYSTEM HATE
      </h2>
      <div className="mt-4 text-[10px] font-mono text-red-400 bg-black/80 px-4 py-1 border border-red-500/50">
        PHARMACY FREQUENCY DETECTED // CORRUPTION 99%
      </div>
    </div>
  </div>
);



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
const SpiritDust = ({ intensity = 0 }: { intensity?: number }) => {
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
      const speedMultiplier = 1 + (intensity * 5); // Speed up with intensity

      particles.forEach(p => {
        p.x += p.vx * speedMultiplier;
        p.y += p.vy * speedMultiplier;
        p.phase += p.speed * speedMultiplier;

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
  }, [intensity]);
  return <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none z-0 mix-blend-screen" />;
};

// --- HELP MODAL ---
const HelpModal = ({ onClose }: { onClose: () => void }) => {
  const features = [
    {
      title: "🔮 The Oracle & Games",
      desc: "An AI spirit that moderates your void. It can answer questions, create polls, and run games like 'Truth or Dare' by tagging players.",
      commands: ["@oracle What is the meaning of life?", "@oracle flip a coin", "@oracle roll a dice", "@oracle play Truth or Dare"],
      icon: <Sparkles size={16} />
    },
    {
      title: "👻 Poltergeist Mode",
      desc: "Messages that fade away and disappear into the void after 45 seconds. Perfect for secrets.",
      icon: <Ghost size={16} />
    },
    {
      title: "🧬 Neural Links (Private Chat)",
      desc: "Click a user's name to invite them to a private, encrypted neural link. Everything is ephemeral.",
      icon: <User size={16} />
    },
    {
      title: "🖼️ Glitched Visuals",
      desc: "Upload images to apply a digital glitch effect. Large images are automatically compressed for speed.",
      icon: <ImageIcon size={16} />
    },
    {
      title: "✨ Secret Keywords",
      desc: "Some words trigger environmental effects. Try typing things like 'matrix', 'heart', 'party', 'christmas', 'incourse', or 'pharmacy' (bad vibe).",
      icon: <Sparkles size={16} />
    }
  ];

  return (
    <div className="absolute inset-0 z-[300] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-6 animate-enter">
      <div className="bg-slate-900 border border-indigo-500/30 p-8 rounded-3xl max-w-2xl w-full shadow-[0_0_50px_rgba(79,70,229,0.2)] max-h-[85vh] overflow-y-auto scrollbar-thin scrollbar-thumb-indigo-500/20">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3 text-indigo-400">
            <HelpCircle size={32} />
            <h2 className="text-2xl font-bold tracking-widest uppercase">System Manual</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-slate-500 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="space-y-6">
          {features.map((f, i) => (
            <div key={i} className="group p-4 rounded-2xl bg-white/5 border border-white/5 hover:border-indigo-500/20 transition-all">
              <div className="flex items-center gap-3 mb-2 text-indigo-300">
                {f.icon}
                <h3 className="font-bold tracking-wide">{f.title}</h3>
              </div>
              <p className="text-sm text-slate-400 leading-relaxed mb-3">{f.desc}</p>
              {f.commands && (
                <div className="flex flex-wrap gap-2">
                  {f.commands.map((c, j) => (
                    <code key={j} className="text-[10px] bg-black/40 px-2 py-1 rounded-md text-slate-500 border border-white/5 font-mono">
                      {c}
                    </code>
                  ))}
                </div>
              )}
            </div>
          ))}

          <div className="mt-8 p-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20">
            <h3 className="text-xs font-bold text-indigo-300 uppercase tracking-widest mb-2">How to Use</h3>
            <ul className="text-xs text-slate-400 space-y-2 list-disc pl-4">
              <li>Login with a ghost name and color.</li>
              <li>Type in the public void to broadcast to all ghosts.</li>
              <li>Toggle the <Ghost className="inline mx-1" size={12} /> icon to enter Poltergeist Mode.</li>
              <li>Interact with The Oracle by mentioning it or replying to it.</li>
            </ul>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-8 py-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl font-bold uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/20"
        >
          Return to Void
        </button>
      </div>
    </div>
  );
};

export default function GhostChat() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>({ name: '', color: '', id: '' });
  const [originalProfile, setOriginalProfile] = useState<UserProfile | null>(null); // For masking
  const [view, setView] = useState('LOGIN');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  (window as any).setShowHelp = setShowHelp;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [serverTimeOffset, setServerTimeOffset] = useState(0);
  const [showAdmin, setShowAdmin] = useState(false);
  const { enabled: poltergeistMode, toggleMode: togglePoltergeist } = usePoltergeistMode();

  // Private Messaging State
  const [currentRoom, setCurrentRoom] = useState<PrivateRoom | null>(null);
  const [incomingInvite, setIncomingInvite] = useState<Invitation | null>(null);
  const [isPairing, setIsPairing] = useState(false);
  const [isTunneling, setIsTunneling] = useState(false);

  // Initialize Emoji Library
  const { floatingEmojis, triggerReaction } = useEmojiLibrary(user);

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user) return;
    const messagesPath = currentRoom
      ? `artifacts/${sanitizedAppId}/public/data/private_chats/${currentRoom.id}`
      : `artifacts/${sanitizedAppId}/public/data/ghost_messages`;

    const reactionRef = ref(db, `${messagesPath}/${messageId}/reactions/${emoji}/${user.uid}`);

    await runTransaction(ref(db, `${messagesPath}/${messageId}/reactions/${emoji}`), (current) => {
      const reactions = current || {};
      if (reactions[user.uid]) {
        delete reactions[user.uid];
      } else {
        reactions[user.uid] = true;
      }
      return reactions;
    });
  };

  // Secret Animations
  const { playPing, playWarp, playSecret } = useSoundEffects();
  const isMatrix = useKonamiCode();
  const { effect: keywordEffect, checkTriggers } = useKeywordTriggers(inputText);

  // Native Emoji Feedback Integration
  useEffect(() => {
    const lastChar = inputText[inputText.length - 1];
    // Check for high-frequency emojis
    if (["❤️", "🔥", "💀", "✨", " Omo"].includes(lastChar) || inputText.includes(" Omo")) {
      setActivityLevel(prev => Math.min(prev + 0.2, 1));
      setTimeout(() => setActivityLevel(prev => Math.max(prev - 0.2, 0)), 2000);
    }
  }, [inputText]);

  // Typing Presence
  const { typingUsers, updateTyping } = useTypingPresence(profile.id ? profile : null, currentRoom?.id || null);

  // Activity Level for Background
  const [activityLevel, setActivityLevel] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setActivityLevel(prev => {
        if (typingUsers.length > 0) {
          return Math.min(1, prev + 0.05); // Rise when typing
        } else {
          return Math.max(0, prev - 0.02); // Decay slowly
        }
      });
    }, 100);
    return () => clearInterval(timer);
  }, [typingUsers.length]);

  // Sound triggers
  useEffect(() => {
    if (messages.length > 0 && messages[messages.length - 1].senderId !== user?.uid) {
      playPing();
    }
  }, [messages, user]);

  useEffect(() => {
    if (isTunneling) playWarp();
  }, [isTunneling]);

  useEffect(() => {
    if (keywordEffect) playSecret();
  }, [keywordEffect]);

  // Listen for Invitation Responses (Handshake Completion)
  useEffect(() => {
    if (!user) return;
    const responseRef = ref(db, `artifacts/${sanitizedAppId}/public/data/invitation_responses/${user.uid}`);

    const unsubscribe = onValue(responseRef, (snapshot) => {
      const data = snapshot.val();
      if (data && data.accepted) {
        // Handshake Complete!
        setIsPairing(false); // Stop waiting spinner
        showNotification(`${data.responderName} accepted! Entering private channel...`);

        setIsTunneling(true);
        setTimeout(() => {
          setCurrentRoom({
            id: data.roomId,
            partnerName: data.responderName,
            partnerColor: data.responderColor
          });
          // Cleanup response
          remove(responseRef);
          setIsTunneling(false);
        }, 1500);
      }
    });
    return () => unsubscribe();
  }, [user]);

  // Combine persistent effects for the container
  const containerClasses = [
    isMatrix ? 'font-mono' : '',
    keywordEffect === 'boom' ? 'animate-shake' : '',
    keywordEffect === 'void' ? 'animate-void' : '',
    keywordEffect === 'spin' ? 'animate-spin-360' : '',
    keywordEffect === 'glitch' ? 'animate-glitch-ui' : '',
    keywordEffect === 'party' ? 'animate-rainbow-bg' : '',
    keywordEffect === 'gravity' ? 'animate-gravity' : '',
    keywordEffect === 'retro' ? 'brightness-75 sepia contrast-125 saturate-50' : '',
    keywordEffect === 'heartbeat' ? 'animate-heartbeat-tint' : '',
    keywordEffect === 'secret-blur' ? 'blur-sm' : '',
    keywordEffect === 'wiggle' ? 'animate-wiggle' : '',
    keywordEffect === 'ascend' ? 'animate-ascension' : ''
  ].filter(Boolean).join(' ');



  const sendInvitation = async (targetId: string, targetName: string) => {
    if (!user || targetId === user.uid) return;
    if (currentRoom) { showNotification("Leave private chat first."); return; }

    const roomId = [user.uid, targetId].sort().join('_');
    const invite: Invitation = {
      senderId: user.uid,
      senderName: profile.name,
      senderColor: profile.color,
      roomId: roomId,
      timestamp: Date.now()
    };

    try {
      await set(ref(db, `artifacts/${sanitizedAppId}/public/data/invitations/${targetId}`), invite);
      showNotification(`Request sent to ${targetName}. Waiting for acceptance...`);
      // Removed auto-join logic. Now waiting for listener.
    } catch (err) {
      console.error(err);
      showNotification("Failed to send invite.");
    }
  };

  const acceptInvitation = async () => {
    if (!incomingInvite || !user) return;
    setIsPairing(true);

    // Notify Sender
    await set(ref(db, `artifacts/${sanitizedAppId}/public/data/invitation_responses/${incomingInvite.senderId}`), {
      accepted: true,
      roomId: incomingInvite.roomId,
      responderName: profile.name,
      responderColor: profile.color,
      timestamp: Date.now()
    });

    await remove(ref(db, `artifacts/${sanitizedAppId}/public/data/invitations/${user.uid}`));

    setTimeout(() => {
      setIsPairing(false);
      setIsTunneling(true);
      setCurrentRoom({
        id: incomingInvite.roomId,
        partnerName: incomingInvite.senderName,
        partnerColor: incomingInvite.senderColor
      });
      setIncomingInvite(null);
      setTimeout(() => setIsTunneling(false), 1500);
    }, 1500);
  };

  const declineInvitation = async () => {
    if (!user) return;
    setIncomingInvite(null);
    await remove(ref(db, `artifacts/${sanitizedAppId}/public/data/invitations/${user.uid}`));
  };


  const leavePrivateChat = () => {
    setIsTunneling(true);
    setTimeout(() => {
      setCurrentRoom(null);
      setIsTunneling(false);
      showNotification("Disconnected. Returning to the Void.");
    }, 1000);
  };


  // Connection Status & Clock Skew Listener
  useEffect(() => {
    const connectedRef = ref(db, ".info/connected");
    const offsetRef = ref(db, ".info/serverTimeOffset");

    const unsubConnected = onValue(connectedRef, (snap) => {
      setIsConnected(!!snap.val());
    });

    const unsubOffset = onValue(offsetRef, (snap) => {
      setServerTimeOffset(snap.val() || 0);
    });

    return () => { unsubConnected(); unsubOffset(); };
  }, []);

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

  // Messages Listener (Public & Private)
  useEffect(() => {
    if (!user) return;

    // Determine which path to listen to
    const messagesPath = currentRoom
      ? `artifacts/${sanitizedAppId}/public/data/private_chats/${currentRoom.id}`
      : `artifacts/${sanitizedAppId}/public/data/ghost_messages`;

    const messagesRef = query(
      ref(db, messagesPath),
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
  }, [user, view, currentRoom]); // Re-run when switching rooms

  // Invitation Listener
  useEffect(() => {
    if (!user) return;
    const inviteRef = ref(db, `artifacts/${sanitizedAppId}/public/data/invitations/${user.uid}`);
    const unsubscribe = onValue(inviteRef, (snapshot) => {
      const val = snapshot.val();
      if (val) {
        // Check if it's fresh (within last 30s)
        if (Date.now() - val.timestamp < 30000) {
          setIncomingInvite(val);
        } else {
          // Auto-decline stale invites
          remove(inviteRef);
        }
      } else {
        setIncomingInvite(null);
      }
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    if (replyingTo && inputRef.current) {
      inputRef.current.focus();
    }
  }, [replyingTo]);

  const scrollToBottom = () => {
    setTimeout(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, 100);
  };



  const togglePoltergeistMode = () => {
    togglePoltergeist();
    const mode = !poltergeistMode;
    // Always notify, not just on enable
    showNotification(mode ? "Poltergeist Mode Enabled 👻" : "Poltergeist Mode Disabled");
  }

  // --- HANDLERS ---
  const handleLogin = (name: string, color: string) => {
    if (!user) return;
    const newProfile = { name: name || getRandomName(), color: color || getRandomColor(), id: user.uid };
    setProfile(newProfile);
    localStorage.setItem('ghost_profile', JSON.stringify(newProfile));
    setView('CHAT');
  };

  const handleLogout = async () => {
    await signOut(auth);
    localStorage.removeItem('ghost_profile');
    setView('LOGIN');
    setProfile({ name: '', color: '', id: '' });
  };

  // --- MESSAGING ---
  const handleEmojiReact = async (emoji: string) => {
    if (!inputText) {
      triggerReaction(emoji);
      return;
    }
    setInputText(prev => prev + emoji);
  };

  const sendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim()) return;

    // Command: /mask [name]
    if (inputText.startsWith('/mask')) {
      if (originalProfile) {
        // Restore identity
        setProfile(originalProfile);
        setOriginalProfile(null);
        showNotification("Identity Restored.");
      } else {
        // Mask identity
        const args = inputText.split(' ');
        const customName = args.length > 1 ? args.slice(1).join(' ') : getRandomName();
        const maskedProfile = {
          ...profile,
          name: customName,
          color: getRandomColor()
        };
        setOriginalProfile(profile);
        setProfile(maskedProfile);
        showNotification(`Identity Masked: ${customName}`);
      }
      setInputText('');
      return;
    }

    // Capture text before clearing
    const msgText = inputText;

    await postMessage(msgText);
    setInputText('');
    updateTyping(false);
    setActivityLevel(prev => Math.min(1, prev + 0.3)); // Boost bg on send

    // Oracle Integration
    const isOracleMention = msgText.toLowerCase().includes('@oracle');
    const isOracleReply = replyingTo?.senderId === 'THE_ORACLE_BOT';

    if (isOracleMention || isOracleReply) {
      // Show "Oracle is thinking" status by adding a placeholder "typing" user
      await set(ref(db, `artifacts/${sanitizedAppId}/public/data/typing/${currentRoom?.id || 'public'}/THE_ORACLE_BOT`), {
        name: "🔮 The Oracle",
        timestamp: Date.now() + 10000 // Show for 10s or until cleared
      });

      setTimeout(async () => {
        // Get active participants for context
        const activeParticipants = [...new Set(messages.slice(-20).map(m => m.senderName))].filter(n => n !== "🔮 The Oracle");
        const participantsList = activeParticipants.join(", ");

        const contextPrompt = isOracleReply
          ? `(Available Users: ${participantsList})\n(User is replying to your previous message: "${replyingTo.text}")\nUser says: ${msgText}`
          : `(Available Users: ${participantsList})\nUser says: ${msgText}`;

        console.log("🔮 Asking Oracle...");
        const oracleResponse = await askOracle(contextPrompt);
        console.log("🔮 Oracle responded:", oracleResponse);

        // Clear Oracle typing status
        await remove(ref(db, `artifacts/${sanitizedAppId}/public/data/typing/${currentRoom?.id || 'public'}/THE_ORACLE_BOT`));

        let finalText = oracleResponse;
        let pollData = null;
        let gameData = null;

        // Parse POLL: [POLL: "Question", "Opt1", "Opt2"]
        // More robust parsing: look for any number of options
        if (oracleResponse.includes('[POLL:')) {
          const pollBlockMatch = oracleResponse.match(/\[POLL:\s*"(.*?)"\s*,\s*(.*?)\]/);
          if (pollBlockMatch) {
            const question = pollBlockMatch[1];
            // Split options by comma but respect quotes
            const optionsContent = pollBlockMatch[2];
            const optionsRaw = optionsContent.split(/",\s*"/).map(o => o.replace(/^"|"$/g, '').trim());

            const options: Record<string, number> = {};
            optionsRaw.forEach(opt => { if (opt) options[opt] = 0; });

            if (Object.keys(options).length > 0) {
              finalText = oracleResponse.replace(/\[POLL:.*?\]/, '').trim();
              pollData = {
                question,
                options,
                deadline: Date.now() + 60000,
                resolved: false,
                type: 'standard' as const
              };
            }
          }
        }

        // Parse VOTE_KICK: [VOTE_KICK: name]
        if (oracleResponse.includes('[VOTE_KICK:')) {
          const kickMatch = oracleResponse.match(/\[VOTE_KICK:\s*(.*?)\]/);
          if (kickMatch) {
            const targetName = kickMatch[1].trim();
            finalText = finalText.replace(kickMatch[0], '').trim();
            pollData = {
              question: `Vote to banish ${targetName}?`,
              options: { 'BANISH': 0, 'MERCY': 0 },
              deadline: Date.now() + 15000,
              resolved: false,
              type: 'kick' as const,
              target: targetName
            };
          }
        }

        // Parse GAME: [GAME: DICE] or [GAME: COIN] or [GAME: TOD]
        if (oracleResponse.includes('[GAME:')) {
          const gameMatch = oracleResponse.match(/\[GAME:\s*(DICE|COIN|TOD)\]/i);
          if (gameMatch) {
            const type = gameMatch[1].toUpperCase() as 'DICE' | 'COIN' | 'TOD';
            finalText = finalText.replace(gameMatch[0], '').trim();
            let result = "";
            if (type === 'DICE') {
              result = (Math.floor(Math.random() * 6) + 1).toString();
            } else if (type === 'COIN') {
              result = Math.random() > 0.5 ? 'HEADS' : 'TAILS';
            } else {
              result = "TRUTH OR DARE"; // Oracle moderates the actual content
            }
            gameData = { type, result };
          }
        }

        const messagesPath = currentRoom
          ? `artifacts/${sanitizedAppId}/public/data/private_chats/${currentRoom.id}`
          : `artifacts/${sanitizedAppId}/public/data/ghost_messages`;

        await push(ref(db, messagesPath), {
          text: finalText,
          senderId: "THE_ORACLE_BOT",
          senderName: "🔮 The Oracle",
          senderColor: "from-amber-300 to-yellow-500",
          timestamp: serverTimestamp(),
          poll: pollData,
          game: gameData
        });
      }, 1000);
    }
  };

  const purgeMessages = async () => {
    if (!window.confirm("Are you sure you want to purge the void? This will delete all messages for everyone.")) return;
    try {
      await remove(ref(db, `artifacts/${sanitizedAppId}/public/data/ghost_messages`));
      showNotification("The void has been cleansed.");
    } catch (error) {
      console.error("Purge failed:", error);
      showNotification("Failed to purge the void.");
    }
  };




  const postMessage = async (text: string, imageFile?: File) => {
    if ((!text.trim() && !imageFile) || !user) return;
    if (isUploading) return;

    setIsUploading(true);
    try {
      let imageBase64: string | null = null;
      // Compression & Glitch Effect
      if (imageFile) {
        try {
          // 1. Compress first (optional, but good for speed)
          // 2. Apply Glitch Effect
          const glitchAndCompress = async (file: File): Promise<string> => {
            return new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.readAsDataURL(file);
              reader.onload = (e) => {
                const img = new Image();
                img.src = e.target?.result as string;
                img.onload = () => {
                  const canvas = document.createElement('canvas');
                  const w = img.width; const h = img.height;
                  canvas.width = w; canvas.height = h;
                  const ctx = canvas.getContext('2d');
                  if (!ctx) { reject("No Context"); return; }

                  // Draw Original
                  ctx.drawImage(img, 0, 0);

                  // --- GLITCH ALGORITHM ---
                  // Random slice and shift
                  const slices = 20;
                  const maxShift = w * 0.1; // 10% shift

                  for (let i = 0; i < slices; i++) {
                    const y = Math.random() * h;
                    const hSlice = Math.random() * (h / 10);
                    const shift = (Math.random() - 0.5) * maxShift;
                    try {
                      const sliceData = ctx.getImageData(0, y, w, hSlice);
                      ctx.putImageData(sliceData, shift, y);
                    } catch (err) { /* Ignore OOB errors */ }
                  }

                  // Color Channel Shift (RGB Split)
                  const imageData = ctx.getImageData(0, 0, w, h);
                  const data = imageData.data;
                  const offset = (w * 4) * 5; // 5 lines downish

                  for (let i = 0; i < data.length; i += 4) {
                    // Red Channel shift
                    if (i + offset < data.length) {
                      data[i] = data[i + offset];
                    }
                  }
                  ctx.putImageData(imageData, 0, 0);

                  // Resolve
                  resolve(canvas.toDataURL('image/jpeg', 0.6));
                };
                img.onerror = reject;
              };
              reader.onerror = reject;
            });
          };

          imageBase64 = await glitchAndCompress(imageFile);
        } catch (e) {
          console.error("Glitch failed", e);
          showNotification("Glitch upload failed.");
          setIsUploading(false);
          return;
        }
      }

      // Dynamic Path based on Room
      const messagesPath = currentRoom
        ? `artifacts/${sanitizedAppId}/public/data/private_chats/${currentRoom.id}`
        : `artifacts/${sanitizedAppId}/public/data/ghost_messages`;

      const messagesListRef = ref(db, messagesPath);
      const payload: any = {
        text: text,
        senderId: user.uid,
        senderName: profile.name,
        senderColor: profile.color,
        isPoltergeist: poltergeistMode,
        timestamp: serverTimestamp(),
        startImage: imageBase64 || null
      };

      if (replyingTo) {
        payload.replyTo = {
          id: replyingTo.id,
          senderName: replyingTo.senderName,
          text: replyingTo.text,
          startImage: replyingTo.startImage || null
        };
      }

      await push(messagesListRef, payload);
      setReplyingTo(null);
      scrollToBottom();
    } catch (err: any) {
      console.error("Broadcast failed", err);
      showNotification(`Failed to broadcast: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };



  const handleReaction = (emoji: string) => {
    triggerReaction(emoji);
    postMessage(emoji);
  };

  useEffect(() => {
    if (!user) return;
    const cleanupInterval = setInterval(() => {
      const estimatedServerTime = Date.now() + serverTimeOffset;
      messages.forEach(msg => {
        if (msg.senderId === user.uid) {
          const timeSince = estimatedServerTime - (msg.timestamp || estimatedServerTime);

          // Epheramal rules
          const isEphemeral = msg.isPoltergeist || msg.startImage;
          const limit = isEphemeral ? 45000 : 3600000; // 45s for images/ghost mode, 1hr for text

          if (timeSince > limit) {
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
    <div className={`flex flex-col h-screen w-full bg-[#050505] text-slate-200 font-sans overflow-hidden relative selection:bg-purple-500/30 ${isTunneling ? 'animate-tunnel' : ''} ${keywordEffect === 'pharmacy' ? 'animate-glitch-ui' : ''}`}>

      {/* Secret Overlays */}
      {isMatrix && <MatrixRain />}
      {keywordEffect === 'heartbeat' && <FloatingHearts />}
      {keywordEffect === 'christmas' && <SnowFall />}
      {keywordEffect === 'incourse' && <StressEffects />}
      {keywordEffect === 'pharmacy' && <PharmacyGlitch />}
      {keywordEffect === 'party' && (
        <div className="absolute inset-0 pointer-events-none z-[60] overflow-hidden">
          {/* Simple CSS Confetti could go here, for now simpler shim */}
          <div className="w-full h-full bg-[url('https://www.transparenttextures.com/patterns/stardust.png')] opacity-50 animate-pulse mix-blend-screen"></div>
        </div>
      )}

      {/* Background Visuals */}
      <SpiritDust intensity={activityLevel} />
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
        
        /* Quantum Tunneling Effect */
        @keyframes tunnel {
            0% { transform: scale(1) rotate(0deg); opacity: 1; filter: hue-rotate(0deg); }
            50% { transform: scale(1.5) rotate(5deg); opacity: 0.5; filter: hue-rotate(90deg) blur(10px); }
            100% { transform: scale(1) rotate(0deg); opacity: 1; filter: hue-rotate(0deg); }
        }
        .animate-tunnel { animation: tunnel 1.5s cubic-bezier(0.7, 0, 0.3, 1) forwards; }

        /* Secret Keyframes */
        @keyframes shake { 
            0%, 100% { transform: translate(0, 0); } 
            10%, 30%, 50%, 70%, 90% { transform: translate(-5px, 5px); } 
            20%, 40%, 60%, 80% { transform: translate(5px, -5px); } 
        }
        .animate-shake { animation: shake 0.5s linear; }

        @keyframes voidFade { 0% { opacity: 1; filter: brightness(1); } 50% { opacity: 0; filter: brightness(0); } 100% { opacity: 1; filter: brightness(1); } }
        .animate-void { animation: voidFade 2s ease-in-out; }

        @keyframes spin360 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin-360 { animation: spin360 1s ease-in-out; }

        @keyframes glitchUI { 
            0% { clip-path: inset(50% 0 30% 0); transform: translate(-5px,0); }
            20% { clip-path: inset(20% 0 60% 0); transform: translate(5px,0); }
            40% { clip-path: inset(40% 0 40% 0); transform: translate(-5px,0); }
            60% { clip-path: inset(80% 0 5% 0); transform: translate(5px,0); }
            80% { clip-path: inset(10% 0 80% 0); transform: translate(-5px,0); }
            100% { clip-path: inset(0 0 0 0); transform: translate(0,0); }
        }
        .animate-glitch-ui { animation: glitchUI 0.3s steps(5) infinite; }

        @keyframes rainbowBg { 
            0% { filter: hue-rotate(0deg) saturate(2); } 
            100% { filter: hue-rotate(360deg) saturate(2); } 
        }
        .animate-rainbow-bg { animation: rainbowBg 2s linear infinite; }

        .animate-gravity { transform: rotate(5deg) skewX(5deg) translateY(20px); transition: all 1s ease; }

        @keyframes floatUp { 0% { transform: translateY(0); opacity: 1; } 100% { transform: translateY(-100vh); opacity: 0; } }
        .animate-float-up { animation: floatUp 4s linear infinite; }

        .animate-heartbeat-tint { box-shadow: inset 0 0 100px rgba(236, 72, 153, 0.3); }
        
        @keyframes goldPulse { 0%, 100% { box-shadow: inset 0 0 0 rgba(234, 179, 8, 0); } 50% { box-shadow: inset 0 0 50px rgba(234, 179, 8, 0.5); } }
        .animate-gold-pulse { animation: goldPulse 2s infinite; }
        
        @keyframes ascend { 0% { transform: translateY(0) scale(1); opacity: 1; } 100% { transform: translateY(-300px) scale(0); opacity: 0; } }
        .animate-ascension { animation: ascend 3s ease-in forwards; pointer-events: none; }

        @keyframes wiggle { 
            0%, 100% { transform: translateY(0); } 
            25% { transform: translateY(-15px); } 
            75% { transform: translateY(15px); } 
        }
        .animate-wiggle { animation: wiggle 0.5s ease-in-out infinite; }

        @keyframes snow { 0% { transform: translate(0, 0) rotate(0); } 100% { transform: translate(20px, 110vh) rotate(360deg); } }
        .animate-snow { animation: snow 10s linear infinite; }

        @keyframes stress { 0% { transform: translate(0, 0) scale(1); opacity: 0; } 50% { opacity: 1; } 100% { transform: translate(var(--tw-translate-x), var(--tw-translate-y)) scale(1.5); opacity: 0; } }
        .animate-stress { animation: stress 2s ease-out infinite; }

        @keyframes pulse-subtle { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.8; } }
        .animate-pulse-subtle { animation: pulse-subtle 2s ease-in-out infinite; }
      `}</style>



      {/* Pairing Overlay */}
      {
        isPairing && (
          <div className="absolute inset-0 z-[100] bg-black/90 flex flex-col items-center justify-center p-8 backdrop-blur-xl animate-enter">
            <div className="relative">
              <div className="absolute inset-0 bg-indigo-500 blur-3xl opacity-20 animate-pulse"></div>
              <RefreshCw size={64} className="text-indigo-400 animate-spin duration-700" />
            </div>
            <h2 className="mt-8 text-2xl font-bold text-white tracking-widest uppercase scanner-text">
              Establishing Neural Link...
            </h2>
            <div className="w-64 h-1 bg-gray-800 rounded-full mt-6 overflow-hidden">
              <div className="h-full bg-indigo-500 animate-[loading_1.5s_ease-in-out_infinite]" style={{ width: '100%' }}></div>
            </div>
          </div>
        )
      }

      {/* Pairing Request Modal */}
      {
        incomingInvite && !isPairing && (
          <div className="absolute top-24 left-1/2 -translate-x-1/2 z-[90] w-full max-w-sm px-4 animate-slide-up">
            <div className="bg-slate-900/90 backdrop-blur-xl border border-indigo-500/50 p-6 rounded-2xl shadow-[0_0_50px_rgba(79,70,229,0.3)] relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 z-0"></div>
              <div className="relative z-10 text-center">
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br ${incomingInvite.senderColor} flex items-center justify-center shadow-lg animate-bounce`}>
                  <User size={32} className="text-white" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">Incoming Signal</h3>
                <p className="text-indigo-200 text-sm mb-6">
                  <strong className="text-white">{incomingInvite.senderName}</strong> wants to initiate a private link.
                </p>
                <div className="flex gap-3">
                  <button onClick={declineInvitation} className="flex-1 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 font-bold text-sm transition-colors">
                    Decline
                  </button>
                  <button onClick={acceptInvitation} className={`flex-1 py-3 rounded-xl bg-gradient-to-r ${incomingInvite.senderColor} text-white font-bold text-sm shadow-lg transition-all hover:scale-105`}>
                    Accept
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }

      {/* Render the Library's Emoji Layer */}
      <EmojiOverlay emojis={floatingEmojis} />

      {/* Notifications */}
      {
        notification && (
          <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 animate-enter">
            <div className="bg-slate-900/80 backdrop-blur-md border border-purple-500/30 px-6 py-2 rounded-full shadow-[0_0_30px_rgba(168,85,247,0.2)] flex items-center gap-2">
              <Sparkles size={14} className="text-purple-400" />
              <span className="text-xs font-medium text-purple-100 tracking-wide">{notification}</span>
            </div>
          </div>
        )
      }

      <header className="relative z-20 h-16 border-b border-white/5 bg-black/20 backdrop-blur-2xl flex items-center justify-between px-6 shadow-2xl">
        <div className="flex items-center gap-3 group cursor-default">
          <div className="p-2 animate-float">
            <img src="/logo.png" alt="GhostChat Logo" className="w-[32px] h-[32px] drop-shadow-[0_0_10px_rgba(167,139,250,0.5)]" />
          </div>
          <div>
            <h1 className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 tracking-tight leading-none glitch-hover transition-all cursor-pointer">GhostChat</h1>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : 'bg-red-500 shadow-[0_0_8px_#ef4444]'} animate-status`}></span>
              <span className="text-[9px] font-semibold text-slate-500 uppercase tracking-widest">{isConnected ? 'Live Channel' : 'Offline'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {currentRoom && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-200">
              <span className={`w-2 h-2 rounded-full bg-gradient-to-r ${currentRoom.partnerColor !== 'unknown' ? currentRoom.partnerColor : 'from-indigo-400 to-purple-400'} animate-pulse`}></span>
              <span className="text-xs font-bold tracking-wide">PRIVATE LINK: {currentRoom.partnerName}</span>
            </div>
          )}

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

          {currentRoom && (
            <button
              onClick={leavePrivateChat}
              className="p-2.5 text-red-400 hover:bg-red-500/20 rounded-xl transition-all duration-300 hover:scale-105 shadow-[0_0_15px_rgba(239,68,68,0.2)]"
              title="Disconnect Private Link"
            >
              <LogOut size={18} />
            </button>
          )}

          <button
            onClick={() => setShowHelp(true)}
            className="p-2.5 text-indigo-400 hover:bg-indigo-500/10 rounded-xl transition-all duration-300 hover:scale-110 active:scale-90"
            title="Help & Info"
          >
            <HelpCircle size={18} />
          </button>

          {/* Admin Toggle */}
          {profile.name === 'thecolorfulbox' && (
            <button
              onClick={() => setShowAdmin(true)}
              className="p-2.5 text-amber-400 hover:bg-amber-500/10 rounded-xl transition-all duration-300 hover:rotate-12 active:scale-90"
              title="Admin Panel"
            >
              <ShieldAlert size={18} />
            </button>
          )}

          <button
            onClick={handleLogout}
            className="p-2.5 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all duration-300 hover:rotate-90 active:scale-90"
            title="Log Out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Help Modal */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

      {/* Admin Modal */}
      {showAdmin && (
        <div className="absolute inset-0 z-[200] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6 animate-enter">
          <div className="bg-slate-900 border border-amber-500/30 p-8 rounded-3xl max-w-md w-full shadow-[0_0_50px_rgba(245,158,11,0.2)]">
            <div className="flex items-center gap-3 mb-6 text-amber-400">
              <ShieldAlert size={32} />
              <h2 className="text-2xl font-bold tracking-widest uppercase">Admin Console</h2>
            </div>
            <p className="text-slate-400 mb-8 font-mono text-sm leading-relaxed">
              Welcome, <span className="text-white font-bold">thecolorfulbox</span>.
              <br />
              You have root access to The Void.
            </p>

            <div className="space-y-4">
              <button
                onClick={() => { purgeMessages(); setShowAdmin(false); }}
                className="w-full py-4 bg-red-900/30 border border-red-500/50 hover:bg-red-500 hover:text-white text-red-400 rounded-xl font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-3"
              >
                <Trash2 size={20} /> Purge All Memories
              </button>

              <button
                onClick={() => setShowAdmin(false)}
                className="w-full py-3 text-slate-500 hover:text-white font-bold uppercase tracking-widest text-xs"
              >
                Close Console
              </button>
            </div>
          </div>
        </div>
      )}

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
          const fadeDuration = 5000;
          const lifeTime = 45000; // 45 seconds total life
          const fadeStart = lifeTime - fadeDuration; // 40 seconds

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
                  <button
                    onClick={() => !isMe && !currentRoom && sendInvitation(msg.senderId, msg.senderName)}
                    className={`text-[10px] font-bold tracking-wide ${isMe ? 'text-indigo-300' : 'text-slate-400 hover:text-indigo-400 cursor-pointer hover:underline'}`}
                    title={!isMe && !currentRoom ? "Click to Pair" : ""}
                  >
                    {msg.senderName}
                  </button>
                </div>
              )}
              <div
                className={`group relative max-w-[80%] break-words p-4 rounded-2xl shadow-lg transition-all duration-300 hover:scale-[1.02] active:scale-95 cursor-pointer 
                    ${msg.senderId === user.uid
                    ? `bg-gradient-to-br ${msg.senderColor || 'from-indigo-600 to-blue-600'} text-white rounded-br-none`
                    : 'bg-slate-800/80 text-slate-200 rounded-bl-none border border-slate-700/50 hover:bg-slate-800'
                  } ${poltergeistMode ? 'opacity-80' : ''}`}
                onClick={() => checkTriggers(msg.text)}
              >
                {/* Reply Context in Message */}
                {msg.replyTo && (
                  <div className={`mb-2 pb-2 border-b border-white/10 text-[11px] ${isMe ? 'text-indigo-200/70' : 'text-slate-400'}`}>
                    <div className="flex items-center gap-1 font-bold mb-0.5 opacity-80">
                      <Reply size={10} className="scale-x-[-1]" />
                      {msg.replyTo.senderName}
                    </div>
                    <div className="truncate opacity-60 italic flex items-center gap-1">
                      {msg.replyTo.startImage && <ImageIcon size={12} className="text-slate-400" />}
                      <span>"{msg.replyTo.text || 'Image'}"</span>
                    </div>
                  </div>
                )}

                {/* Poll Rendering Logic */}
                {msg.poll && (
                  <div className={`mt-3 p-3 rounded-lg border ${msg.poll.type === 'kick' ? 'bg-red-900/40 border-red-500/30' : 'bg-slate-900/40 border-slate-500/30'}`}>
                    <div className={`flex items-center gap-2 mb-2 font-bold text-xs uppercase tracking-widest ${msg.poll.type === 'kick' ? 'text-red-300' : 'text-slate-300'}`}>
                      <AlertCircle size={14} /> {msg.poll.type === 'kick' ? 'Tribunal Initiated' : 'Community Poll'}
                    </div>
                    <p className="text-sm font-bold text-white mb-2">
                      {msg.poll.question}
                    </p>

                    {/* Timer */}
                    <div className="mb-2 w-full bg-white/5 h-1 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-1000 ease-linear ${msg.poll.type === 'kick' ? 'bg-red-500' : 'bg-indigo-500'}`}
                        style={{ width: `${Math.max(0, Math.min(100, ((msg.poll.deadline - Date.now()) / (msg.poll.type === 'kick' ? 15000 : 60000)) * 100))}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-1 gap-2">
                      {Object.entries(msg.poll.options).map(([option, count]) => (
                        <button
                          key={option}
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (localStorage.getItem(`voted_${msg.id}`)) {
                              showNotification("One citizen, one vote.");
                              return;
                            }
                            localStorage.setItem(`voted_${msg.id}`, 'true');
                            const messagesPath = currentRoom
                              ? `artifacts/${sanitizedAppId}/public/data/private_chats/${currentRoom.id}`
                              : `artifacts/${sanitizedAppId}/public/data/ghost_messages`;
                            const optRef = ref(db, `${messagesPath}/${msg.id}/poll/options/${option}`);
                            await runTransaction(optRef, (current) => (current || 0) + 1);
                          }}
                          className={`flex-1 py-1.5 rounded text-xs font-bold transition-colors flex justify-between px-3 cursor-pointer ${msg.poll?.type === 'kick' && option === 'BANISH' ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                            } ${localStorage.getItem(`voted_${msg.id}`) ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <span>{option}</span>
                          <span>{count || 0}</span>
                        </button>
                      ))}
                    </div>

                    {/* Resolution Check */}
                    {msg.poll.deadline < Date.now() && (
                      <div className={`mt-2 text-[10px] text-center font-mono ${msg.poll.type === 'kick' ? 'text-red-400' : 'text-slate-400'}`}>
                        {msg.poll.type === 'kick' ? (
                          <>
                            {(() => {
                              const yes = msg.poll.options['BANISH'] || 0;
                              const no = msg.poll.options['MERCY'] || 0;
                              const result = yes > no ? "GUILTY. EXECUTING..." : "INNOCENT. VOID RECEDES.";

                              if (yes > no && msg.poll.target?.toLowerCase() === profile.name.toLowerCase()) {
                                if (Date.now() - msg.poll.deadline < 55000) {
                                  if (!sessionStorage.getItem(`banned_${msg.id}`)) {
                                    sessionStorage.setItem(`banned_${msg.id}`, 'true');
                                    setTimeout(() => {
                                      localStorage.removeItem('ghost_profile');
                                      window.location.reload();
                                    }, 3000);
                                  }
                                }
                              }
                              return `VERDICT: ${result}`;
                            })()}
                          </>
                        ) : "POLL CLOSED"}
                      </div>
                    )}
                  </div>
                )}

                {/* Game Rendering Logic */}
                {msg.game && (
                  <div className={`mt-2 p-3 ${msg.game.type === 'TOD' ? 'bg-purple-900/30 border-purple-500/30' : 'bg-white/5 border-white/10'} rounded-lg border flex items-center justify-between`}>
                    <div className="flex items-center gap-2">
                      <Sparkles size={16} className={msg.game.type === 'TOD' ? 'text-purple-400' : 'text-amber-400'} />
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{msg.game.type === 'TOD' ? 'TRUTH OR DARE' : `${msg.game.type} ROLL`}</span>
                    </div>
                    <div className="text-xl font-bold text-white animate-bounce">
                      {msg.game.type === 'DICE' ? `🎲 ${msg.game.result}` : msg.game.type === 'COIN' ? `🪙 ${msg.game.result}` : `😈 ?`}
                    </div>
                  </div>
                )}

                {msg.startImage && (
                  <img
                    src={msg.startImage}
                    alt="Encrypted Visual"
                    className="max-w-full rounded-lg mb-3 border border-white/10 shadow-lg block"
                  />
                )}
                {renderMessageText(msg.text)}

                {/* Reactions Display */}
                {msg.reactions && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {Object.entries(msg.reactions).map(([emoji, users]) => {
                      const count = Object.keys(users).length;
                      if (count === 0) return null;
                      const hasReacted = user && users[user.uid];
                      return (
                        <button
                          key={emoji}
                          onClick={(e) => { e.stopPropagation(); toggleReaction(msg.id, emoji); }}
                          className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold transition-all ${hasReacted ? 'bg-white/20 text-white ring-1 ring-white/30' : 'bg-black/20 text-slate-400 hover:bg-black/40'
                            }`}
                        >
                          <span>{emoji}</span>
                          <span>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Reply & React Buttons */}
                <div className={`absolute top-1/2 -translate-y-1/2 ${isMe ? '-left-12' : '-right-12'} flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-all duration-300`}>
                  <button
                    onClick={() => setReplyingTo(msg)}
                    className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
                    title="Reply"
                  >
                    <Reply size={14} className="scale-x-[-1]" />
                  </button>
                  <div className="relative group/picker">
                    <button
                      className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
                      title="React"
                    >
                      <Sparkles size={14} />
                    </button>
                    {/* Mini Emoji Picker */}
                    <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover/picker:flex items-center gap-1 p-1 bg-slate-900/90 backdrop-blur-md rounded-xl border border-white/10 shadow-2xl z-[70]">
                      {LIBRARY_EMOJIS.map(emoji => (
                        <button
                          key={emoji}
                          onClick={(e) => { e.stopPropagation(); toggleReaction(msg.id, emoji); }}
                          className="hover:scale-125 transition-transform p-1"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
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
        {
          replyingTo && (
            <div className="flex items-center justify-between bg-indigo-900/30 border border-white/10 border-b-0 rounded-t-2xl px-5 py-2 mx-2 -mb-2 z-0 backdrop-blur-xl animate-slide-up">
              <div className="flex items-center gap-3 text-xs text-slate-300 overflow-hidden">
                <Reply size={14} className="scale-x-[-1] text-indigo-400 shrink-0" />
                <div className="flex flex-col">
                  <span className="font-bold text-indigo-300">Replying to {replyingTo.senderName}</span>
                  <span className="opacity-60 truncate max-w-[200px] md:max-w-md italic flex items-center gap-1">
                    {replyingTo.startImage && <ImageIcon size={12} />}
                    <span>"{replyingTo.text || 'Image'}"</span>
                  </span>
                </div>
              </div>
              <button onClick={() => setReplyingTo(null)} className="p-1.5 hover:bg-white/10 rounded-full text-slate-400 hover:text-white transition-colors">
                <X size={14} />
              </button>
            </div>
          )
        }

        <div className={`
          relative bg-black/40 backdrop-blur-3xl border border-white/10 transition-all duration-500 rounded-3xl p-1.5 flex items-end gap-2 shadow-2xl focus-within:border-white/20 z-10
        `}>
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) {
                const file = e.target.files[0];
                postMessage("", file);
                e.target.value = ''; // Reset
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="p-3.5 mb-1 rounded-[1rem] transition-all transform active:scale-95 text-slate-400 hover:text-white hover:bg-white/10 disabled:opacity-50"
            title="Send Image"
          >
            {isUploading ? <RefreshCw size={18} className="animate-spin" /> : <ImageIcon size={18} />}
          </button>

          {/* Typing Indicator */}
          {typingUsers.length > 0 && (
            <div className="absolute -top-6 left-4 flex items-center gap-2 text-[10px] font-bold text-slate-400 animate-slide-up">
              <div className="flex gap-0.5">
                <span className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></span>
                <span className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></span>
                <span className="w-1 h-1 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
              </div>
              <span>
                {(() => {
                  // Filter out self for text display
                  const others = typingUsers.filter(u => u.id !== user?.uid);
                  if (others.length === 0) return null; // Only me typing
                  if (others.length === 1) return `${others[0].name} is manifesting...`;
                  if (others.length === 2) return `${others[0].name} & ${others[1].name} are manifesting...`;
                  return "Multiple spirits manifesting...";
                })()}
              </span>
            </div>
          )}

          {/* Text Area */}
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value);
                if (e.target.value.length > 0) updateTyping(true);
              }}
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
            disabled={!inputText.trim() || isUploading}
            className={`p-3.5 mb-1 rounded-[1rem] shadow-lg transition-all transform active:scale-95 disabled:opacity-50 disabled:scale-100 bg-white text-black hover:bg-slate-200`}
          >
            <Send size={18} className="ml-0.5" strokeWidth={2.5} />
          </button>
        </div>
      </footer >
    </div >
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

          <div className="pt-4 border-t border-white/5 space-y-4">
            <button
              onClick={() => (window as any).setShowHelp?.(true)}
              className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 font-bold text-xs uppercase tracking-widest transition-all"
            >
              How to Use GhostChat
            </button>

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
        </div>

        <div className="mt-8 text-center"><p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest hover:text-slate-400 transition-colors cursor-default">End-to-End Encrypted</p></div>
      </div>
    </div>
  );
}