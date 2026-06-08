import { useState, useEffect, useRef } from 'react';
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

interface Notification {
  userId: string;
  username: string;
  message: string;
  time: string;
  count: number;
}

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
  const [activeNav, setActiveNav] = useState('chat');
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showNotifPanel, setShowNotifPanel] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentUserRef = useRef<string | null>(null);

  useEffect(() => {
    currentUserRef.current = (user as any)?.id || (user as any)?._id || null;
  }, [user]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (!token) return;

    const timer = setTimeout(() => {
      const socket = initializeSocket(token);

      socket.on('onlineUsers', (userIds: string[]) => {
        setOnlineUsers(userIds);
      });

      socket.on('receiveMessage', (message: Message) => {
        if (message.sender._id === currentUserRef.current) return;

        setSelectedUser((currentSelected) => {
          if (
            currentSelected &&
            (message.sender._id === currentSelected._id ||
              message.receiver._id === currentSelected._id)
          ) {
            setMessages((prev) => {
              const exists = prev.some((m) => m._id === message._id);
              if (exists) return prev;
              return [...prev, message];
            });
          } else {
            // Increment unread count
            setUnreadCounts((prev) => ({
              ...prev,
              [message.sender._id]: (prev[message.sender._id] || 0) + 1,
            }));

            // Add to notifications list
            setNotifications((prev) => {
              const existing = prev.find((n) => n.userId === message.sender._id);
              if (existing) {
                return prev.map((n) =>
                  n.userId === message.sender._id
                    ? { ...n, message: message.message, time: message.createdAt, count: n.count + 1 }
                    : n
                );
              }
              return [
                {
                  userId: message.sender._id,
                  username: message.sender.username,
                  message: message.message,
                  time: message.createdAt,
                  count: 1,
                },
                ...prev,
              ];
            });
          }
          return currentSelected;
        });
      });

      socket.on('messageSent', (message: Message) => {
        setMessages((prev) => {
          const exists = prev.some((m) => m._id === message._id);
          if (exists) return prev;
          return [...prev, message];
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
  }, [token]);

  useEffect(() => {
    const fetchUsers = async () => {
      if (!token) return;
      try {
        const data = await getUsersApi(token);
        setUsers(data.users);
      } catch (error) {
        console.error('Failed to fetch users:', error);
      }
    };
    fetchUsers();
  }, [token]);

  useEffect(() => {
    const fetchMessages = async () => {
      if (!selectedUser || !token) return;
      try {
        const data = await getMessagesApi(selectedUser._id, token);
        setMessages(data.messages);
      } catch (error) {
        console.error('Failed to fetch messages:', error);
      }
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleNavClick = (nav: string) => {
    setActiveNav(nav);
    setShowSettingsPanel(nav === 'settings');
    setShowNotifPanel(nav === 'notifications');
  };

  // Click a notification → open that user's chat
  const handleNotifClick = (notif: Notification) => {
    const foundUser = users.find((u) => u._id === notif.userId);
    if (foundUser) {
      setSelectedUser(foundUser);
      setUnreadCounts((prev) => ({ ...prev, [notif.userId]: 0 }));
      setNotifications((prev) => prev.filter((n) => n.userId !== notif.userId));
    }
    setShowNotifPanel(false);
    setActiveNav('chat');
  };

  const handleMarkAllRead = () => {
    setNotifications([]);
    setUnreadCounts({});
  };

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  const isOnline = (userId: string) => onlineUsers.includes(userId);
  const isTyping = selectedUser ? typingUsers.includes(selectedUser._id) : false;
  const currentUserId = (user as any)?.id || (user as any)?._id;
  const currentUsername = (user as any)?.username || 'User';
  const currentEmail = (user as any)?.email || '';

  return (
    <div className="h-screen flex overflow-hidden bg-[#0f0508]">

      {/* SIDEBAR */}
      <div className="w-[280px] flex flex-col bg-[#160609] border-r border-white/5 shrink-0 relative">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#F26076] to-[#FF9760] flex items-center justify-center text-sm">✦</div>
            <span className="text-white font-bold text-base">CipherChat</span>
          </div>
          <button onClick={handleLogout} className="text-xs text-gray-500 hover:text-red-400 transition-colors">Logout</button>
        </div>

        {/* Search */}
        <div className="px-3 py-3">
          <div className="flex items-center gap-2 bg-white/5 border border-white/8 rounded-xl px-3 py-2">
            <span className="text-gray-500 text-sm">🔍</span>
            <input type="text" placeholder="Search chats..." className="bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none flex-1" />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-3 mb-2">
          {['All', 'Unread', 'Groups', 'DMs'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-all ${
                activeTab === tab ? 'bg-gradient-to-r from-[#F26076] to-[#FF9760] text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Users List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          <p className="text-xs text-gray-500 font-medium px-2 py-1.5 uppercase tracking-wider">Users</p>

          {users.length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-600 text-sm">No users found</p>
              <p className="text-gray-700 text-xs mt-1">Register another account to chat!</p>
            </div>
          )}

          {users.map((u) => (
            <div
              key={u._id}
              onClick={() => { setSelectedUser(u); setUnreadCounts((prev) => ({ ...prev, [u._id]: 0 })); }}
              className={`flex items-center gap-3 px-2 py-2.5 rounded-xl cursor-pointer transition-all ${
                selectedUser?._id === u._id ? 'bg-[#F26076]/15 border border-[#F26076]/25' : 'hover:bg-white/4'
              }`}
            >
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#F26076] to-[#FF9760] flex items-center justify-center text-white font-bold text-sm">
                  {u.username[0].toUpperCase()}
                </div>
                {isOnline(u._id) && <span className="absolute bottom-0 right-0 w-3 h-3 bg-[#458B73] rounded-full border-2 border-[#160609]" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white truncate">{u.username}</p>
                  {unreadCounts[u._id] > 0 && (
                    <span className="shrink-0 min-w-5 h-5 px-1 rounded-full bg-gradient-to-br from-[#F26076] to-[#FF9760] text-white text-xs flex items-center justify-center font-bold">
                      {unreadCounts[u._id] > 9 ? '9+' : unreadCounts[u._id]}
                    </span>
                  )}
                </div>
                <p className={`text-xs ${isOnline(u._id) ? 'text-[#458B73]' : 'text-gray-600'}`}>
                  {isOnline(u._id) ? 'Online' : 'Offline'}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Nav */}
        <div className="flex items-center justify-around py-3 border-t border-white/5">
          {[
            { icon: '💬', key: 'chat' },
            { icon: '👥', key: 'groups' },
            { icon: '🔔', key: 'notifications' },
            { icon: '⚙️', key: 'settings' },
          ].map(({ icon, key }) => (
            <button
              key={key}
              onClick={() => handleNavClick(key)}
              className={`p-2 rounded-xl transition-all relative ${
                activeNav === key ? 'text-[#F26076]' : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              <span className="text-lg">{icon}</span>
              {/* Unread badge on bell */}
              {key === 'notifications' && totalUnread > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#F26076] text-white text-[10px] flex items-center justify-center font-bold">
                  {totalUnread > 9 ? '9+' : totalUnread}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ===== SETTINGS PANEL ===== */}
        {showSettingsPanel && (
          <div className="absolute inset-0 bg-[#160609] z-20 flex flex-col">
            <div className="flex items-center gap-3 px-4 py-4 border-b border-white/5">
              <button
                onClick={() => { setShowSettingsPanel(false); setActiveNav('chat'); }}
                className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-all"
              >←</button>
              <span className="text-white font-semibold text-base">Settings</span>
            </div>
            <div className="px-4 py-5">
              <div className="bg-white/5 rounded-2xl p-5 flex flex-col items-center gap-3 border border-white/8">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[#F26076] to-[#FF9760] flex items-center justify-center text-white font-bold text-3xl shadow-lg shadow-[#F26076]/20">
                  {currentUsername[0]?.toUpperCase()}
                </div>
                <div className="text-center">
                  <p className="text-white font-bold text-lg">{currentUsername}</p>
                  <p className="text-gray-400 text-sm mt-0.5">{currentEmail}</p>
                </div>
                <div className="flex items-center gap-1.5 bg-[#458B73]/15 border border-[#458B73]/30 rounded-full px-3 py-1">
                  <span className="w-2 h-2 rounded-full bg-[#458B73]" />
                  <span className="text-[#458B73] text-xs font-medium">Online</span>
                </div>
              </div>
            </div>
            <div className="px-4">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2 px-1">Account Info</p>
              <div className="bg-white/5 rounded-2xl border border-white/8 overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
                  <span className="text-lg">👤</span>
                  <div>
                    <p className="text-xs text-gray-500">Username</p>
                    <p className="text-white text-sm font-medium">{currentUsername}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 px-4 py-3">
                  <span className="text-lg">✉️</span>
                  <div>
                    <p className="text-xs text-gray-500">Email</p>
                    <p className="text-white text-sm font-medium">{currentEmail || '—'}</p>
                  </div>
                </div>
              </div>
            </div>
            <div className="px-4 mt-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-white/5 rounded-2xl border border-white/8 p-3 text-center">
                  <p className="text-[#F26076] font-bold text-xl">{users.length}</p>
                  <p className="text-gray-500 text-xs mt-0.5">Contacts</p>
                </div>
                <div className="bg-white/5 rounded-2xl border border-white/8 p-3 text-center">
                  <p className="text-[#458B73] font-bold text-xl">{onlineUsers.length}</p>
                  <p className="text-gray-500 text-xs mt-0.5">Online Now</p>
                </div>
              </div>
            </div>
            <div className="flex-1" />
            <div className="px-4 pb-6">
              <button
                onClick={handleLogout}
                className="w-full py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 font-semibold text-sm transition-all flex items-center justify-center gap-2"
              >
                <span>🚪</span> Logout
              </button>
            </div>
          </div>
        )}

        {/* ===== NOTIFICATIONS PANEL ===== */}
        {showNotifPanel && (
          <div className="absolute inset-0 bg-[#160609] z-20 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => { setShowNotifPanel(false); setActiveNav('chat'); }}
                  className="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-400 hover:text-white transition-all"
                >←</button>
                <span className="text-white font-semibold text-base">Notifications</span>
              </div>
              {notifications.length > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-xs text-[#FF9760] hover:text-[#F26076] transition-colors font-medium"
                >
                  Mark all read
                </button>
              )}
            </div>

            {/* Notif List */}
            <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
              {notifications.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-3 pb-10">
                  <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center text-3xl">
                    🔔
                  </div>
                  <p className="text-gray-500 text-sm">No new notifications</p>
                </div>
              ) : (
                notifications.map((notif) => (
                  <div
                    key={notif.userId}
                    onClick={() => handleNotifClick(notif)}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer hover:bg-white/5 transition-all border border-transparent hover:border-white/8"
                  >
                    {/* Avatar */}
                    <div className="relative shrink-0">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#F26076] to-[#FF9760] flex items-center justify-center text-white font-bold text-sm">
                        {notif.username[0].toUpperCase()}
                      </div>
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-white text-sm font-medium truncate">{notif.username}</p>
                        <p className="text-gray-600 text-xs shrink-0 ml-2">{formatTime(notif.time)}</p>
                      </div>
                      <p className="text-gray-400 text-xs truncate mt-0.5">{notif.message}</p>
                    </div>
                    {/* Count badge */}
                    {notif.count > 0 && (
                      <span className="shrink-0 min-w-5 h-5 px-1 rounded-full bg-gradient-to-br from-[#F26076] to-[#FF9760] text-white text-xs flex items-center justify-center font-bold">
                        {notif.count > 9 ? '9+' : notif.count}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* CHAT AREA */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&q=80')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'brightness(0.3) saturate(1.5)',
          }}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#0f0508]/60 via-transparent to-[#0f0508]/80" />

        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className="relative z-10 flex items-center justify-between px-6 py-3 bg-black/20 backdrop-blur-md border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#F26076] to-[#FF9760] flex items-center justify-center text-white font-bold">
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  {isOnline(selectedUser._id) && <span className="absolute bottom-0 right-0 w-3 h-3 bg-[#458B73] rounded-full border-2 border-transparent" />}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">{selectedUser.username}</p>
                  <p className={`text-xs ${isTyping ? 'text-[#FF9760]' : isOnline(selectedUser._id) ? 'text-[#458B73]' : 'text-gray-500'}`}>
                    {isTyping ? 'typing...' : isOnline(selectedUser._id) ? 'Online' : 'Offline'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {['📞', '📹', '⋮'].map((icon, i) => (
                  <button key={i} className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-300 transition-all">
                    {icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Messages */}
            <div className="relative z-10 flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {messages.length === 0 && (
                <div className="flex justify-center mt-8">
                  <div className="bg-black/30 backdrop-blur-sm px-4 py-2 rounded-full border border-white/5">
                    <p className="text-gray-400 text-sm">Say hi to {selectedUser.username}! 👋</p>
                  </div>
                </div>
              )}
              {messages.map((msg) => {
                const isSent = msg.sender._id === currentUserId;
                return (
                  <div key={msg._id} className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-xs px-4 py-2.5 rounded-2xl ${
                      isSent
                        ? 'bg-gradient-to-br from-[#F26076] to-[#FF9760] text-white rounded-tr-sm'
                        : 'bg-black/40 backdrop-blur-sm border border-white/10 text-white rounded-tl-sm'
                    }`}>
                      <p className="text-sm">{msg.message}</p>
                      <p className={`text-xs mt-1 ${isSent ? 'text-[#ffe0c0] text-right' : 'text-gray-500'}`}>
                        {formatTime(msg.createdAt)} {isSent && '✓✓'}
                      </p>
                    </div>
                  </div>
                );
              })}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-black/40 backdrop-blur-sm border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="w-2 h-2 rounded-full bg-[#FF9760]" style={{ opacity: 1 - i * 0.3 }} />
                    ))}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="relative z-10 px-4 py-3 bg-black/30 backdrop-blur-md border-t border-white/5">
              <div className="flex items-center gap-3">
                <button className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#F26076] transition-all shrink-0 text-lg">+</button>
                <div className="flex-1 flex items-center gap-2 bg-white/5 border border-white/8 rounded-2xl px-4 py-2.5">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={handleTyping}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message ${selectedUser.username}...`}
                    className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
                  />
                  <button className="text-gray-500 hover:text-[#FF9760] transition-colors text-lg">😊</button>
                </div>
                <button
                  onClick={handleSendMessage}
                  className="w-11 h-11 rounded-full bg-gradient-to-br from-[#F26076] to-[#FF9760] flex items-center justify-center text-white shadow-lg shadow-[#F26076]/30 hover:shadow-[#F26076]/50 transition-all hover:-translate-y-0.5 shrink-0"
                >➤</button>
              </div>
            </div>
          </>
        ) : (
          <div className="relative z-10 flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-20 h-20 bg-black/30 backdrop-blur-sm rounded-3xl flex items-center justify-center mx-auto mb-4 border border-white/10">
                <span className="text-4xl">💬</span>
              </div>
              <p className="text-white font-semibold text-lg">Select a conversation</p>
              <p className="text-gray-500 text-sm mt-1">Choose someone to start chatting</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatPage;