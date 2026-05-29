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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Initialize socket
  useEffect(() => {
    if (!token) return;

    const timer = setTimeout(() => {
      const socket = initializeSocket(token);

      socket.on('onlineUsers', (userIds: string[]) => {
        setOnlineUsers(userIds);
      });

      // KEY FIX — use setSelectedUser to read latest state
      socket.on('receiveMessage', (message: Message) => {
  setSelectedUser((currentSelected) => {
    if (
      currentSelected &&
      (message.sender._id === currentSelected._id ||
        message.receiver._id === currentSelected._id)
    ) {
      setMessages((prev) => {
        // Prevent duplicate messages
        const exists = prev.some((m) => m._id === message._id);
        if (exists) return prev;
        return [...prev, message];
      });
    }
    return currentSelected;
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

  // Fetch users
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

  // Fetch messages when user selected
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

  // Send message
  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedUser) return;

    const socket = getSocket();
    if (!socket) return;

    socket.emit('sendMessage', {
      receiverId: selectedUser._id,
      message: newMessage.trim(),
    });

    setNewMessage('');
    socket.emit('stopTyping', { receiverId: selectedUser._id });
  };

  // Typing indicator
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

  // Send on Enter
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
    return new Date(dateString).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const isOnline = (userId: string) => onlineUsers.includes(userId);
  const isTyping = selectedUser ? typingUsers.includes(selectedUser._id) : false;

  // Fix sent/received detection
  const currentUserId = (user as any)?._id || (user as any)?.id;

  return (
    <div className="h-screen flex overflow-hidden bg-[#0a0015]">

      {/* SIDEBAR */}
      <div className="w-[280px] flex flex-col bg-[#0d0020] border-r border-white/5 shrink-0">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-sm">
              ✦
            </div>
            <span className="text-white font-bold text-base">CipherChat</span>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors"
          >
            Logout
          </button>
        </div>

        {/* Search */}
        <div className="px-3 py-3">
          <div className="flex items-center gap-2 bg-white/5 border border-white/8 rounded-xl px-3 py-2">
            <span className="text-gray-500 text-sm">🔍</span>
            <input
              type="text"
              placeholder="Search chats..."
              className="bg-transparent text-sm text-white placeholder-gray-500 focus:outline-none flex-1"
            />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-3 mb-2">
          {['All', 'Unread', 'Groups', 'DMs'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 text-xs py-1.5 rounded-lg font-medium transition-all ${
                activeTab === tab
                  ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Users List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          <p className="text-xs text-gray-500 font-medium px-2 py-1.5 uppercase tracking-wider">
            Users
          </p>

          {users.length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-600 text-sm">No users found</p>
              <p className="text-gray-700 text-xs mt-1">
                Register another account to chat!
              </p>
            </div>
          )}

          {users.map((u) => (
            <div
              key={u._id}
              onClick={() => setSelectedUser(u)}
              className={`flex items-center gap-3 px-2 py-2.5 rounded-xl cursor-pointer transition-all ${
                selectedUser?._id === u._id
                  ? 'bg-purple-500/15 border border-purple-500/25'
                  : 'hover:bg-white/4'
              }`}
            >
              <div className="relative shrink-0">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold text-sm">
                  {u.username[0].toUpperCase()}
                </div>
                {isOnline(u._id) && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-[#0d0020]" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {u.username}
                </p>
                <p className={`text-xs ${isOnline(u._id) ? 'text-green-400' : 'text-gray-600'}`}>
                  {isOnline(u._id) ? 'Online' : 'Offline'}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Nav */}
        <div className="flex items-center justify-around py-3 border-t border-white/5">
          {['💬', '👥', '🔔', '⚙️'].map((icon, i) => (
            <button
              key={i}
              className={`p-2 rounded-xl transition-all ${
                i === 0 ? 'text-purple-400' : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              <span className="text-lg">{icon}</span>
            </button>
          ))}
        </div>
      </div>

      {/* CHAT AREA */}
      <div className="flex-1 flex flex-col relative overflow-hidden">

        {/* Space background */}
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&q=80')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'brightness(0.3) saturate(1.5)',
          }}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#0a0015]/60 via-transparent to-[#0a0015]/80" />

        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className="relative z-10 flex items-center justify-between px-6 py-3 bg-black/20 backdrop-blur-md border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white font-bold">
                    {selectedUser.username[0].toUpperCase()}
                  </div>
                  {isOnline(selectedUser._id) && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-transparent" />
                  )}
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">
                    {selectedUser.username}
                  </p>
                  <p className={`text-xs ${
                    isTyping
                      ? 'text-purple-400'
                      : isOnline(selectedUser._id)
                      ? 'text-green-400'
                      : 'text-gray-500'
                  }`}>
                    {isTyping
                      ? 'typing...'
                      : isOnline(selectedUser._id)
                      ? 'Online'
                      : 'Offline'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {['📞', '📹', '⋮'].map((icon, i) => (
                  <button
                    key={i}
                    className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-300 transition-all"
                  >
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
                    <p className="text-gray-400 text-sm">
                      Say hi to {selectedUser.username}! 👋
                    </p>
                  </div>
                </div>
              )}

              {messages.map((msg) => {
                const isSent = msg.sender._id === currentUserId;
                return (
                  <div
                    key={msg._id}
                    className={`flex ${isSent ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-xs px-4 py-2.5 rounded-2xl ${
                        isSent
                          ? 'bg-gradient-to-br from-purple-600 to-pink-600 text-white rounded-tr-sm'
                          : 'bg-black/40 backdrop-blur-sm border border-white/10 text-white rounded-tl-sm'
                      }`}
                    >
                      <p className="text-sm">{msg.message}</p>
                      <p className={`text-xs mt-1 ${isSent ? 'text-purple-200 text-right' : 'text-gray-500'}`}>
                        {formatTime(msg.createdAt)} {isSent && '✓✓'}
                      </p>
                    </div>
                  </div>
                );
              })}

              {/* Typing indicator */}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="bg-black/40 backdrop-blur-sm border border-white/10 rounded-2xl rounded-tl-sm px-4 py-3 flex gap-1.5 items-center">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="w-2 h-2 rounded-full bg-purple-400"
                        style={{ opacity: 1 - i * 0.3 }}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="relative z-10 px-4 py-3 bg-black/30 backdrop-blur-md border-t border-white/5">
              <div className="flex items-center gap-3">
                <button className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-purple-400 transition-all shrink-0 text-lg">
                  +
                </button>
                <div className="flex-1 flex items-center gap-2 bg-white/5 border border-white/8 rounded-2xl px-4 py-2.5">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={handleTyping}
                    onKeyDown={handleKeyDown}
                    placeholder={`Message ${selectedUser.username}...`}
                    className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
                  />
                  <button className="text-gray-500 hover:text-purple-400 transition-colors text-lg">
                    😊
                  </button>
                </div>
                <button
                  onClick={handleSendMessage}
                  className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 transition-all hover:-translate-y-0.5 shrink-0"
                >
                  ➤
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="relative z-10 flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-20 h-20 bg-black/30 backdrop-blur-sm rounded-3xl flex items-center justify-center mx-auto mb-4 border border-white/10">
                <span className="text-4xl">💬</span>
              </div>
              <p className="text-white font-semibold text-lg">
                Select a conversation
              </p>
              <p className="text-gray-500 text-sm mt-1">
                Choose someone to start chatting
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatPage;