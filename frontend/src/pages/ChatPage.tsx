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
  '#7C3AED', '#0EA5E9', '#10B981', '#F59E0B',
  '#EF4444', '#EC4899', '#6366F1', '#14B8A6',
];

const getAvatarColor = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
};

// Fake notifications data
const fakeNotifications = [
  { id: '1', text: 'New user joined CipherChat', time: '2m ago', read: false },
  { id: '2', text: 'Your account was accessed from a new device', time: '1h ago', read: false },
  { id: '3', text: 'End-to-end encryption enabled', time: '3h ago', read: true },
];

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

  // Call states
  const [callState, setCallState] = useState<CallState>('idle');
  const [callType, setCallType] = useState<'audio' | 'video'>('audio');
  const [callDuration, setCallDuration] = useState(0);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callRingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Settings state
  const [settings, setSettings] = useState({
    notifications: true,
    sounds: true,
    darkMode: true,
    encryption: true,
    readReceipts: true,
    fontSize: 'medium',
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUserRef = useRef<string | null>(null);
  const selectedUserRef = useRef<User | null>(null);

  useEffect(() => {
    currentUserRef.current = (user as any)?.id || (user as any)?._id || null;
  }, [user]);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  const fetchUsers = useCallback(async () => {
    if (!token) return;
    try {
      const data = await getUsersApi(token);
      setUsers(data.users);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  }, [token]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  useEffect(() => {
    if (!token) return;
    const timer = setTimeout(() => {
      const socket = initializeSocket(token);
      socket.on('onlineUsers', (userIds: string[]) => { setOnlineUsers(userIds); fetchUsers(); });
      socket.on('receiveMessage', (message: Message) => {
        const myId = currentUserRef.current;
        if (String(message.sender._id) === String(myId)) return;
        const currentSelected = selectedUserRef.current;
        if (currentSelected && String(message.sender._id) === String(currentSelected._id)) {
          setMessages((prev) => {
            const exists = prev.some((m) => m._id === message._id);
            return exists ? prev : [...prev, message];
          });
        } else {
          setUnreadCounts((prev) => ({ ...prev, [message.sender._id]: (prev[message.sender._id] || 0) + 1 }));
        }
      });
      socket.on('messageSent', (message: Message) => {
        setMessages((prev) => {
          const exists = prev.some((m) => m._id === message._id);
          return exists ? prev : [...prev, message];
        });
      });
      socket.on('userTyping', (data: { userId: string }) => {
        setTypingUsers((prev) => [...new Set([...prev, data.userId])]);
      });
      socket.on('userStopTyping', (data: { userId: string }) => {
        setTypingUsers((prev) => prev.filter((id) => id !== data.userId));
      });
    }, 100);
    return () => clearTimeout(timer);
  }, [token, fetchUsers]);

  useEffect(() => {
    const fetchMessages = async () => {
      if (!selectedUser || !token) return;
      try {
        const data = await getMessagesApi(selectedUser._id, token);
        setMessages(data.messages);
      } catch (error) { console.error('Failed to fetch messages:', error); }
    };
    fetchMessages();
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
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit('stopTyping', { receiverId: selectedUser._id });
    }, 1500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); }
  };

  const handleLogout = () => { logout(); navigate('/login'); };

  const formatTime = (dateString: string) =>
    new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    const today = new Date();
    const diff = today.getDate() - d.getDate();
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const formatCallDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const isOnline = (userId: string) => onlineUsers.includes(userId);
  const isTyping = selectedUser ? typingUsers.includes(selectedUser._id) : false;
  const currentUserId = (user as any)?.id || (user as any)?._id;
  const currentUsername = (user as any)?.username || 'You';

  const filteredUsers = users.filter(u =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedMessages = messages.reduce((acc, msg) => {
    const dateKey = formatDate(msg.createdAt);
    if (!acc[dateKey]) acc[dateKey] = [];
    acc[dateKey].push(msg);
    return acc;
  }, {} as Record<string, Message[]>);

  const unreadNotifCount = notifications.filter(n => !n.read).length;

  // ── CALL FUNCTIONS ──────────────────────────────
  const startCall = (type: 'audio' | 'video') => {
    setCallType(type);
    setCallState('calling');
    setCallDuration(0);
    // Simulate the other side picking up after 3 seconds
    callRingRef.current = setTimeout(() => {
      setCallState('connected');
      callTimerRef.current = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }, 3000) as unknown as ReturnType<typeof setInterval>;
  };

  const endCall = () => {
    if (callTimerRef.current) clearInterval(callTimerRef.current);
    if (callRingRef.current) clearTimeout(callRingRef.current as unknown as ReturnType<typeof setTimeout>);
    setCallState('idle');
    setCallDuration(0);
  };

  const togglePanel = (panel: ActivePanel) => {
    setActivePanel(prev => prev === panel ? 'none' : panel);
  };

  const markAllNotifRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  return (
    <div style={{ fontFamily: "'Sora', 'Helvetica Neue', sans-serif" }}
      className="h-screen flex overflow-hidden bg-[#0d0e14]">

      {/* ── CALL MODAL ──────────────────────────────── */}
      {callState !== 'idle' && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(12px)' }}>
          <div className="relative w-80 rounded-3xl overflow-hidden"
            style={{ background: 'linear-gradient(145deg, #1a1b2e, #252640)', boxShadow: '0 30px 80px rgba(124,58,237,0.4)' }}>

            {/* Animated rings on calling */}
            {callState === 'calling' && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="ring-anim ring-1-anim" />
                <div className="ring-anim ring-2-anim" />
                <div className="ring-anim ring-3-anim" />
              </div>
            )}

            <div className="relative z-10 flex flex-col items-center px-8 pt-12 pb-8 gap-3">
              {/* Avatar */}
              <div className="w-20 h-20 rounded-full flex items-center justify-center text-white text-3xl font-bold shadow-2xl"
                style={{ backgroundColor: getAvatarColor(selectedUser.username), boxShadow: `0 0 40px ${getAvatarColor(selectedUser.username)}55` }}>
                {selectedUser.username[0].toUpperCase()}
              </div>
              <p className="text-white text-xl font-semibold mt-2">{selectedUser.username}</p>
              <p className="text-[#9ca3af] text-sm">
                {callState === 'calling' && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400 inline-block animate-pulse" />
                    {callType === 'video' ? 'Video calling...' : 'Calling...'}
                  </span>
                )}
                {callState === 'connected' && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                    {callType === 'video' ? 'Video call • ' : 'Audio call • '}{formatCallDuration(callDuration)}
                  </span>
                )}
              </p>

              {/* Video placeholder when connected */}
              {callState === 'connected' && callType === 'video' && (
                <div className="w-full mt-3 rounded-2xl overflow-hidden bg-[#111320] flex items-center justify-center"
                  style={{ height: 140 }}>
                  <div className="flex flex-col items-center gap-2 opacity-40">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                    <span className="text-white text-xs">Camera off</span>
                  </div>
                  {/* Self view */}
                  <div className="absolute bottom-28 right-10 w-16 h-20 rounded-xl bg-[#1e2038] border border-[#3a3b58] flex items-center justify-center">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                      style={{ backgroundColor: getAvatarColor(currentUsername) }}>
                      {currentUsername[0].toUpperCase()}
                    </div>
                  </div>
                </div>
              )}

              {/* Call action buttons */}
              <div className="flex items-center gap-6 mt-4">
                {callState === 'connected' && (
                  <>
                    <button className="w-12 h-12 rounded-full flex items-center justify-center transition-all"
                      style={{ background: '#1e2038' }} title="Mute">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    </button>
                    <button onClick={endCall}
                      className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-105"
                      style={{ background: '#EF4444', boxShadow: '0 8px 24px rgba(239,68,68,0.5)' }} title="End call">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                        <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
                      </svg>
                    </button>
                    {callType === 'video' && (
                      <button className="w-12 h-12 rounded-full flex items-center justify-center transition-all"
                        style={{ background: '#1e2038' }} title="Toggle camera">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
                {callState === 'calling' && (
                  <button onClick={endCall}
                    className="w-14 h-14 rounded-full flex items-center justify-center transition-all hover:scale-105"
                    style={{ background: '#EF4444', boxShadow: '0 8px 24px rgba(239,68,68,0.5)' }} title="Cancel">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="white">
                      <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SIDEBAR ──────────────────────────────────── */}
      <div className="w-[290px] flex flex-col shrink-0" style={{ background: '#13141f', borderRight: '1px solid #1e2030' }}>

        {/* App Header */}
        <div className="px-5 pt-5 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #7C3AED, #4F46E5)' }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <span className="text-white font-bold text-base tracking-tight">CipherChat</span>
          </div>
          <button onClick={handleLogout} title="Logout"
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-all text-[#4a5060] hover:text-red-400 hover:bg-[#1e2030]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>

        {/* My Profile card */}
        <div className="mx-3 mb-3 rounded-xl p-3 flex items-center gap-3"
          style={{ background: 'linear-gradient(135deg, #1c1d2e, #1e2038)' }}>
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
            style={{ backgroundColor: getAvatarColor(currentUsername) }}>
            {currentUsername[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-sm font-semibold truncate">{currentUsername}</p>
            <p className="text-[#6366f1] text-xs flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              Active now
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: '#1a1b2c' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4a5060" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input type="text" value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search people..."
              className="bg-transparent text-sm text-white placeholder-[#4a5060] focus:outline-none flex-1" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-3 mb-2">
          {['All', 'Unread', 'DMs'].map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="flex-1 text-xs py-1.5 rounded-lg font-medium transition-all"
              style={activeTab === tab
                ? { background: 'linear-gradient(135deg, #4c1d95, #3730a3)', color: 'white' }
                : { color: '#4a5060' }}>
              {tab}
            </button>
          ))}
        </div>

        {/* Users list */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5 pb-2">
          {filteredUsers.length === 0 ? (
            <div className="text-center py-10 px-4">
              <p className="text-[#4a5060] text-sm">No users found</p>
            </div>
          ) : (
            filteredUsers.map((u) => (
              <div key={u._id}
                onClick={() => { setSelectedUser(u); setUnreadCounts((prev) => ({ ...prev, [u._id]: 0 })); }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                style={selectedUser?._id === u._id
                  ? { background: 'linear-gradient(135deg, #1e1f38, #252645)' }
                  : {}
                }
                onMouseEnter={e => { if (selectedUser?._id !== u._id) (e.currentTarget as HTMLDivElement).style.background = '#1a1b2c'; }}
                onMouseLeave={e => { if (selectedUser?._id !== u._id) (e.currentTarget as HTMLDivElement).style.background = ''; }}>
                <div className="relative shrink-0">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: getAvatarColor(u.username) }}>
                    {u.username[0].toUpperCase()}
                  </div>
                  {isOnline(u._id) && (
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2"
                      style={{ borderColor: '#13141f' }} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-white truncate">{u.username}</p>
                    {unreadCounts[u._id] > 0 && (
                      <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full text-white text-xs flex items-center justify-center font-bold"
                        style={{ background: 'linear-gradient(135deg, #7C3AED, #4F46E5)' }}>
                        {unreadCounts[u._id] > 9 ? '9+' : unreadCounts[u._id]}
                      </span>
                    )}
                  </div>
                  <p className={`text-xs truncate mt-0.5 ${isOnline(u._id) ? 'text-emerald-400' : 'text-[#3a3b4a]'}`}>
                    {isOnline(u._id) ? 'Online' : 'Offline'}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* ── BOTTOM NAV with Settings & Notifications ── */}
        <div className="px-3 py-3 flex items-center justify-around border-t" style={{ borderColor: '#1e2030' }}>
          {/* Chats */}
          <button className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all"
            style={{ color: '#7C3AED' }} title="Chats">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="text-[10px] font-medium">Chats</span>
          </button>

          {/* Notifications */}
          <button
            onClick={() => togglePanel('notifications')}
            className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all relative"
            style={{ color: activePanel === 'notifications' ? '#7C3AED' : '#4a5060' }}
            title="Notifications">
            {unreadNotifCount > 0 && (
              <span className="absolute top-0.5 right-1 w-4 h-4 rounded-full text-white text-[9px] flex items-center justify-center font-bold"
                style={{ background: '#EF4444' }}>
                {unreadNotifCount}
              </span>
            )}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="text-[10px] font-medium">Alerts</span>
          </button>

          {/* Settings */}
          <button
            onClick={() => togglePanel('settings')}
            className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-xl transition-all"
            style={{ color: activePanel === 'settings' ? '#7C3AED' : '#4a5060' }}
            title="Settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span className="text-[10px] font-medium">Settings</span>
          </button>
        </div>
      </div>

      {/* ── NOTIFICATIONS PANEL ─────────────────────── */}
      {activePanel === 'notifications' && (
        <div className="w-[280px] flex flex-col shrink-0 border-r"
          style={{ background: '#13141f', borderColor: '#1e2030' }}>
          <div className="px-5 pt-5 pb-3 flex items-center justify-between">
            <h3 className="text-white font-semibold text-sm">Notifications</h3>
            <button onClick={markAllNotifRead} className="text-[10px] text-[#7C3AED] hover:underline">
              Mark all read
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-3 space-y-2">
            {notifications.map(n => (
              <div key={n.id} className="flex gap-3 p-3 rounded-xl"
                style={{ background: n.read ? 'transparent' : '#1a1b2c' }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                  style={{ background: n.read ? '#1e2030' : 'linear-gradient(135deg, #7C3AED44, #4F46E544)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={n.read ? '#4a5060' : '#7C3AED'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                </div>
                <div>
                  <p className={`text-xs ${n.read ? 'text-[#4a5060]' : 'text-white'}`}>{n.text}</p>
                  <p className="text-[10px] text-[#3a3b4a] mt-0.5">{n.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── SETTINGS PANEL ──────────────────────────── */}
      {activePanel === 'settings' && (
        <div className="w-[280px] flex flex-col shrink-0 border-r"
          style={{ background: '#13141f', borderColor: '#1e2030' }}>
          <div className="px-5 pt-5 pb-3">
            <h3 className="text-white font-semibold text-sm">Settings</h3>
            <p className="text-[#4a5060] text-xs mt-0.5">Customize your experience</p>
          </div>
          <div className="flex-1 overflow-y-auto px-3 space-y-1 pb-4">
            {[
              { key: 'notifications', label: 'Push Notifications', icon: 'bell', desc: 'Get alerts for new messages' },
              { key: 'sounds', label: 'Sound Effects', icon: 'volume', desc: 'Message & call sounds' },
              { key: 'encryption', label: 'End-to-End Encryption', icon: 'lock', desc: 'Always on for all chats' },
              { key: 'readReceipts', label: 'Read Receipts', icon: 'check', desc: 'Show when messages are read' },
            ].map(({ key, label, icon, desc }) => (
              <div key={key} className="flex items-center justify-between p-3 rounded-xl"
                style={{ background: '#1a1b2c' }}>
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: '#1e2038' }}>
                    {icon === 'bell' && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>}
                    {icon === 'volume' && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" /></svg>}
                    {icon === 'lock' && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>}
                    {icon === 'check' && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#7C3AED" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
                  </div>
                  <div>
                    <p className="text-white text-xs font-medium">{label}</p>
                    <p className="text-[#4a5060] text-[10px]">{desc}</p>
                  </div>
                </div>
                <button
                  onClick={() => setSettings(prev => ({ ...prev, [key]: !(prev as any)[key] }))}
                  className="relative shrink-0 w-9 h-5 rounded-full transition-all"
                  style={{ background: (settings as any)[key] ? '#7C3AED' : '#252640' }}>
                  <span className="absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all shadow"
                    style={{ left: (settings as any)[key] ? '18px' : '2px' }} />
                </button>
              </div>
            ))}

            {/* Font size */}
            <div className="p-3 rounded-xl" style={{ background: '#1a1b2c' }}>
              <p className="text-white text-xs font-medium mb-2">Font Size</p>
              <div className="flex gap-2">
                {['small', 'medium', 'large'].map(size => (
                  <button key={size} onClick={() => setSettings(prev => ({ ...prev, fontSize: size }))}
                    className="flex-1 py-1.5 rounded-lg text-xs capitalize transition-all"
                    style={settings.fontSize === size
                      ? { background: 'linear-gradient(135deg, #7C3AED, #4F46E5)', color: 'white' }
                      : { background: '#1e2038', color: '#4a5060' }}>
                    {size}
                  </button>
                ))}
              </div>
            </div>

            {/* Danger zone */}
            <div className="p-3 rounded-xl mt-2" style={{ background: '#1a1b2c', border: '1px solid #3a1a1a' }}>
              <p className="text-red-400 text-xs font-medium mb-2">Danger Zone</p>
              <button onClick={handleLogout}
                className="w-full py-2 rounded-lg text-xs text-red-400 transition-all hover:bg-red-400/10"
                style={{ border: '1px solid #3a1a1a' }}>
                Sign Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CHAT AREA ────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#0d0e14' }}>

        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className="flex items-center justify-between px-6 py-3.5 border-b"
              style={{ background: '#0d0e14', borderColor: '#1e2030' }}>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm"
                    style={{ backgroundColor: getAvatarColor(selectedUser.username) }}>
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  {isOnline(selectedUser._id) && (
                    <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2"
                      style={{ borderColor: '#0d0e14' }} />
                  )}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{selectedUser.username}</p>
                  <p className={`text-xs ${isTyping ? 'text-amber-400' : isOnline(selectedUser._id) ? 'text-emerald-400' : 'text-[#3a3b4a]'}`}>
                    {isTyping ? 'typing...' : isOnline(selectedUser._id) ? 'Active now' : 'Offline'}
                  </p>
                </div>
              </div>

              {/* Header action buttons */}
              <div className="flex items-center gap-1">
                {/* Audio call */}
                <button onClick={() => startCall('audio')}
                  className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                  style={{ color: '#7C3AED' }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#1a1b2c'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = ''}
                  title="Audio Call">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.71 3.35 2 2 0 0 1 3.71 1.19h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 8.91a16 16 0 0 0 6 6l.86-.86a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21.73 16.92z" />
                  </svg>
                </button>
                {/* Video call */}
                <button onClick={() => startCall('video')}
                  className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                  style={{ color: '#7C3AED' }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = '#1a1b2c'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = ''}
                  title="Video Call">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                  </svg>
                </button>
                {/* Info */}
                <button className="w-8 h-8 flex items-center justify-center rounded-lg transition-all"
                  style={{ color: '#4a5060' }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = 'white'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = '#4a5060'}
                  title="User info">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-1">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold"
                    style={{ backgroundColor: getAvatarColor(selectedUser.username) }}>
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  <p className="text-white font-semibold">{selectedUser.username}</p>
                  <p className="text-[#4a5060] text-sm">No messages yet. Say hello! 👋</p>
                </div>
              ) : (
                Object.entries(groupedMessages).map(([date, msgs]) => (
                  <div key={date}>
                    <div className="flex items-center gap-3 py-3">
                      <div className="flex-1 h-px" style={{ background: '#1e2030' }} />
                      <span className="text-[#3a3b4a] text-xs font-medium">{date}</span>
                      <div className="flex-1 h-px" style={{ background: '#1e2030' }} />
                    </div>

                    {msgs.map((msg, idx) => {
                      const isSent = String(msg.sender._id) === String(currentUserId);
                      const prevMsg = msgs[idx - 1];
                      const isConsecutive = prevMsg && String(prevMsg.sender._id) === String(msg.sender._id);
                      const fontSize = settings.fontSize === 'small' ? '12px' : settings.fontSize === 'large' ? '16px' : '14px';

                      return (
                        <div key={msg._id}
                          className={`flex ${isSent ? 'justify-end' : 'justify-start'} ${isConsecutive ? 'mt-0.5' : 'mt-3'}`}>
                          {!isSent && (
                            <div className="w-7 shrink-0 mr-2 self-end">
                              {!isConsecutive && (
                                <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                                  style={{ backgroundColor: getAvatarColor(msg.sender.username) }}>
                                  {msg.sender.username[0].toUpperCase()}
                                </div>
                              )}
                            </div>
                          )}
                          <div className={`max-w-sm group ${isSent ? 'items-end' : 'items-start'} flex flex-col`}>
                            <div className="px-4 py-2.5 leading-relaxed"
                              style={{
                                fontSize,
                                color: isSent ? 'white' : '#c8cde0',
                                borderRadius: isSent ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                                background: isSent
                                  ? 'linear-gradient(135deg, #7C3AED, #4F46E5)'
                                  : '#1a1b2c',
                              }}>
                              {msg.message}
                            </div>
                            <p className="text-[10px] text-[#3a3b4a] mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              {formatTime(msg.createdAt)}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}

              {isTyping && (
                <div className="flex items-end gap-2 mt-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ backgroundColor: getAvatarColor(selectedUser.username) }}>
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  <div className="rounded-2xl rounded-bl-sm px-4 py-3 flex gap-1 items-center"
                    style={{ background: '#1a1b2c' }}>
                    {[0, 0.2, 0.4].map((delay, i) => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full"
                        style={{ background: '#4a5060', animation: `bounce 1.2s ${delay}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="px-5 py-4 border-t" style={{ borderColor: '#1e2030' }}>
              <div className="flex items-center gap-3 rounded-2xl px-4 py-3"
                style={{ background: '#1a1b2c' }}>
                {/* Emoji button */}
                <button className="transition-all shrink-0" style={{ color: '#4a5060' }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = '#7C3AED'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = '#4a5060'}
                  title="Emoji">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" />
                  </svg>
                </button>
                <input type="text" value={newMessage} onChange={handleTyping} onKeyDown={handleKeyDown}
                  placeholder={`Message ${selectedUser.username}...`}
                  className="flex-1 bg-transparent text-white placeholder-[#3a3b4a] focus:outline-none text-sm" />
                {/* Attach */}
                <button className="transition-all shrink-0" style={{ color: '#4a5060' }}
                  onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = '#7C3AED'}
                  onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = '#4a5060'}
                  title="Attach">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                </button>
                {/* Send */}
                <button onClick={handleSendMessage} disabled={!newMessage.trim()}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0"
                  style={{
                    background: newMessage.trim() ? 'linear-gradient(135deg, #7C3AED, #4F46E5)' : '#252640',
                    color: newMessage.trim() ? 'white' : '#3a3b4a',
                    cursor: newMessage.trim() ? 'pointer' : 'not-allowed',
                  }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
                style={{ background: 'linear-gradient(135deg, #1c1d2e, #252640)' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#4a5060" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <p className="text-white font-semibold">CipherChat</p>
              <p className="text-[#3a3b4a] text-sm mt-1">Select someone to start a secure conversation</p>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap');
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
        @keyframes ringPulse {
          0% { transform: scale(0.8); opacity: 0.8; }
          100% { transform: scale(2); opacity: 0; }
        }
        .ring-anim {
          position: absolute;
          border-radius: 50%;
          border: 2px solid #7C3AED;
          width: 80px;
          height: 80px;
          animation: ringPulse 2s ease-out infinite;
        }
        .ring-1-anim { animation-delay: 0s; }
        .ring-2-anim { animation-delay: 0.6s; }
        .ring-3-anim { animation-delay: 1.2s; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #252640; border-radius: 4px; }
      `}</style>
    </div>
  );
};

export default ChatPage;