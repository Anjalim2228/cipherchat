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

const avatarColors = ['#c0392b','#e74c3c','#a93226','#922b21','#cb4335','#b03a2e','#d45252','#8e1f1f'];
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

  const [callState, setCallState] = useState<CallState>('idle');
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCallData, setIncomingCallData] = useState<{ fromUserId: string; callerName: string; callType: 'audio' | 'video'; offer: RTCSessionDescriptionInit } | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);

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

  const createPeerConnection = useCallback((remoteUserId: string) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) { const socket = getSocket(); socket?.emit('call:ice-candidate', { toUserId: remoteUserId, candidate: e.candidate }); }
    };
    pc.ontrack = (e) => { if (remoteVideoRef.current) remoteVideoRef.current.srcObject = e.streams[0]; };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') endCall();
    };
    return pc;
  }, []);

  const getLocalStream = async (type: 'audio' | 'video') => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: type === 'video' });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      return stream;
    } catch (e) { console.error('Could not get media:', e); return null; }
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
    socket.emit('call:offer', { toUserId: selectedUser._id, offer, callType: type, callerName: (user as any)?.username });
  };

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
    if (targetId) { const socket = getSocket(); socket?.emit('call:end', { toUserId: targetId }); }
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
      socket.on('call:incoming', (data: any) => { setIncomingCallData(data); setCallState('incoming'); });
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
    getMessagesApi(selectedUser._id, token).then(data => setMessages(data.messages)).catch(console.error);
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
  const formatDur = (s: number) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

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
  const callerUser = incomingCallData ? users.find(u => u._id === incomingCallData.fromUserId) : null;
  const callPartner = callState === 'incoming' ? callerUser : selectedUser;

  return (
    <div className="h-screen flex overflow-hidden" style={{ fontFamily: "'Syne', 'Space Grotesk', sans-serif", background: '#070709' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=Space+Mono:wght@400;700&display=swap');
        * { box-sizing: border-box; }

        /* ── COLOUR TOKENS ── */
        :root {
          --bg-void:    #070709;
          --bg-base:    #0d0d0f;
          --bg-surface: #111114;
          --bg-raised:  #18181c;
          --bg-hover:   #1e1e23;

          --red-deep:   #8b0000;
          --red-core:   #c0181a;
          --red-bright: #e8222a;
          --red-hot:    #ff3b44;

          --chrome-dim: #5a5a6a;
          --chrome-mid: #9090a8;
          --chrome-hi:  #d0d0e8;
          --chrome-pure:#f0f0ff;

          --grad-red:   linear-gradient(135deg, #8b0000 0%, #e8222a 50%, #ff6b35 100%);
          --grad-chrome:linear-gradient(135deg, #3a3a50 0%, #9090a8 50%, #d0d0e8 100%);
          --grad-card:  linear-gradient(160deg, #161618 0%, #0d0d10 100%);

          --border-dim:    #ffffff08;
          --border-mid:    #ffffff14;
          --border-accent: #c0181a30;
          --border-hot:    #e8222a55;

          --text-primary:  #f0f0f8;
          --text-secondary:#9090a8;
          --text-muted:    #4a4a5a;
          --text-red:      #ff5058;
        }

        ::-webkit-scrollbar { width: 2px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--red-deep); border-radius: 4px; }

        @keyframes pulse-ring {
          0%   { transform: scale(0.8); opacity: 1; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @keyframes bounce-dot {
          0%, 60%, 100% { transform: translateY(0); }
          30%           { transform: translateY(-5px); }
        }
        @keyframes slide-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes shimmer {
          0%   { background-position: -200% center; }
          100% { background-position:  200% center; }
        }

        .msg-bubble { animation: slide-in 0.18s ease-out; }

        .user-row {
          display: flex; align-items: center; gap: 10px;
          padding: 9px 10px; border-radius: 10px; cursor: pointer;
          border: 1px solid transparent; transition: all 0.15s; margin-bottom: 2px;
        }
        .user-row:hover   { background: var(--bg-hover); border-color: var(--border-mid); }
        .user-row.active  { background: var(--bg-raised); border-color: var(--border-accent); }

        .tab-btn {
          flex: 1; padding: 5px 0; font-size: 10px; font-weight: 700;
          letter-spacing: 2px; border-radius: 7px; cursor: pointer;
          border: 1px solid transparent; text-align: center;
          color: var(--text-muted); background: transparent; transition: all 0.15s;
          font-family: 'Space Mono', monospace;
        }
        .tab-btn.active {
          background: var(--bg-raised); color: var(--red-bright);
          border-color: var(--border-accent);
          text-shadow: 0 0 12px var(--red-core);
        }

        .ctrl-btn {
          border: 1px solid var(--border-mid); background: var(--bg-raised);
          color: var(--chrome-mid); border-radius: 8px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s;
        }
        .ctrl-btn:hover { border-color: var(--border-hot); color: var(--red-bright); background: var(--bg-hover); }

        .toggle-track {
          width: 36px; height: 20px; border-radius: 10px; cursor: pointer;
          transition: background 0.2s; position: relative; border: none;
        }
        .toggle-thumb {
          position: absolute; top: 2px; width: 16px; height: 16px;
          border-radius: 50%; transition: left 0.2s;
        }

        .send-btn-active {
          background: var(--grad-red); border: none;
          color: #fff; border-radius: 10px; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          transition: all 0.15s;
        }
        .send-btn-active:hover { filter: brightness(1.15); }
        .send-btn-inactive {
          background: transparent; border: 1px solid var(--border-mid);
          color: var(--text-muted); border-radius: 10px; cursor: not-allowed;
          display: flex; align-items: center; justify-content: center;
        }

        .logo-text-cipher {
          background: var(--grad-red);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text; font-size: 13px; font-weight: 800; letter-spacing: 3px;
        }
        .logo-text-chat {
          font-size: 13px; font-weight: 800; letter-spacing: 3px;
          background: var(--grad-chrome);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .avatar-ring {
          border-radius: 50%; display: flex; align-items: center;
          justify-content: center; font-weight: 800; flex-shrink: 0;
          font-family: 'Space Mono', monospace;
        }

        .online-dot {
          position: absolute; bottom: 0; right: 0;
          width: 9px; height: 9px; border-radius: 50%;
          background: var(--red-bright);
          box-shadow: 0 0 6px var(--red-core);
          border: 2px solid var(--bg-base);
        }

        .unread-pill {
          min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px;
          background: var(--grad-red); color: #fff;
          font-size: 10px; font-weight: 700;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Space Mono', monospace;
        }

        .msg-sent {
          background: var(--grad-red); color: #fff; font-weight: 500;
          border-radius: 16px 16px 3px 16px; padding: 9px 14px;
          font-size: 13.5px; line-height: 1.55; max-width: 320px;
        }
        .msg-recv {
          background: var(--bg-raised); color: var(--text-primary);
          border: 1px solid var(--border-mid);
          border-radius: 16px 16px 16px 3px; padding: 9px 14px;
          font-size: 13.5px; line-height: 1.55; max-width: 320px;
        }

        .input-field {
          background: var(--bg-surface); border: 1px solid var(--border-mid);
          border-radius: 12px; padding: 11px 14px;
          display: flex; align-items: center; gap: 10px;
          transition: border-color 0.2s;
        }
        .input-field:focus-within {
          border-color: var(--red-core);
          box-shadow: 0 0 0 3px var(--red-deep)22;
        }
        .input-field input {
          flex: 1; background: none; border: none; outline: none;
          font-size: 13px; color: var(--text-primary);
          font-family: 'Syne', sans-serif;
          caret-color: var(--red-bright);
        }
        .input-field input::placeholder { color: var(--text-muted); }

        .nav-btn {
          display: flex; flex-direction: column; align-items: center;
          gap: 4px; padding: 6px 12px; border-radius: 8px;
          cursor: pointer; color: var(--text-muted);
          position: relative; border: none; background: transparent;
          transition: color 0.15s; font-family: 'Space Mono', monospace;
        }
        .nav-btn.active  { color: var(--red-bright); }
        .nav-btn:hover   { color: var(--chrome-mid); }
        .nav-badge {
          position: absolute; top: 0; right: 4px;
          min-width: 16px; height: 16px; border-radius: 8px;
          background: var(--grad-red); color: #fff;
          font-size: 8px; font-weight: 700;
          display: flex; align-items: center; justify-content: center; padding: 0 4px;
        }

        .notif-card {
          padding: 12px; border-radius: 10px; margin-bottom: 6px;
          transition: all 0.15s;
        }
        .notif-card.unread {
          background: var(--bg-raised); border: 1px solid var(--border-accent);
        }
        .notif-card.read {
          background: transparent; border: 1px solid var(--border-dim);
        }

        .settings-row {
          display: flex; align-items: center; justify-content: space-between;
          padding: 12px 14px; border-radius: 10px; margin-bottom: 6px;
          background: var(--bg-surface); border: 1px solid var(--border-dim);
        }

        .call-ring-anim {
          position: absolute; width: 72px; height: 72px; border-radius: 50%;
          border: 1.5px solid var(--red-bright);
          animation: pulse-ring 2s ease-out infinite;
        }

        .enc-tag {
          display: flex; align-items: center; justify-content: center; gap: 6px;
          padding: 4px 0; border-bottom: 1px solid var(--border-dim);
          background: var(--bg-base);
        }
        .enc-tag span {
          font-size: 9px; letter-spacing: 2.5px; color: var(--text-muted);
          font-family: 'Space Mono', monospace; font-weight: 700;
        }

        .date-divider {
          display: flex; align-items: center; gap: 10px; margin: 12px 0;
        }
        .date-divider-line { flex: 1; height: 1px; background: var(--border-dim); }
        .date-divider-label {
          font-size: 9px; font-weight: 700; letter-spacing: 2px;
          color: var(--text-muted); font-family: 'Space Mono', monospace;
        }

        .profile-block {
          margin: 8px 10px; padding: 10px 12px; border-radius: 10px;
          background: var(--bg-raised); border: 1px solid var(--border-accent);
          display: flex; align-items: center; gap: 10px;
        }

        .search-wrap {
          margin: 0 10px 8px; padding: 8px 12px;
          background: var(--bg-surface); border: 1px solid var(--border-dim);
          border-radius: 9px; display: flex; align-items: center; gap: 8px;
          transition: border-color 0.2s;
        }
        .search-wrap:focus-within { border-color: var(--border-accent); }
        .search-wrap input {
          flex: 1; background: none; border: none; outline: none;
          font-size: 12px; color: var(--text-primary);
          font-family: 'Syne', sans-serif;
        }
        .search-wrap input::placeholder { color: var(--text-muted); }
      `}</style>

      {/* ── CALL MODAL ── */}
      {callState !== 'idle' && callPartner && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.95)', backdropFilter: 'blur(20px)' }}>
          <div style={{ width: 380, borderRadius: 20, overflow: 'hidden', background: 'linear-gradient(160deg,#101012,#080809)', border: '1px solid var(--border-accent)', boxShadow: '0 0 80px #8b000033, 0 40px 100px rgba(0,0,0,0.9)' }}>
            {/* Modal header */}
            <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-dim)' }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 3, color: 'var(--text-muted)', fontFamily: "'Space Mono', monospace" }}>
                {callState === 'calling' ? '◉ OUTGOING' : callState === 'incoming' ? '◉ INCOMING' : '◉ CONNECTED'} — {callType.toUpperCase()}
              </span>
              <span style={{ fontSize: 9, letterSpacing: 2, color: 'var(--red-core)', fontFamily: "'Space Mono', monospace" }}>E2E ENCRYPTED</span>
            </div>

            {callType === 'video' && callState === 'connected' && (
              <div style={{ width: '100%', height: 200, background: '#050507', position: 'relative' }}>
                <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'none' }} />
                <div style={{ position: 'absolute', bottom: 10, right: 10, width: 80, height: 108, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border-accent)' }}>
                  <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 24px 12px', gap: 10 }}>
              {(callState === 'calling' || callState === 'incoming') && (
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                  {[0, 0.6, 1.2].map(delay => (
                    <div key={delay} className="call-ring-anim" style={{ animationDelay: `${delay}s` }} />
                  ))}
                  <div className="avatar-ring" style={{ width: 64, height: 64, fontSize: 22, background: `${getAvatarColor(callPartner.username)}18`, border: `2px solid ${getAvatarColor(callPartner.username)}`, color: getAvatarColor(callPartner.username), position: 'relative', zIndex: 1 }}>
                    {callPartner.username[0].toUpperCase()}
                  </div>
                </div>
              )}
              {callState === 'connected' && callType === 'audio' && (
                <div className="avatar-ring" style={{ width: 64, height: 64, fontSize: 22, background: `${getAvatarColor(callPartner.username)}18`, border: `2px solid ${getAvatarColor(callPartner.username)}`, color: getAvatarColor(callPartner.username) }}>
                  {callPartner.username[0].toUpperCase()}
                </div>
              )}
              <p style={{ color: 'var(--text-primary)', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>{callPartner.username}</p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                {callState === 'calling' && <><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red-bright)', display: 'inline-block', animation: 'pulse-ring 1s infinite' }} />Ringing...</>}
                {callState === 'incoming' && <><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red-bright)', display: 'inline-block', animation: 'pulse-ring 1s infinite' }} />Incoming {callType} call</>}
                {callState === 'connected' && <><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--red-bright)', display: 'inline-block', boxShadow: '0 0 6px var(--red-bright)' }} />{formatDur(callDuration)}</>}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '12px 24px 28px' }}>
              {callState === 'connected' && (
                <>
                  <button onClick={toggleMute} className="ctrl-btn" style={{ width: 48, height: 48, ...(isMuted ? { background: '#ff000022', borderColor: '#ff3b44', color: '#ff3b44' } : {}) }}>
                    {isMuted
                      ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                      : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>}
                  </button>
                  <button onClick={endCall} style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--grad-red)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 0 24px var(--red-deep)' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
                  </button>
                  {callType === 'video' && (
                    <button onClick={toggleCamera} className="ctrl-btn" style={{ width: 48, height: 48, ...(isCameraOff ? { background: '#ff000022', borderColor: '#ff3b44', color: '#ff3b44' } : {}) }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        {isCameraOff
                          ? <><line x1="1" y1="1" x2="23" y2="23"/><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h2a2 2 0 0 1 2 2v9.34"/></>
                          : <><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></>}
                      </svg>
                    </button>
                  )}
                </>
              )}
              {callState === 'calling' && (
                <button onClick={endCall} style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--grad-red)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 0 24px var(--red-deep)' }}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
                </button>
              )}
              {callState === 'incoming' && (
                <>
                  <button onClick={rejectCall} style={{ width: 56, height: 56, borderRadius: '50%', background: '#ff000018', border: '2px solid var(--red-bright)', color: 'var(--red-bright)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
                  </button>
                  <button onClick={acceptCall} style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--grad-red)', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 0 24px var(--red-deep)' }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z"/></svg>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── SIDEBAR ── */}
      <div style={{ width: 272, minWidth: 272, background: 'var(--bg-base)', borderRight: '1px solid var(--border-dim)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '16px 14px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-dim)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--bg-raised)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--red-bright)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 0 }}>
              <span className="logo-text-cipher">CIPHER</span>
              <span className="logo-text-chat">CHAT</span>
            </div>
          </div>
          <button onClick={() => { logout(); navigate('/login'); }} className="ctrl-btn" style={{ width: 28, height: 28, color: 'var(--text-red)', borderColor: '#ff3b4422' }} title="Logout">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          </button>
        </div>

        {/* Profile */}
        <div className="profile-block">
          <div className="avatar-ring" style={{ width: 36, height: 36, fontSize: 13, background: `${getAvatarColor(currentUsername)}18`, border: `1.5px solid ${getAvatarColor(currentUsername)}`, color: getAvatarColor(currentUsername) }}>
            {currentUsername[0].toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, margin: 0 }}>{currentUsername}</p>
            <p style={{ fontSize: 11, color: 'var(--red-core)', display: 'flex', alignItems: 'center', gap: 4, margin: '2px 0 0' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--red-bright)', boxShadow: '0 0 5px var(--red-bright)', display: 'inline-block' }} />
              Online — Encrypted
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="search-wrap">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search..." />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, padding: '0 10px 8px' }}>
          {['All', 'Unread', 'DMs'].map(tab => (
            <button key={tab} className={`tab-btn${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>{tab.toUpperCase()}</button>
          ))}
        </div>

        {/* User list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 6px 6px' }}>
          {filteredUsers.length === 0
            ? <div style={{ textAlign: 'center', paddingTop: 32, color: 'var(--text-muted)', fontSize: 11, letterSpacing: 2, fontFamily: "'Space Mono', monospace" }}>NO USERS</div>
            : filteredUsers.map(u => (
              <div key={u._id} className={`user-row${selectedUser?._id === u._id ? ' active' : ''}`}
                onClick={() => { setSelectedUser(u); setUnreadCounts(prev => ({ ...prev, [u._id]: 0 })); }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <div className="avatar-ring" style={{ width: 38, height: 38, fontSize: 13, background: `${getAvatarColor(u.username)}15`, border: `1.5px solid ${getAvatarColor(u.username)}`, color: getAvatarColor(u.username) }}>
                    {u.username[0].toUpperCase()}
                  </div>
                  {isOnline(u._id) && <div className="online-dot" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <p style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.username}</p>
                    {(unreadCounts[u._id] ?? 0) > 0 && (
                      <div className="unread-pill">{unreadCounts[u._id] > 9 ? '9+' : unreadCounts[u._id]}</div>
                    )}
                  </div>
                  <p style={{ fontSize: 11, marginTop: 2, color: isOnline(u._id) ? 'var(--red-core)' : 'var(--text-muted)' }}>
                    {isOnline(u._id) ? '● Online' : '○ Offline'}
                  </p>
                </div>
              </div>
            ))}
        </div>

        {/* Bottom nav */}
        <div style={{ borderTop: '1px solid var(--border-dim)', padding: '8px 4px', display: 'flex', justifyContent: 'space-around' }}>
          {[
            {
              id: 'chats', label: 'CHATS', badge: 0,
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
            },
            {
              id: 'notifications', label: 'ALERTS', badge: unreadNotifCount,
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
            },
            {
              id: 'settings', label: 'CONFIG', badge: 0,
              icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            },
          ].map(({ id, label, badge, icon }) => {
            const isActive = id === 'chats' ? activePanel === 'none' : activePanel === id;
            return (
              <button key={id} className={`nav-btn${isActive ? ' active' : ''}`}
                onClick={() => id !== 'chats' && togglePanel(id as ActivePanel)}>
                {badge > 0 && <div className="nav-badge">{badge}</div>}
                {icon}
                <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 2 }}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── NOTIFICATIONS PANEL ── */}
      {activePanel === 'notifications' && (
        <div style={{ width: 256, minWidth: 256, background: 'var(--bg-base)', borderRight: '1px solid var(--border-dim)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 16px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-dim)' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 3, color: 'var(--red-bright)', fontFamily: "'Space Mono', monospace" }}>NOTIFICATIONS</span>
            <button onClick={() => setNotifications(p => p.map(n => ({ ...n, read: true })))}
              style={{ fontSize: 9, letterSpacing: 2, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: "'Space Mono', monospace" }}>
              CLEAR ALL
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
            {notifications.map(n => (
              <div key={n.id} className={`notif-card ${n.read ? 'read' : 'unread'}`}>
                <p style={{ fontSize: 12, color: n.read ? 'var(--text-muted)' : 'var(--text-primary)', margin: 0 }}>{n.text}</p>
                <p style={{ fontSize: 9, marginTop: 5, letterSpacing: 2, color: 'var(--text-muted)', fontFamily: "'Space Mono', monospace" }}>{n.time}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SETTINGS PANEL ── */}
      {activePanel === 'settings' && (
        <div style={{ width: 256, minWidth: 256, background: 'var(--bg-base)', borderRight: '1px solid var(--border-dim)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid var(--border-dim)' }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 3, color: 'var(--red-bright)', fontFamily: "'Space Mono', monospace" }}>CONFIG</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 10px' }}>
            {[
              { key: 'notifications', label: 'PUSH ALERTS' },
              { key: 'sounds', label: 'SOUND FX' },
              { key: 'encryption', label: 'E2E ENCRYPT' },
              { key: 'readReceipts', label: 'READ RECEIPTS' },
            ].map(({ key, label }) => (
              <div key={key} className="settings-row">
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: 'var(--text-secondary)', fontFamily: "'Space Mono', monospace" }}>{label}</span>
                <button className="toggle-track"
                  style={{ background: (settings as any)[key] ? 'var(--red-deep)' : 'var(--bg-hover)' }}
                  onClick={() => setSettings(p => ({ ...p, [key]: !(p as any)[key] }))}>
                  <span className="toggle-thumb"
                    style={{ left: (settings as any)[key] ? '18px' : '2px', background: (settings as any)[key] ? 'var(--red-bright)' : 'var(--chrome-dim)' }} />
                </button>
              </div>
            ))}
            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: 'var(--text-secondary)', fontFamily: "'Space Mono', monospace" }}>FONT SIZE</span>
              <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                {['small', 'medium', 'large'].map(sz => (
                  <button key={sz} onClick={() => setSettings(p => ({ ...p, fontSize: sz }))}
                    style={{
                      flex: 1, padding: '6px 0', borderRadius: 7, fontSize: 10, fontWeight: 700,
                      letterSpacing: 1, textTransform: 'capitalize', cursor: 'pointer',
                      fontFamily: "'Space Mono', monospace",
                      ...(settings.fontSize === sz
                        ? { background: 'var(--grad-red)', color: '#fff', border: 'none' }
                        : { background: 'var(--bg-hover)', color: 'var(--text-muted)', border: '1px solid var(--border-mid)' })
                    }}>
                    {sz[0].toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CHAT AREA ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-void)' }}>
        {selectedUser ? (
          <>
            {/* Chat header */}
            <div style={{ padding: '12px 20px', background: 'var(--bg-base)', borderBottom: '1px solid var(--border-dim)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ position: 'relative' }}>
                  <div className="avatar-ring" style={{ width: 36, height: 36, fontSize: 13, background: `${getAvatarColor(selectedUser.username)}15`, border: `1.5px solid ${getAvatarColor(selectedUser.username)}`, color: getAvatarColor(selectedUser.username) }}>
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  {isOnline(selectedUser._id) && <div className="online-dot" style={{ borderColor: 'var(--bg-base)' }} />}
                </div>
                <div>
                  <p style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, margin: 0 }}>{selectedUser.username}</p>
                  <p style={{ fontSize: 11, margin: '2px 0 0', color: isTyping ? 'var(--red-bright)' : isOnline(selectedUser._id) ? 'var(--red-core)' : 'var(--text-muted)' }}>
                    {isTyping ? '▮ typing...' : isOnline(selectedUser._id) ? '◉ Online' : '○ Offline'}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => startCall('audio')} className="ctrl-btn" style={{ width: 32, height: 32 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.71 3.35 2 2 0 0 1 3.71 1.19h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.86-.86a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z" /></svg>
                </button>
                <button onClick={() => startCall('video')} className="ctrl-btn" style={{ width: 32, height: 32 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                </button>
              </div>
            </div>

            {/* Encryption tag */}
            <div className="enc-tag">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              <span>END-TO-END ENCRYPTED — ALL MESSAGES ARE PRIVATE</span>
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 2 }}>
              {messages.length === 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
                  <div className="avatar-ring" style={{ width: 60, height: 60, fontSize: 22, background: `${getAvatarColor(selectedUser.username)}12`, border: `1px solid ${getAvatarColor(selectedUser.username)}44`, color: getAvatarColor(selectedUser.username) }}>
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  <p style={{ color: 'var(--text-primary)', fontWeight: 600, margin: 0 }}>{selectedUser.username}</p>
                  <p style={{ fontSize: 10, letterSpacing: 2, color: 'var(--text-muted)', fontFamily: "'Space Mono', monospace", margin: 0 }}>ENCRYPTED CHANNEL OPEN — SAY HELLO</p>
                </div>
              ) : Object.entries(groupedMessages).map(([date, msgs]) => (
                <div key={date}>
                  <div className="date-divider">
                    <div className="date-divider-line" />
                    <span className="date-divider-label">{date}</span>
                    <div className="date-divider-line" />
                  </div>
                  {msgs.map((msg, idx) => {
                    const isSent = String(msg.sender._id) === String(currentUserId);
                    const prevMsg = msgs[idx - 1];
                    const isConsecutive = prevMsg && String(prevMsg.sender._id) === String(msg.sender._id);
                    const fontSize = settings.fontSize === 'small' ? '12px' : settings.fontSize === 'large' ? '16px' : '13.5px';
                    return (
                      <div key={msg._id} className="msg-bubble" style={{ display: 'flex', justifyContent: isSent ? 'flex-end' : 'flex-start', alignItems: 'flex-end', gap: 8, marginTop: isConsecutive ? 2 : 12 }}>
                        {!isSent && (
                          <div style={{ width: 26, flexShrink: 0 }}>
                            {!isConsecutive && (
                              <div className="avatar-ring" style={{ width: 26, height: 26, fontSize: 10, background: `${getAvatarColor(msg.sender.username)}15`, border: `1px solid ${getAvatarColor(msg.sender.username)}`, color: getAvatarColor(msg.sender.username) }}>
                                {msg.sender.username[0].toUpperCase()}
                              </div>
                            )}
                          </div>
                        )}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: isSent ? 'flex-end' : 'flex-start', maxWidth: 320 }}>
                          <div className={isSent ? 'msg-sent' : 'msg-recv'} style={{ fontSize }}>
                            {msg.message}
                          </div>
                          <p style={{ fontSize: 9, marginTop: 3, color: 'var(--text-muted)', letterSpacing: 1, opacity: 0, transition: 'opacity 0.2s', fontFamily: "'Space Mono', monospace" }}
                            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '0')}>
                            {formatTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Typing indicator */}
              {isTyping && (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 10 }}>
                  <div className="avatar-ring" style={{ width: 26, height: 26, fontSize: 10, flexShrink: 0, background: `${getAvatarColor(selectedUser.username)}15`, border: `1px solid ${getAvatarColor(selectedUser.username)}`, color: getAvatarColor(selectedUser.username) }}>
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-mid)', borderRadius: '14px 14px 14px 3px', padding: '10px 14px', display: 'flex', gap: 5, alignItems: 'center' }}>
                    {[0, 0.2, 0.4].map((d, i) => (
                      <div key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--red-bright)', animation: `bounce-dot 1.2s ${d}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-dim)' }}>
              <div className="input-field">
                <button style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                </button>
                <input type="text" value={newMessage} onChange={handleTyping} onKeyDown={handleKeyDown}
                  placeholder={`Message ${selectedUser.username}...`} />
                <button onClick={handleSendMessage} disabled={!newMessage.trim()}
                  className={newMessage.trim() ? 'send-btn-active' : 'send-btn-inactive'}
                  style={{ width: 32, height: 32 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ width: 60, height: 60, borderRadius: 16, background: 'var(--bg-raised)', border: '1px solid var(--border-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--red-deep)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 0, marginBottom: 8 }}>
                <span className="logo-text-cipher" style={{ fontSize: 18 }}>CIPHER</span>
                <span className="logo-text-chat" style={{ fontSize: 18 }}>CHAT</span>
              </div>
              <p style={{ fontSize: 10, letterSpacing: 2, color: 'var(--text-muted)', fontFamily: "'Space Mono', monospace" }}>SELECT A USER TO BEGIN ENCRYPTED CHAT</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatPage;