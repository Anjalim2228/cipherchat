import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { initializeSocket, getSocket } from '../socket/socket';
import { getUsersApi, getMessagesApi } from '../api/authApi';

interface User {
  _id: string;
  username: string;
  email: string;
  avatar?: string;
  isOnline?: boolean;
}

interface Message {
  _id: string;
  sender: { _id: string; username: string };
  receiver: { _id: string; username: string };
  message: string;
  createdAt: string;
  isRead: boolean;
}

type CallState = 'idle' | 'calling' | 'incoming' | 'connected';
type ActivePanel = 'none' | 'settings' | 'notifications';

const avatarColors = [
  '#A88F6A', '#8E94A3', '#6F7785', '#B39B7B',
  '#7D8A96', '#9C8F7A', '#5E6876', '#A6A9B2'
];

const getAvatarColor = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
};

const fakeNotifications = [
  { id: '1', text: 'New user joined the workspace', time: '2m ago', read: false },
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
  const [settings, setSettings] = useState({
    notifications: true,
    sounds: true,
    encryption: true,
    readReceipts: true,
    fontSize: 'medium'
  });

  const [callState, setCallState] = useState<CallState>('idle');
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [callDuration, setCallDuration] = useState(0);
  const [incomingCallData, setIncomingCallData] = useState<{
    fromUserId: string;
    callerName: string;
    callType: 'audio' | 'video';
    offer: RTCSessionDescriptionInit;
  } | null>(null);
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
    try {
      const data = await getUsersApi(token);
      setUsers(data.users);
    } catch (e) {
      console.error(e);
    }
  }, [token]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const createPeerConnection = useCallback((remoteUserId: string) => {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    peerConnectionRef.current = pc;
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        const socket = getSocket();
        socket?.emit('call:ice-candidate', { toUserId: remoteUserId, candidate: e.candidate });
      }
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
      socket.on('userTyping', (data: { userId: string }) => { setTypingUsers(prev => [...new Set([...prev, data.userId])]); });
      socket.on('userStopTyping', (data: { userId: string }) => { setTypingUsers(prev => prev.filter(id => id !== data.userId)); });
      socket.on('call:incoming', (data: any) => { setIncomingCallData(data); setCallState('incoming'); });
      socket.on('call:answered', async (data: { answer: RTCSessionDescriptionInit }) => {
        await peerConnectionRef.current?.setRemoteDescription(new RTCSessionDescription(data.answer));
        setCallState('connected');
        startCallTimer();
      });
      socket.on('call:ice-candidate', async (data: { candidate: RTCIceCandidateInit }) => {
        try { await peerConnectionRef.current?.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch {}
      });
      socket.on('call:rejected', () => cleanupCall());
      socket.on('call:ended', () => cleanupCall());
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const formatTime = (d: string) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formatDate = (d: string) => {
    const date = new Date(d);
    const today = new Date();
    const diff = today.getDate() - date.getDate();
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
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
    acc[key].push(msg);
    return acc;
  }, {} as Record<string, Message[]>);
  const unreadNotifCount = notifications.filter(n => !n.read).length;
  const togglePanel = (p: ActivePanel) => setActivePanel(prev => prev === p ? 'none' : p);
  const callerUser = incomingCallData ? users.find(u => u._id === incomingCallData.fromUserId) : null;
  const callPartner = callState === 'incoming' ? callerUser : selectedUser;

  return (
    <div className="app-root" style={{ fontFamily: "'Inter', 'DM Sans', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --bg-app: #070707;
          --bg-surface: rgba(21, 21, 21, 0.86);
          --bg-elevated: rgba(28, 28, 28, 0.94);
          --bg-hover: rgba(38, 38, 38, 0.98);
          --bg-active: rgba(46, 46, 46, 1);

          --accent: #c2a772;
          --accent-2: #d8c7a6;
          --accent-dim: rgba(194, 167, 114, 0.15);
          --accent-glow: rgba(194, 167, 114, 0.10);

          --green: #9bc2a4;
          --green-dim: rgba(155, 194, 164, 0.14);
          --red: #d28c8c;
          --red-dim: rgba(210, 140, 140, 0.14);

          --text-primary: #f4f1eb;
          --text-secondary: #c6c0b8;
          --text-muted: #8e8780;
          --text-disabled: #625d57;

          --border: rgba(255, 255, 255, 0.07);
          --border-mid: rgba(255, 255, 255, 0.12);
          --border-focus: rgba(194, 167, 114, 0.32);

          --shadow-sm: 0 1px 2px rgba(0,0,0,0.35);
          --shadow-md: 0 10px 30px rgba(0,0,0,0.42);
          --shadow-lg: 0 24px 80px rgba(0,0,0,0.65);
          --shadow-accent: 0 10px 30px rgba(194,167,114,0.16);
        }

        .app-root {
          height: 100vh;
          display: flex;
          overflow: hidden;
          color: var(--text-primary);
          background:
            radial-gradient(circle at 15% 10%, rgba(194,167,114,0.08), transparent 22%),
            radial-gradient(circle at 85% 18%, rgba(216,199,166,0.05), transparent 18%),
            linear-gradient(135deg, #050505 0%, #0a0a0a 50%, #080808 100%);
        }

        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.10); border-radius: 999px; }

        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulse-ring { 0% { transform: scale(1); opacity: 0.45; } 100% { transform: scale(2.2); opacity: 0; } }
        @keyframes shimmer-in { from { opacity: 0; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
        .msg-bubble { animation: fadeUp 0.18s ease-out; }

        .sidebar {
          width: 300px;
          min-width: 300px;
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: linear-gradient(180deg, rgba(18,18,18,0.94), rgba(12,12,12,0.96));
          border-right: 1px solid var(--border);
          box-shadow: inset -1px 0 0 rgba(255,255,255,0.02);
        }

        .sidebar-header, .panel-header {
          padding: 18px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border);
        }

        .logo-mark { display: flex; align-items: center; gap: 10px; }
        .logo-icon {
          width: 34px; height: 34px; border-radius: 14px;
          background: linear-gradient(145deg, rgba(194,167,114,0.22), rgba(255,255,255,0.04));
          border: 1px solid rgba(194,167,114,0.25);
          display: flex; align-items: center; justify-content: center;
          box-shadow: var(--shadow-accent);
        }
        .logo-text { font-size: 15px; font-weight: 800; letter-spacing: -0.5px; }
        .logo-text span { color: var(--accent); }

        .icon-btn {
          width: 34px; height: 34px;
          border-radius: 14px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.02);
          color: var(--text-muted);
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: .15s ease;
        }
        .icon-btn:hover {
          transform: translateY(-1px);
          background: var(--bg-hover);
          border-color: var(--border-mid);
          color: var(--text-primary);
        }
        .icon-btn.danger:hover { background: var(--red-dim); color: var(--red); }

        .profile-row {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px;
          border-bottom: 1px solid var(--border);
        }

        .search-wrap {
          margin: 14px 12px 8px;
          padding: 11px 13px;
          border-radius: 18px;
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--border);
          display: flex; align-items: center; gap: 10px;
        }
        .search-wrap:focus-within { border-color: var(--border-focus); box-shadow: 0 0 0 4px var(--accent-dim); }
        .search-wrap input {
          flex: 1; border: none; outline: none; background: none;
          font-size: 13px; color: var(--text-primary);
          font-family: 'DM Sans', sans-serif;
        }
        .search-wrap input::placeholder { color: var(--text-muted); }

        .tabs-row { display: flex; gap: 8px; padding: 0 12px 12px; }
        .tab-btn {
          flex: 1;
          padding: 9px 0;
          border-radius: 14px;
          cursor: pointer;
          border: 1px solid transparent;
          background: rgba(255,255,255,0.02);
          color: var(--text-muted);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.4px;
          text-transform: uppercase;
        }
        .tab-btn.active {
          background: linear-gradient(135deg, rgba(194,167,114,0.16), rgba(255,255,255,0.04));
          border-color: rgba(194,167,114,0.18);
          color: var(--text-primary);
        }

        .users-list { flex: 1; overflow-y: auto; padding: 4px 10px 10px; }
        .user-row {
          display: flex; align-items: center; gap: 12px;
          padding: 12px;
          margin-bottom: 8px;
          border-radius: 20px;
          background: rgba(255,255,255,0.02);
          border: 1px solid transparent;
          cursor: pointer;
          transition: .14s ease;
        }
        .user-row:hover { transform: translateY(-1px); background: var(--bg-hover); }
        .user-row.active {
          background: linear-gradient(135deg, rgba(194,167,114,0.12), rgba(255,255,255,0.03));
          border-color: rgba(194,167,114,0.16);
        }

        .avatar {
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-weight: 800; flex-shrink: 0;
          font-family: 'DM Mono', monospace;
          position: relative;
        }
        .avatar-online::after {
          content: '';
          position: absolute; bottom: 0; right: 0;
          width: 9px; height: 9px; border-radius: 50%;
          background: var(--green);
          border: 2px solid var(--bg-surface);
          box-shadow: 0 0 0 2px rgba(155,194,164,0.12);
        }

        .unread-badge {
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #0c0c0c;
          font-size: 10px;
          font-weight: 900;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .bottom-nav {
          border-top: 1px solid var(--border);
          padding: 10px;
          display: flex;
          gap: 8px;
          background: rgba(0,0,0,0.25);
        }

        .nav-btn {
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 10px 4px;
          border-radius: 16px;
          cursor: pointer;
          color: var(--text-muted);
          border: 1px solid transparent;
          background: rgba(255,255,255,0.02);
          transition: .15s ease;
          position: relative;
        }
        .nav-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
        .nav-btn.active {
          background: linear-gradient(135deg, rgba(194,167,114,0.16), rgba(255,255,255,0.03));
          border-color: rgba(194,167,114,0.16);
          color: var(--text-primary);
        }
        .nav-btn-label {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.55px;
          text-transform: uppercase;
        }
        .nav-badge {
          position: absolute;
          top: 5px;
          right: 6px;
          min-width: 14px;
          height: 14px;
          border-radius: 999px;
          background: var(--accent);
          color: #0b0b0b;
          font-size: 8px;
          font-weight: 900;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .side-panel {
          width: 280px;
          min-width: 280px;
          height: 100vh;
          display: flex;
          flex-direction: column;
          background: linear-gradient(180deg, rgba(18,18,18,0.94), rgba(12,12,12,0.96));
          border-right: 1px solid var(--border);
          animation: shimmer-in 0.2s ease-out;
        }

        .panel-title {
          font-size: 13px;
          font-weight: 800;
          color: var(--text-primary);
        }

        .notif-card, .settings-row {
          margin: 0 10px 8px;
          border-radius: 20px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.025);
        }

        .notif-card { padding: 12px 14px; }
        .notif-card.unread { background: rgba(194,167,114,0.08); }
        .notif-card.read { opacity: 0.55; }
        .notif-text { font-size: 12.5px; line-height: 1.55; color: var(--text-primary); }
        .notif-time { font-size: 10px; color: var(--text-muted); margin-top: 4px; font-family: 'DM Mono', monospace; }

        .settings-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
        }
        .settings-label { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
        .toggle-track {
          width: 38px; height: 20px;
          border-radius: 999px;
          position: relative;
          border: none;
          cursor: pointer;
        }
        .toggle-thumb {
          position: absolute;
          top: 2px;
          width: 16px;
          height: 16px;
          border-radius: 50%;
          transition: left 0.2s;
        }

        .chat-area {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background:
            radial-gradient(circle at 50% 0%, rgba(194,167,114,0.06), transparent 26%),
            linear-gradient(180deg, rgba(255,255,255,0.01), rgba(0,0,0,0.10));
        }

        .top-strip {
          height: 42px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 18px;
          border-bottom: 1px solid var(--border);
          background: rgba(255,255,255,0.01);
          flex-shrink: 0;
        }
        .top-chip {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 7px 12px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.02);
          font-size: 11px;
          color: var(--text-secondary);
        }

        .chat-header {
          padding: 0 18px;
          height: 72px;
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }
        .chat-header-left { display: flex; align-items: center; gap: 12px; }
        .chat-header-actions { display: flex; gap: 8px; }
        .chat-username { font-size: 15px; font-weight: 800; }
        .chat-substatus { font-size: 11px; margin-top: 2px; }

        .enc-strip {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 6px 0;
          border-bottom: 1px solid var(--border);
          background: rgba(255,255,255,0.01);
        }
        .enc-label {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-muted);
          letter-spacing: 0.65px;
          font-family: 'DM Mono', monospace;
          text-transform: uppercase;
        }

        .messages-scroll {
          flex: 1;
          overflow-y: auto;
          padding: 24px 24px 18px;
          display: flex;
          flex-direction: column;
        }

        .date-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 16px 0 14px;
        }
        .date-divider-line { flex: 1; height: 1px; background: var(--border); }
        .date-divider-label {
          font-size: 10px;
          font-weight: 700;
          color: var(--text-muted);
          letter-spacing: 0.6px;
          font-family: 'DM Mono', monospace;
          white-space: nowrap;
        }

        .msg-row { display: flex; align-items: flex-end; gap: 10px; }
        .msg-row.sent { justify-content: flex-end; }
        .msg-row.recv { justify-content: flex-start; }

        .msg-sent {
          background: linear-gradient(145deg, rgba(194,167,114,0.95), rgba(171,143,97,0.95));
          color: #15120d;
          border-radius: 22px 22px 6px 22px;
          padding: 11px 15px;
          line-height: 1.5;
          max-width: 360px;
          box-shadow: 0 10px 26px rgba(194,167,114,0.12);
          word-break: break-word;
        }
        .msg-recv {
          background: rgba(255,255,255,0.03);
          color: var(--text-primary);
          border: 1px solid var(--border);
          border-radius: 22px 22px 22px 6px;
          padding: 11px 15px;
          line-height: 1.5;
          max-width: 360px;
          word-break: break-word;
        }

        .msg-time {
          font-size: 9px;
          color: var(--text-muted);
          margin-top: 4px;
          opacity: 0;
          transition: opacity 0.15s;
          font-family: 'DM Mono', monospace;
        }
        .msg-wrap:hover .msg-time { opacity: 1; }

        .typing-bubble {
          background: rgba(255,255,255,0.03);
          border: 1px solid var(--border);
          border-radius: 22px 22px 22px 6px;
          padding: 10px 14px;
          display: flex;
          gap: 4px;
          align-items: center;
        }
        .typing-dot {
          width: 5px; height: 5px;
          border-radius: 50%;
          background: var(--text-muted);
        }

        .composer-wrap {
          padding: 14px 16px 16px;
          border-top: 1px solid var(--border);
          background: rgba(0,0,0,0.24);
        }
        .composer {
          border-radius: 26px;
          padding: 12px 14px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.03);
          display: flex;
          align-items: center;
          gap: 10px;
          box-shadow: var(--shadow-md);
        }
        .composer:focus-within { border-color: var(--border-focus); box-shadow: 0 0 0 4px var(--accent-dim); }
        .composer input {
          flex: 1;
          border: none;
          outline: none;
          background: none;
          color: var(--text-primary);
          font-size: 13.5px;
          font-family: 'DM Sans', sans-serif;
        }
        .composer input::placeholder { color: var(--text-muted); }

        .mini-btn {
          width: 36px;
          height: 36px;
          border-radius: 14px;
          border: 1px solid var(--border);
          background: rgba(255,255,255,0.02);
          color: var(--text-muted);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .mini-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

        .send-btn {
          width: 38px;
          height: 38px;
          border-radius: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          transition: .15s ease;
          flex-shrink: 0;
        }
        .send-btn.active {
          background: linear-gradient(135deg, var(--accent), var(--accent-2));
          color: #fff;
          cursor: pointer;
          box-shadow: var(--shadow-accent);
        }
        .send-btn.inactive {
          background: transparent;
          border: 1px solid var(--border);
          color: var(--text-disabled);
          cursor: not-allowed;
        }

        .empty-state {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .empty-inner {
          text-align: center;
          max-width: 320px;
        }
        .empty-icon {
          width: 74px;
          height: 74px;
          border-radius: 26px;
          margin: 0 auto 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(145deg, rgba(194,167,114,0.12), rgba(255,255,255,0.03));
          border: 1px solid var(--border);
        }
        .empty-title { font-size: 18px; font-weight: 800; margin-bottom: 6px; }
        .empty-subtitle { font-size: 13px; color: var(--text-muted); line-height: 1.6; }

        .call-overlay {
          position: fixed;
          inset: 0;
          z-index: 100;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(0,0,0,0.72);
          backdrop-filter: blur(18px);
          animation: shimmer-in 0.2s ease-out;
        }
        .call-modal {
          width: 400px;
          border-radius: 30px;
          overflow: hidden;
          background: rgba(18,18,18,0.96);
          border: 1px solid var(--border-mid);
          box-shadow: var(--shadow-lg);
        }
        .call-modal-header {
          padding: 14px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border);
        }
        .call-status-tag {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          font-weight: 700;
          color: var(--text-secondary);
          font-family: 'DM Mono', monospace;
        }
        .call-enc-tag {
          font-size: 10px;
          color: var(--green);
          display: flex;
          align-items: center;
          gap: 4px;
          font-family: 'DM Mono', monospace;
          font-weight: 700;
        }
        .call-modal-body {
          padding: 28px 24px 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 8px;
        }
        .call-avatar-wrap {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 6px;
        }
        .call-ring {
          position: absolute;
          border-radius: 50%;
          border: 1.5px solid var(--accent);
          animation: pulse-ring 2s ease-out infinite;
        }
        .call-name { font-size: 20px; font-weight: 800; }
        .call-sub {
          font-size: 12px;
          color: var(--text-secondary);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .call-modal-actions {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 14px;
          padding: 16px 24px 28px;
        }
        .call-action-btn {
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border: none;
          transition: all 0.15s;
        }
        .call-btn-end {
          width: 54px;
          height: 54px;
          background: linear-gradient(135deg, #d28c8c, #b85f5f);
          color: #fff;
        }
        .call-btn-accept {
          width: 54px;
          height: 54px;
          background: linear-gradient(135deg, #9bc2a4, #7ea68a);
          color: #fff;
        }
        .call-btn-reject {
          width: 54px;
          height: 54px;
          background: var(--red-dim);
          border: 1.5px solid rgba(210,140,140,0.35) !important;
          color: var(--red);
        }
        .call-ctrl-btn {
          width: 44px;
          height: 44px;
          background: rgba(255,255,255,0.04);
          border: 1px solid var(--border-mid) !important;
          color: var(--text-secondary);
        }

        .no-users {
          text-align: center;
          padding: 32px 16px;
          font-size: 12px;
          color: var(--text-muted);
        }

        .list-section-label {
          font-size: 10px;
          font-weight: 800;
          color: var(--text-disabled);
          letter-spacing: 0.8px;
          padding: 8px 10px 4px;
          text-transform: uppercase;
          font-family: 'DM Mono', monospace;
        }
      `}</style>

      {callState !== 'idle' && callPartner && (
        <div className="call-overlay">
          <div className="call-modal">
            <div className="call-modal-header">
              <div className="call-status-tag">
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: callState === 'connected' ? 'var(--green)' : 'var(--accent)',
                    display: 'inline-block',
                    animation: callState === 'connected' ? 'none' : 'pulse-ring 1.5s infinite'
                  }}
                />
                {callState === 'calling' ? 'Calling…' : callState === 'incoming' ? `Incoming ${callType}` : 'Connected'} · {callType === 'video' ? 'Video' : 'Voice'}
              </div>
              <div className="call-enc-tag">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Encrypted
              </div>
            </div>

            {callType === 'video' && callState === 'connected' && (
              <div style={{ width: '100%', height: 190, background: '#060606', position: 'relative' }}>
                <video ref={remoteVideoRef} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', bottom: 10, right: 10, width: 82, height: 104, borderRadius: 16, overflow: 'hidden', border: '1.5px solid var(--border-mid)', boxShadow: 'var(--shadow-md)' }}>
                  <video ref={localVideoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              </div>
            )}

            <div className="call-modal-body">
              {(callState === 'calling' || callState === 'incoming') && (
                <div className="call-avatar-wrap" style={{ marginBottom: 12 }}>
                  {[0, 0.65, 1.3].map(d => (
                    <div key={d} className="call-ring" style={{ width: 76, height: 76, animationDelay: `${d}s` }} />
                  ))}
                  <div className="avatar" style={{ width: 64, height: 64, fontSize: 22, background: `${getAvatarColor(callPartner.username)}16`, border: `2px solid ${getAvatarColor(callPartner.username)}45`, color: getAvatarColor(callPartner.username), zIndex: 1 }}>
                    {callPartner.username[0].toUpperCase()}
                  </div>
                </div>
              )}
              {callState === 'connected' && callType === 'audio' && (
                <div className="avatar" style={{ width: 64, height: 64, fontSize: 22, background: `${getAvatarColor(callPartner.username)}16`, border: `2px solid ${getAvatarColor(callPartner.username)}45`, color: getAvatarColor(callPartner.username), marginBottom: 8 }}>
                  {callPartner.username[0].toUpperCase()}
                </div>
              )}
              <p className="call-name">{callPartner.username}</p>
              <p className="call-sub">
                {callState === 'calling' && <>Ringing…</>}
                {callState === 'incoming' && <>Incoming {callType} call</>}
                {callState === 'connected' && <><span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)', display: 'inline-block' }} />{formatDur(callDuration)}</>}
              </p>
            </div>

            <div className="call-modal-actions">
              {callState === 'connected' && (
                <>
                  <button onClick={toggleMute} className={`call-action-btn call-ctrl-btn${isMuted ? ' active-mute' : ''}`} title={isMuted ? 'Unmute' : 'Mute'}>
                    {isMuted ? '🔇' : '🎙️'}
                  </button>
                  <button onClick={endCall} className="call-action-btn call-btn-end" title="End call">⏹</button>
                  {callType === 'video' && (
                    <button onClick={toggleCamera} className={`call-action-btn call-ctrl-btn${isCameraOff ? ' active-mute' : ''}`} title={isCameraOff ? 'Enable camera' : 'Disable camera'}>
                      {isCameraOff ? '📷' : '🎥'}
                    </button>
                  )}
                </>
              )}
              {callState === 'calling' && (
                <button onClick={endCall} className="call-action-btn call-btn-end" title="Cancel">✕</button>
              )}
              {callState === 'incoming' && (
                <>
                  <button onClick={rejectCall} className="call-action-btn call-btn-reject" title="Decline">✕</button>
                  <button onClick={acceptCall} className="call-action-btn call-btn-accept" title="Accept">✓</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="sidebar">
        <div className="sidebar-header">
          <div className="logo-mark">
            <div className="logo-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <span className="logo-text">Obsidian<span>Link</span></span>
          </div>
          <button onClick={() => { logout(); navigate('/login'); }} className="icon-btn danger" title="Sign out">↗</button>
        </div>

        <div className="profile-row">
          <div className="avatar" style={{ width: 34, height: 34, background: `${getAvatarColor(currentUsername)}16`, border: `1.5px solid ${getAvatarColor(currentUsername)}45`, color: getAvatarColor(currentUsername) }}>
            {currentUsername[0].toUpperCase()}
          </div>
          <div className="profile-info">
            <div className="profile-name">{currentUsername}</div>
            <div className="profile-status">
              <span className="status-dot" style={{ background: 'var(--green)', boxShadow: '0 0 6px var(--green)' }} />
              Online
            </div>
          </div>
        </div>

        <div className="search-wrap">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search people…" />
        </div>

        <div className="tabs-row">
          {['All', 'Unread', 'DMs'].map(tab => (
            <button key={tab} className={`tab-btn${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</button>
          ))}
        </div>

        <div className="users-list">
          {filteredUsers.length === 0 ? (
            <div className="no-users">No users found</div>
          ) : filteredUsers.map(u => (
            <div
              key={u._id}
              className={`user-row${selectedUser?._id === u._id ? ' active' : ''}`}
              onClick={() => {
                setSelectedUser(u);
                setUnreadCounts(prev => ({ ...prev, [u._id]: 0 }));
              }}
            >
              <div
                className={`avatar${isOnline(u._id) ? ' avatar-online' : ''}`}
                style={{ width: 38, height: 38, background: `${getAvatarColor(u.username)}16`, border: `1.5px solid ${getAvatarColor(u.username)}45`, color: getAvatarColor(u.username) }}
              >
                {u.username[0].toUpperCase()}
              </div>
              <div className="user-info">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span className="user-name">{u.username}</span>
                  {(unreadCounts[u._id] ?? 0) > 0 && <div className="unread-badge">{unreadCounts[u._id] > 9 ? '9+' : unreadCounts[u._id]}</div>}
                </div>
                <div className="user-status" style={{ color: isOnline(u._id) ? 'var(--green)' : 'var(--text-muted)' }}>
                  {isOnline(u._id) ? 'Active now' : 'Offline'}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="bottom-nav">
          {[
            { id: 'chats', label: 'Chats', badge: 0, icon: '◔' },
            { id: 'notifications', label: 'Alerts', badge: unreadNotifCount, icon: '✦' },
            { id: 'settings', label: 'Settings', badge: 0, icon: '◌' },
          ].map(({ id, label, badge, icon }) => {
            const isActive = id === 'chats' ? activePanel === 'none' : activePanel === id;
            return (
              <button key={id} className={`nav-btn${isActive ? ' active' : ''}`} onClick={() => id !== 'chats' && togglePanel(id as ActivePanel)}>
                {badge > 0 && <div className="nav-badge">{badge}</div>}
                <div style={{ fontSize: 15 }}>{icon}</div>
                <span className="nav-btn-label">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {activePanel === 'notifications' && (
        <div className="side-panel">
          <div className="panel-header">
            <span className="panel-title">Notifications</span>
            <button onClick={() => setNotifications(p => p.map(n => ({ ...n, read: true })))} style={{ fontSize: 11, color: 'var(--accent-2)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
              Mark all read
            </button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
            {notifications.map(n => (
              <div key={n.id} className={`notif-card ${n.read ? 'read' : 'unread'}`}>
                {!n.read && <div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', marginBottom: 8 }} />}
                <p className="notif-text">{n.text}</p>
                <p className="notif-time">{n.time}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {activePanel === 'settings' && (
        <div className="side-panel">
          <div className="panel-header">
            <span className="panel-title">Preferences</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 0' }}>
            <div className="list-section-label">Notifications</div>
            {[
              { key: 'notifications', label: 'Push alerts' },
              { key: 'sounds', label: 'Sound effects' },
              { key: 'readReceipts', label: 'Read receipts' },
            ].map(({ key, label }) => (
              <div key={key} className="settings-row">
                <span className="settings-label">{label}</span>
                <button
                  className="toggle-track"
                  style={{ background: (settings as any)[key] ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'rgba(255,255,255,0.08)' }}
                  onClick={() => setSettings(p => ({ ...p, [key]: !(p as any)[key] }))}
                >
                  <span className="toggle-thumb" style={{ left: (settings as any)[key] ? '20px' : '2px', background: '#fff' }} />
                </button>
              </div>
            ))}

            <div className="list-section-label">Security</div>
            <div className="settings-row">
              <span className="settings-label">End-to-end encryption</span>
              <button
                className="toggle-track"
                style={{ background: settings.encryption ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'rgba(255,255,255,0.08)' }}
                onClick={() => setSettings(p => ({ ...p, encryption: !p.encryption }))}
              >
                <span className="toggle-thumb" style={{ left: settings.encryption ? '20px' : '2px', background: '#fff' }} />
              </button>
            </div>

            <div className="list-section-label">Appearance</div>
            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <span className="settings-label">Font size</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {['small', 'medium', 'large'].map(sz => (
                  <button
                    key={sz}
                    onClick={() => setSettings(p => ({ ...p, fontSize: sz }))}
                    style={{
                      flex: 1,
                      padding: '7px 0',
                      borderRadius: 12,
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: 'capitalize',
                      cursor: 'pointer',
                      border: settings.fontSize === sz ? 'none' : '1px solid var(--border)',
                      background: settings.fontSize === sz ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'rgba(255,255,255,0.03)',
                      color: settings.fontSize === sz ? '#fff' : 'var(--text-muted)',
                    }}
                  >
                    {sz[0].toUpperCase() + sz.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="chat-area">
        <div className="top-strip">
          <div className="top-chip">
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 10px var(--accent)' }} />
            Private communication system
          </div>
          <div className="top-chip">
            {users.length} contacts · {onlineUsers.length} live
          </div>
        </div>

        {selectedUser ? (
          <>
            <div className="chat-header">
              <div className="chat-header-left">
                <div
                  className={`avatar${isOnline(selectedUser._id) ? ' avatar-online' : ''}`}
                  style={{ width: 40, height: 40, background: `${getAvatarColor(selectedUser.username)}16`, border: `1.5px solid ${getAvatarColor(selectedUser.username)}45`, color: getAvatarColor(selectedUser.username) }}
                >
                  {selectedUser.username[0].toUpperCase()}
                </div>
                <div>
                  <div className="chat-username">{selectedUser.username}</div>
                  <div className="chat-substatus" style={{ color: isTyping ? 'var(--accent-2)' : isOnline(selectedUser._id) ? 'var(--green)' : 'var(--text-muted)' }}>
                    {isTyping ? 'typing…' : isOnline(selectedUser._id) ? 'Active now' : 'Offline'}
                  </div>
                </div>
              </div>
              <div className="chat-header-actions">
                <button onClick={() => startCall('audio')} className="icon-btn" title="Voice call">☎</button>
                <button onClick={() => startCall('video')} className="icon-btn" title="Video call">▣</button>
              </div>
            </div>

            <div className="enc-strip">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--text-disabled)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span className="enc-label">Messages are end-to-end encrypted</span>
            </div>

            <div className="messages-scroll">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-inner">
                    <div className="empty-icon">
                      <div className="avatar" style={{ width: 34, height: 34, fontSize: 14, background: `${getAvatarColor(selectedUser.username)}16`, border: `1px solid ${getAvatarColor(selectedUser.username)}45`, color: getAvatarColor(selectedUser.username) }}>
                        {selectedUser.username[0].toUpperCase()}
                      </div>
                    </div>
                    <p className="empty-title">{selectedUser.username}</p>
                    <p className="empty-subtitle">
                      This conversation is empty. Begin a discreet exchange from this private channel.
                    </p>
                  </div>
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
                    const fontSize = settings.fontSize === 'small' ? '12px' : settings.fontSize === 'large' ? '15.5px' : '13.5px';

                    return (
                      <div key={msg._id} className={`msg-bubble msg-row ${isSent ? 'sent' : 'recv'}`} style={{ marginTop: isConsecutive ? 2 : 12 }}>
                        {!isSent && (
                          <div style={{ width: 28, flexShrink: 0, alignSelf: 'flex-end' }}>
                            {!isConsecutive && (
                              <div className="avatar" style={{ width: 28, height: 28, fontSize: 10, background: `${getAvatarColor(msg.sender.username)}16`, border: `1px solid ${getAvatarColor(msg.sender.username)}45`, color: getAvatarColor(msg.sender.username) }}>
                                {msg.sender.username[0].toUpperCase()}
                              </div>
                            )}
                          </div>
                        )}
                        <div className="msg-wrap" style={{ display: 'flex', flexDirection: 'column', alignItems: isSent ? 'flex-end' : 'flex-start' }}>
                          <div className={isSent ? 'msg-sent' : 'msg-recv'} style={{ fontSize }}>
                            {msg.message}
                          </div>
                          <p className="msg-time" style={{ textAlign: isSent ? 'right' : 'left' }}>
                            {formatTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}

              {isTyping && (
                <div className="msg-row recv" style={{ marginTop: 10 }}>
                  <div className="avatar" style={{ width: 28, height: 28, fontSize: 10, alignSelf: 'flex-end', flexShrink: 0, background: `${getAvatarColor(selectedUser.username)}16`, border: `1px solid ${getAvatarColor(selectedUser.username)}45`, color: getAvatarColor(selectedUser.username) }}>
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  <div className="typing-bubble">
                    {[0, 0.2, 0.4].map((d, i) => (
                      <div key={i} className="typing-dot" style={{ animation: `bounce-dot 1.2s ${d}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="composer-wrap">
              <div className="composer">
                <button className="mini-btn">◌</button>
                <input
                  type="text"
                  value={newMessage}
                  onChange={handleTyping}
                  onKeyDown={handleKeyDown}
                  placeholder={`Message ${selectedUser.username}…`}
                />
                <button onClick={handleSendMessage} disabled={!newMessage.trim()} className={`send-btn ${newMessage.trim() ? 'active' : 'inactive'}`}>
                  ➤
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="empty-inner">
              <div className="empty-icon">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <p className="empty-title">Select a conversation</p>
              <p className="empty-subtitle">
                The communication stage opens once you choose a contact from the left rail.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatPage;