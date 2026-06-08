import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { initializeSocket, getSocket } from '../socket/socket';
import { getUsersApi, getMessagesApi } from '../api/authApi';

interface User {
  _id: string; username: string; email: string; avatar?: string; isOnline?: boolean;
}
interface Message {
  _id: string;
  sender: { _id: string; username: string };
  receiver: { _id: string; username: string };
  message: string; createdAt: string; isRead: boolean;
}
type CallState = 'idle' | 'calling' | 'incoming' | 'connected';
type ActivePanel = 'none' | 'settings' | 'notifications';

const avatarColors = ['#00ff9f','#00d4ff','#b400ff','#ff006e','#ff9f00','#00ff47','#ff4500','#0080ff'];
const getAvatarColor = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
};

const fakeNotifications = [
  { id: '1', text: 'New user joined CipherChat', time: '2m ago', read: false },
  { id: '2', text: 'Secure connection established', time: '1h ago', read: false },
  { id: '3', text: 'End-to-end encryption active', time: '3h ago', read: true },
];

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

const ChatPage = () => {
  const { user, token, logout } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [onlineUsers, setOnlineUsers] = useState<string[]>([]);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('All');
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [activePanel, setActivePanel] = useState<ActivePanel>('none');
  const [notifications, setNotifications] = useState(fakeNotifications);
  const [settings, setSettings] = useState({ notifications: true, sounds: true, encryption: true, readReceipts: true, fontSize: 'medium' });

  // Call states
  const [callState, setCallState] = useState<CallState>('idle');
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCallData, setIncomingCallData] = useState<{ fromUserId: string; callerName: string; callType: 'audio' | 'video'; offer: RTCSessionDescriptionInit } | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

  // WebRTC refs
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUserRef = useRef<string | null>(null);
  const selectedUserRef = useRef<User | null>(null);

  useEffect(() => { currentUserRef.current = (user as any)?.id || (user as any)?._id || null; }, [user]);
  useEffect(() => { selectedUserRef.current = selectedUser; }, [selectedUser]);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const fetchUsers = useCallback(async () => {
    if (!token) return;
    try { const data = await getUsersApi(token); setUsers(data.users); } catch (e) { console.error(e); }
  }, [token]);
  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  // ── WebRTC helpers ──────────────────────────────
  const createPeerConnection = useCallback((remoteUserId: string) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const socket = getSocket();
        socket?.emit('call:ice-candidate', { toUserId: remoteUserId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = e.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        endCall();
      }
    };
    return pc;
  }, []);

  const getLocalStream = async (type: 'audio' | 'video') => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: type === 'video',
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    } catch (e) {
      console.error('Could not get media:', e);
      return null;
    }
  };

  const startCallTimer = () => {
    setCallDuration(0);
    callTimerRef.current = setInterval(() => setCallDuration(p => p + 1), 1000);
  };

  const cleanupCall = () => {
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setCallState('idle');
    setCallDuration(0);
    setIsMuted(false);
    setIsCameraOff(false);
    setIncomingCallData(null);
  };

  // Initiate call
  const startCall = async (type: 'audio' | 'video') => {
    if (!selectedUser) return;
    const socket = getSocket();
    if (!socket) return;
    setCallType(type);
    setCallState('calling');
    const stream = await getLocalStream(type);
    if (!stream) { setCallState('idle'); return; }
    const pc = createPeerConnection(selectedUser._id);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('call:offer', {
      toUserId: selectedUser._id,
      offer,
      callType: type,
      callerName: (user as any)?.username,
    });
  };

  // Accept incoming call
  const acceptCall = async () => {
    if (!incomingCallData) return;
    const socket = getSocket();
    if (!socket) return;
    const stream = await getLocalStream(incomingCallData.callType);
    if (!stream) return;
    const pc = createPeerConnection(incomingCallData.fromUserId);
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    await pc.setRemoteDescription(new RTCSessionDescription(incomingCallData.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('call:answer', { toUserId: incomingCallData.fromUserId, answer });
    setCallState('connected');
    setCallType(incomingCallData.callType);
    startCallTimer();
  };

  const rejectCall = () => {
    if (!incomingCallData) return;
    const socket = getSocket();
    socket?.emit('call:reject', { toUserId: incomingCallData.fromUserId });
    cleanupCall();
  };

  const endCall = () => {
    const targetId = incomingCallData?.fromUserId || selectedUser?._id;
    if (targetId) {
      const socket = getSocket();
      socket?.emit('call:end', { toUserId: targetId });
    }
    cleanupCall();
  };

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = isMuted; });
    setIsMuted(p => !p);
  };

  const toggleCamera = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = isCameraOff; });
    setIsCameraOff(p => !p);
  };

  // ── Socket setup ────────────────────────────────
  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(() => {
      const socket = initializeSocket(token);
      socket.on('onlineUsers', (ids: string[]) => { setOnlineUsers(ids); fetchUsers(); });
      socket.on('receiveMessage', (msg: Message) => {
        const myId = currentUserRef.current;
        if (String(msg.sender._id) === String(myId)) return;
        const sel = selectedUserRef.current;
        if (sel && String(msg.sender._id) === String(sel._id)) {
          setMessages(prev => prev.some(m => m._id === msg._id) ? prev : [...prev, msg]);
        } else {
          setUnreadCounts(prev => ({ ...prev, [msg.sender._id]: (prev[msg.sender._id] || 0) + 1 }));
        }
      });
      socket.on('messageSent', (msg: Message) => {
        setMessages(prev => prev.some(m => m._id === msg._id) ? prev : [...prev, msg]);
      });
      socket.on('userTyping', (data: { userId: string }) => {
        setTypingUsers(prev => [...new Set([...prev, data.userId])]);
      });
      socket.on('userStopTyping', (data: { userId: string }) => {
        setTypingUsers(prev => prev.filter(id => id !== data.userId));
      });

      // ── WebRTC call events ──
      socket.on('call:incoming', (data: any) => {
        setIncomingCallData(data);
        setCallState('incoming');
      });
      socket.on('call:answered', async (data: { answer: RTCSessionDescriptionInit }) => {
        await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(data.answer));
        setCallState('connected');
        startCallTimer();
      });
      socket.on('call:ice-candidate', async (data: { candidate: RTCIceCandidateInit }) => {
        try { await peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
      });
      socket.on('call:rejected', () => { cleanupCall(); });
      socket.on('call:ended', () => { cleanupCall(); });
    }, 100);
    return () => clearTimeout(timer);
  }, [token, fetchUsers]);

  useEffect(() => {
    if (!selectedUser || !token) return;
    getMessagesApi(selectedUser._id, token)
      .then(data => setMessages(data.messages))
      .catch(console.error);
  }, [selectedUser, token]);

  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedUser) return;
    const socket = getSocket();
    if (!socket) return;
    socket.emit('sendMessage', { receiverId: selectedUser._id, message: newMessage.trim() });
    setNewMessage('');
    socket.emit('stopTyping', { receiverId: selectedUser._id });
  };

  const handleTyping = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewMessage(e.target.value);
    if (!selectedUser) return;
    const socket = getSocket();
    if (!socket) return;
    socket.emit('typing', { receiverId: selectedUser._id });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => socket.emit('stopTyping', { receiverId: selectedUser._id }), 1500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  const formatTime = (d: string) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formatDate = (d: string) => {
    const date = new Date(d); const today = new Date();
    const diff = today.getDate() - date.getDate();
    if (diff === 0) return 'Today'; if (diff === 1) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  const formatDur = (s: number) => `${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toString().padStart(2,'0')}`;

  const isOnline = (id: string) => onlineUsers.includes(id);
  const isTyping = selectedUser ? typingUsers.includes(selectedUser._id) : false;
  const currentUserId = (user as any)?.id || (user as any)?._id;
  const currentUsername = (user as any)?.username || 'You';
  const filteredUsers = users.filter(u => u.username.toLowerCase().includes(searchQuery.toLowerCase()));
  const groupedMessages = messages.reduce((acc, msg) => {
    const key = formatDate(msg.createdAt);
    if (!acc[key]) acc[key] = [];
    acc[key].push(msg); return acc;
  }, {} as Record<string, Message[]>);
  const unreadNotifCount = notifications.filter(n => !n.read).length;
  const togglePanel = (p: ActivePanel) => setActivePanel(prev => prev === p ? 'none' : p);

  // ── Caller user object lookup ──
  const callerUser = incomingCallData ? users.find(u => u._id === incomingCallData.fromUserId) : null;
  const callPartner = callState === 'incoming' ? callerUser : selectedUser;

  return (
    <div style={{ fontFamily: "'Space Grotesk', 'Courier New', monospace" }} className="h-screen flex overflow-hidden" style2={{ background: '#050608' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        body { background: #050608; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #00ff9f33; border-radius: 4px; }
        @keyframes bounce { 0%,60%,100% { transform:translateY(0) } 30% { transform:translateY(-4px) } }
        @keyframes neonPulse { 0%,100% { box-shadow: 0 0 8px #00ff9f88 } 50% { box-shadow: 0 0 22px #00ff9f, 0 0 40px #00ff9f55 } }
        @keyframes ringOut { 0% { transform:scale(0.7); opacity:1 } 100% { transform:scale(2.2); opacity:0 } }
        @keyframes scanline { 0% { transform:translateY(-100%) } 100% { transform:translateY(100vh) } }
        @keyframes glitch { 0%,100% { clip-path:inset(0 0 95% 0) } 25% { clip-path:inset(30% 0 50% 0) } 50% { clip-path:inset(60% 0 20% 0) } 75% { clip-path:inset(10% 0 80% 0) } }
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:translateY(0) } }
        .msg-in { animation: fadeSlideIn 0.2s ease-out; }
        .neon-btn { transition: all 0.2s; }
        .neon-btn:hover { box-shadow: 0 0 14px currentColor; filter: brightness(1.2); }
        .sidebar-user:hover { background: #0a1a12 !important; }
        .toggle-switch { transition: background 0.2s; }
        .toggle-thumb { transition: left 0.2s; }
        video { transform: scaleX(-1); object-fit: cover; }
      `}</style>

      {/* ── CALL MODAL ─────────────────────────────── */}
      {callState !== 'idle' && callPartner && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(16px)' }}>

          {/* Scanline effect */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-10">
            <div style={{ height: 2, background: 'linear-gradient(90deg,transparent,#00ff9f,transparent)', animation: 'scanline 3s linear infinite', width: '100%' }} />
          </div>

          <div className="relative w-96 rounded-2xl overflow-hidden flex flex-col items-center"
            style={{ background: 'linear-gradient(160deg,#070d10,#0a1510)', border: '1px solid #00ff9f33', boxShadow: '0 0 60px #00ff9f22, 0 30px 80px rgba(0,0,0,0.8)' }}>

            {/* Top bar */}
            <div className="w-full px-6 py-3 flex items-center justify-between border-b" style={{ borderColor: '#00ff9f22' }}>
              <span className="text-[10px] font-bold tracking-widest" style={{ color: '#00ff9f99' }}>
                ◉ {callState === 'calling' ? 'OUTGOING' : callState === 'incoming' ? 'INCOMING' : 'CONNECTED'} — {callType.toUpperCase()} CALL
              </span>
              <span className="text-[10px]" style={{ color: '#00ff9f55' }}>E2E ENCRYPTED</span>
            </div>

            {/* Video area (only for video calls when connected) */}
            {callType === 'video' && callState === 'connected' && (
              <div className="w-full relative" style={{ height: 200, background: '#020408' }}>
                <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" style={{ transform: 'none' }} />
                <div className="absolute bottom-3 right-3 w-20 h-28 rounded-xl overflow-hidden border" style={{ borderColor: '#00ff9f44' }}>
                  <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full" />
                </div>
                {isCameraOff && (
                  <div className="absolute inset-0 flex items-center justify-center" style={{ background: '#020408ee' }}>
                    <span className="text-xs" style={{ color: '#00ff9f55' }}>CAMERA OFF</span>
                  </div>
                )}
              </div>
            )}

            {/* Avatar + info */}
            <div className="flex flex-col items-center px-8 pt-8 pb-2 gap-3 w-full">
              {/* Rings animation */}
              {(callState === 'calling' || callState === 'incoming') && (
                <div className="relative flex items-center justify-center mb-2">
                  {[0, 0.5, 1].map(delay => (
                    <div key={delay} className="absolute w-20 h-20 rounded-full border"
                      style={{ borderColor: '#00ff9f55', animation: `ringOut 2s ${delay}s ease-out infinite` }} />
                  ))}
                  <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold relative z-10"
                    style={{ background: getAvatarColor(callPartner.username) + '22', border: `2px solid ${getAvatarColor(callPartner.username)}`, color: getAvatarColor(callPartner.username), boxShadow: `0 0 30px ${getAvatarColor(callPartner.username)}55` }}>
                    {callPartner.username[0].toUpperCase()}
                  </div>
                </div>
              )}

              {callState === 'connected' && callType === 'audio' && (
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold"
                  style={{ background: getAvatarColor(callPartner.username) + '22', border: `2px solid ${getAvatarColor(callPartner.username)}`, color: getAvatarColor(callPartner.username), animation: 'neonPulse 2s infinite', animationTimingFunction: 'ease-in-out' }}>
                  {callPartner.username[0].toUpperCase()}
                </div>
              )}

              <p className="text-white text-xl font-bold tracking-wide">{callPartner.username}</p>

              <p className="text-sm flex items-center gap-2" style={{ color: '#00ff9f99' }}>
                {callState === 'calling' && <><span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block" /> Ringing...</>}
                {callState === 'incoming' && <><span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse inline-block" /> Incoming {callType} call</>}
                {callState === 'connected' && <><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#00ff9f', boxShadow: '0 0 6px #00ff9f' }} /> {formatDur(callDuration)}</>}
              </p>
            </div>

            {/* Action buttons */}
            <div className="flex items-center justify-center gap-5 px-8 pb-8 pt-4 w-full">
              {callState === 'connected' && (
                <>
                  <button onClick={toggleMute}
                    className="w-12 h-12 rounded-full flex items-center justify-center neon-btn"
                    style={{ background: isMuted ? '#ff006e22' : '#0a1a12', border: `1px solid ${isMuted ? '#ff006e' : '#00ff9f33'}`, color: isMuted ? '#ff006e' : '#00ff9f' }}
                    title="Mute">
                    {isMuted
                      ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                      : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                    }
                  </button>

                  <button onClick={endCall}
                    className="w-14 h-14 rounded-full flex items-center justify-center neon-btn"
                    style={{ background: '#ff006e', boxShadow: '0 0 20px #ff006e88', color: 'white' }}
                    title="End call">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
                  </button>

                  {callType === 'video' && (
                    <button onClick={toggleCamera}
                      className="w-12 h-12 rounded-full flex items-center justify-center neon-btn"
                      style={{ background: isCameraOff ? '#ff006e22' : '#0a1a12', border: `1px solid ${isCameraOff ? '#ff006e' : '#00ff9f33'}`, color: isCameraOff ? '#ff006e' : '#00ff9f' }}
                      title="Camera">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {isCameraOff
                          ? <><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h2a2 2 0 0 1 2 2v9.34"/></> 
                          : <><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></>
                        }
                      </svg>
                    </button>
                  )}
                </>
              )}

              {callState === 'calling' && (
                <button onClick={endCall}
                  className="w-14 h-14 rounded-full flex items-center justify-center neon-btn"
                  style={{ background: '#ff006e', boxShadow: '0 0 20px #ff006e88', color: 'white' }}
                  title="Cancel">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
                </button>
              )}

              {callState === 'incoming' && (
                <>
                  <button onClick={rejectCall}
                    className="w-14 h-14 rounded-full flex items-center justify-center neon-btn"
                    style={{ background: '#ff006e22', border: '2px solid #ff006e', color: '#ff006e' }}
                    title="Decline">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
                  </button>
                  <button onClick={acceptCall}
                    className="w-14 h-14 rounded-full flex items-center justify-center neon-btn"
                    style={{ background: '#00ff9f22', border: '2px solid #00ff9f', color: '#00ff9f', boxShadow: '0 0 20px #00ff9f44' }}
                    title="Accept">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── SIDEBAR ───────────────────────────────────── */}
      <div className="w-[280px] flex flex-col shrink-0" style={{ background: '#07090e', borderRight: '1px solid #00ff9f18' }}>

        {/* App Header */}
        <div className="px-5 pt-5 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#00ff9f15', border: '1px solid #00ff9f44' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#00ff9f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div>
              <span className="font-bold text-sm tracking-widest" style={{ color: '#00ff9f', textShadow: '0 0 10px #00ff9f88' }}>CIPHER</span>
              <span className="font-bold text-sm tracking-widest text-white">CHAT</span>
            </div>
          </div>
          <button onClick={() => { logout(); navigate('/login'); }} title="Logout"
            className="w-8 h-8 flex items-center justify-center rounded-lg neon-btn" style={{ color: '#ff006e', border: '1px solid #ff006e33' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>

        {/* Profile */}
        <div className="mx-3 mb-3 p-3 rounded-xl flex items-center gap-3" style={{ background: '#00ff9f08', border: '1px solid #00ff9f18' }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
            style={{ background: getAvatarColor(currentUsername) + '22', border: `1.5px solid ${getAvatarColor(currentUsername)}`, color: getAvatarColor(currentUsername) }}>
            {currentUsername[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold truncate">{currentUsername}</p>
            <p className="text-xs flex items-center gap-1" style={{ color: '#00ff9f88' }}>
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: '#00ff9f', boxShadow: '0 0 5px #00ff9f' }} />
              Online — Encrypted
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: '#0d1117', border: '1px solid #00ff9f18' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00ff9f55" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search..." className="bg-transparent text-sm text-white placeholder-[#00ff9f33] focus:outline-none flex-1" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-3 mb-2">
          {['All','Unread','DMs'].map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="flex-1 text-xs py-1.5 rounded-lg font-medium tracking-wide transition-all"
              style={activeTab === tab
                ? { background: '#00ff9f18', color: '#00ff9f', border: '1px solid #00ff9f44' }
                : { color: '#00ff9f33', border: '1px solid transparent' }}>
              {tab}
            </button>
          ))}
        </div>

        {/* Users */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-2">
          {filteredUsers.length === 0 ? (
            <div className="text-center py-10"><p className="text-xs" style={{ color: '#00ff9f33' }}>NO USERS FOUND</p></div>
          ) : filteredUsers.map(u => (
            <div key={u._id}
              onClick={() => { setSelectedUser(u); setUnreadCounts(prev => ({ ...prev, [u._id]: 0 })); }}
              className="sidebar-user flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
              style={selectedUser?._id === u._id ? { background: '#00ff9f10', border: '1px solid #00ff9f33' } : { border: '1px solid transparent' }}>
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: getAvatarColor(u.username) + '22', border: `1.5px solid ${getAvatarColor(u.username)}`, color: getAvatarColor(u.username) }}>
                  {u.username[0].toUpperCase()}
                </div>
                {isOnline(u._id) && (
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2"
                    style={{ background: '#00ff9f', boxShadow: '0 0 6px #00ff9f', borderColor: '#07090e' }} />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white truncate">{u.username}</p>
                  {unreadCounts[u._id] > 0 && (
                    <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full text-xs flex items-center justify-center font-bold"
                      style={{ background: '#00ff9f', color: '#000', boxShadow: '0 0 8px #00ff9f88' }}>
                      {unreadCounts[u._id] > 9 ? '9+' : unreadCounts[u._id]}
                    </span>
                  )}
                </div>
                <p className="text-xs truncate mt-0.5" style={{ color: isOnline(u._id) ? '#00ff9f88' : '#ffffff22' }}>
                  {isOnline(u._id) ? '● ONLINE' : '○ offline'}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Nav */}
        <div className="px-3 py-3 flex items-center justify-around" style={{ borderTop: '1px solid #00ff9f18' }}>
          {[
            { id: 'chats', label: 'CHATS', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>, badge: 0 },
            { id: 'notifications', label: 'ALERTS', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>, badge: unreadNotifCount },
            { id: 'settings', label: 'CONFIG', icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>, badge: 0 },
          ].map(({ id, label, icon, badge }) => {
            const isActive = id === 'chats' ? activePanel === 'none' : activePanel === id;
            return (
              <button key={id} onClick={() => id !== 'chats' && togglePanel(id as ActivePanel)}
                className="flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg relative neon-btn"
                style={{ color: isActive ? '#00ff9f' : '#00ff9f33' }}>
                {badge > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full text-[9px] flex items-center justify-center font-bold"
                    style={{ background: '#ff006e', color: 'white', boxShadow: '0 0 8px #ff006e88' }}>
                    {badge}
                  </span>
                )}
                {icon}
                <span className="text-[9px] font-bold tracking-widest">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── NOTIFICATIONS PANEL ─────────────────── */}
      {activePanel === 'notifications' && (
        <div className="w-[260px] flex flex-col shrink-0" style={{ background: '#07090e', borderRight: '1px solid #00ff9f18' }}>
          <div className="px-5 pt-5 pb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold tracking-widest" style={{ color: '#00ff9f' }}>NOTIFICATIONS</h3>
            <button onClick={() => setNotifications(p => p.map(n => ({ ...n, read: true })))}
              className="text-[10px] tracking-wider neon-btn" style={{ color: '#00ff9f55' }}>CLEAR ALL</button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 space-y-2">
            {notifications.map(n => (
              <div key={n.id} className="p-3 rounded-xl"
                style={{ background: n.read ? 'transparent' : '#00ff9f08', border: `1px solid ${n.read ? '#00ff9f11' : '#00ff9f33'}` }}>
                <p className="text-xs" style={{ color: n.read ? '#ffffff44' : '#e0ffe0' }}>{n.text}</p>
                <p className="text-[10px] mt-1 tracking-wider" style={{ color: '#00ff9f33' }}>{n.time}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SETTINGS PANEL ──────────────────────── */}
      {activePanel === 'settings' && (
        <div className="w-[260px] flex flex-col shrink-0" style={{ background: '#07090e', borderRight: '1px solid #00ff9f18' }}>
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-xs font-bold tracking-widest" style={{ color: '#00ff9f' }}>CONFIG</h3>
          </div>
          <div className="flex-1 overflow-y-auto px-3 space-y-2 pb-4">
            {[
              { key: 'notifications', label: 'PUSH ALERTS' },
              { key: 'sounds', label: 'SOUND FX' },
              { key: 'encryption', label: 'E2E ENCRYPT' },
              { key: 'readReceipts', label: 'READ RECEIPTS' },
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between p-3 rounded-xl"
                style={{ background: '#0d1117', border: '1px solid #00ff9f18' }}>
                <span className="text-[11px] font-bold tracking-widest" style={{ color: '#00ff9f88' }}>{label}</span>
                <button onClick={() => setSettings(p => ({ ...p, [key]: !(p as any)[key] }))}
                  className="relative w-9 h-5 rounded-full toggle-switch"
                  style={{ background: (settings as any)[key] ? '#00ff9f' : '#1a1a2e' }}>
                  <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow toggle-thumb"
                    style={{ left: (settings as any)[key] ? '18px' : '2px', background: (settings as any)[key] ? '#050608' : '#ffffff66' }} />
                </button>
              </div>
            ))}
            <div className="p-3 rounded-xl" style={{ background: '#0d1117', border: '1px solid #00ff9f18' }}>
              <p className="text-[11px] font-bold tracking-widest mb-2" style={{ color: '#00ff9f88' }}>FONT SIZE</p>
              <div className="flex gap-1.5">
                {['small','medium','large'].map(size => (
                  <button key={size} onClick={() => setSettings(p => ({ ...p, fontSize: size }))}
                    className="flex-1 py-1.5 rounded-lg text-[10px] font-bold tracking-widest capitalize transition-all"
                    style={settings.fontSize === size
                      ? { background: '#00ff9f', color: '#050608' }
                      : { background: '#0a1a12', color: '#00ff9f55', border: '1px solid #00ff9f22' }}>
                    {size[0].toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CHAT AREA ────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#050608' }}>
        {selectedUser ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-3.5" style={{ background: '#07090e', borderBottom: '1px solid #00ff9f18' }}>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ background: getAvatarColor(selectedUser.username) + '22', border: `1.5px solid ${getAvatarColor(selectedUser.username)}`, color: getAvatarColor(selectedUser.username) }}>
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  {isOnline(selectedUser._id) && (
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2"
                      style={{ background: '#00ff9f', boxShadow: '0 0 6px #00ff9f', borderColor: '#07090e' }} />
                  )}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{selectedUser.username}</p>
                  <p className="text-xs" style={{ color: isTyping ? '#ffd700' : isOnline(selectedUser._id) ? '#00ff9f88' : '#ffffff22' }}>
                    {isTyping ? '▮ typing...' : isOnline(selectedUser._id) ? '◉ ONLINE' : '○ offline'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => startCall('audio')}
                  className="w-8 h-8 flex items-center justify-center rounded-lg neon-btn"
                  style={{ color: '#00ff9f', border: '1px solid #00ff9f33' }} title="Audio Call">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.71 3.35 2 2 0 0 1 3.71 1.19h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.86-.86a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z"/>
                  </svg>
                </button>
                <button onClick={() => startCall('video')}
                  className="w-8 h-8 flex items-center justify-center rounded-lg neon-btn"
                  style={{ color: '#00d4ff', border: '1px solid #00d4ff33' }} title="Video Call">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-1">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold"
                    style={{ background: getAvatarColor(selectedUser.username) + '15', border: `1px solid ${getAvatarColor(selectedUser.username)}44`, color: getAvatarColor(selectedUser.username) }}>
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  <p className="text-white font-semibold">{selectedUser.username}</p>
                  <p className="text-xs tracking-widest" style={{ color: '#00ff9f44' }}>ENCRYPTED CHANNEL OPEN — SAY HELLO</p>
                </div>
              ) : Object.entries(groupedMessages).map(([date, msgs]) => (
                <div key={date}>
                  <div className="flex items-center gap-3 py-3">
                    <div className="flex-1 h-px" style={{ background: '#00ff9f18' }} />
                    <span className="text-[10px] font-bold tracking-widest" style={{ color: '#00ff9f44' }}>{date}</span>
                    <div className="flex-1 h-px" style={{ background: '#00ff9f18' }} />
                  </div>
                  {msgs.map((msg, idx) => {
                    const isSent = String(msg.sender._id) === String(currentUserId);
                    const prevMsg = msgs[idx - 1];
                    const isConsecutive = prevMsg && String(prevMsg.sender._id) === String(msg.sender._id);
                    const fontSize = settings.fontSize === 'small' ? '12px' : settings.fontSize === 'large' ? '16px' : '14px';
                    return (
                      <div key={msg._id} className={`msg-in flex ${isSent ? 'justify-end' : 'justify-start'} ${isConsecutive ? 'mt-0.5' : 'mt-3'}`}>
                        {!isSent && (
                          <div className="w-7 shrink-0 mr-2 self-end">
                            {!isConsecutive && (
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                                style={{ background: getAvatarColor(msg.sender.username) + '22', border: `1px solid ${getAvatarColor(msg.sender.username)}`, color: getAvatarColor(msg.sender.username) }}>
                                {msg.sender.username[0].toUpperCase()}
                              </div>
                            )}
                          </div>
                        )}
                        <div className={`max-w-sm group flex flex-col ${isSent ? 'items-end' : 'items-start'}`}>
                          <div className="px-4 py-2.5 leading-relaxed"
                            style={{
                              fontSize, color: isSent ? '#050608' : '#c8ffe0',
                              borderRadius: isSent ? '16px 16px 3px 16px' : '16px 16px 16px 3px',
                              background: isSent ? '#00ff9f' : '#0d1117',
                              border: isSent ? 'none' : '1px solid #00ff9f22',
                              boxShadow: isSent ? '0 0 15px #00ff9f44' : 'none',
                              fontWeight: isSent ? 600 : 400,
                            }}>
                            {msg.message}
                          </div>
                          <p className="text-[10px] mt-1 px-1 tracking-wider opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ color: '#00ff9f44' }}>
                            {formatTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              {isTyping && (
                <div className="flex items-end gap-2 mt-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                    style={{ background: getAvatarColor(selectedUser.username) + '22', border: `1px solid ${getAvatarColor(selectedUser.username)}`, color: getAvatarColor(selectedUser.username) }}>
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  <div className="rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1 items-center"
                    style={{ background: '#0d1117', border: '1px solid #00ff9f22' }}>
                    {[0, 0.2, 0.4].map((d, i) => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full"
                        style={{ background: '#00ff9f', animation: `bounce 1.2s ${d}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-5 py-4" style={{ borderTop: '1px solid #00ff9f18' }}>
              <div className="flex items-center gap-3 rounded-2xl px-4 py-3" style={{ background: '#0d1117', border: '1px solid #00ff9f22' }}>
                <button className="shrink-0 neon-btn" style={{ color: '#00ff9f44' }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = '#00ff9f'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = '#00ff9f44'} title="Emoji">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
                  </svg>
                </button>
                <input type="text" value={newMessage} onChange={handleTyping} onKeyDown={handleKeyDown}
                  placeholder={`Message ${selectedUser.username}...`}
                  className="flex-1 bg-transparent text-white focus:outline-none text-sm"
                  style={{ caretColor: '#00ff9f' }}
                  onFocus={e => { e.currentTarget.parentElement!.style.borderColor = '#00ff9f88'; e.currentTarget.parentElement!.style.boxShadow = '0 0 12px #00ff9f22'; }}
                  onBlur={e => { e.currentTarget.parentElement!.style.borderColor = '#00ff9f22'; e.currentTarget.parentElement!.style.boxShadow = 'none'; }} />
                <button onClick={handleSendMessage} disabled={!newMessage.trim()}
                  className="w-8 h-8 rounded-xl flex items-center justify-center neon-btn shrink-0"
                  style={{
                    background: newMessage.trim() ? '#00ff9f' : '#0d1117',
                    color: newMessage.trim() ? '#050608' : '#00ff9f22',
                    border: newMessage.trim() ? 'none' : '1px solid #00ff9f22',
                    cursor: newMessage.trim() ? 'pointer' : 'not-allowed',
                  }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: '#00ff9f08', border: '1px solid #00ff9f22' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#00ff9f44" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <p className="text-white font-semibold">CIPHERCHAT</p>
              <p className="text-xs mt-2 tracking-widest" style={{ color: '#00ff9f33' }}>SELECT A USER TO BEGIN ENCRYPTED CHAT</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatPage;