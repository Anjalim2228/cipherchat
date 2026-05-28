import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const contacts = [
  { id: 1, name: 'Sneha', msg: 'typing...', time: '10:31 AM', unread: 2, online: true, typing: true, avatar: 'https://i.pravatar.cc/150?img=47' },
  { id: 2, name: 'Rahul', msg: 'Notes bhej yaar 📚', time: '9:11 AM', unread: 1, online: true, typing: false, avatar: 'https://i.pravatar.cc/150?img=12' },
  { id: 3, name: 'Mom', msg: 'Khaana kha liya? 🍱', time: 'Yesterday', unread: 0, online: false, typing: false, avatar: 'https://i.pravatar.cc/150?img=32' },
  { id: 4, name: 'Study Group', msg: 'Ankit: Chapter 5 done ✅', time: '8:45 AM', unread: 8, online: false, typing: false, avatar: 'https://i.pravatar.cc/150?img=15' },
  { id: 5, name: 'Best Friends', msg: 'Riya: Hahaha 😂', time: 'Yesterday', unread: 0, online: false, typing: false, avatar: 'https://i.pravatar.cc/150?img=20' },
  { id: 6, name: 'Work Team', msg: 'Client call at 4 PM', time: 'Mon', unread: 0, online: false, typing: false, avatar: 'https://i.pravatar.cc/150?img=8' },
  { id: 7, name: 'Dad', msg: 'Call me when free', time: 'Sun', unread: 0, online: false, typing: false, avatar: 'https://i.pravatar.cc/150?img=51' },
];

const messages = [
  { id: 1, text: 'Kya kar rahi ho? 😊', time: '10:30 AM', sent: false },
  { id: 2, text: 'CipherChat bana rahi hun ✨', time: '10:31 AM', sent: true },
  { id: 3, text: 'Waah! Mast hai 🔥', time: '10:32 AM', sent: false },
  { id: 4, text: 'Thanks yaar! 🙌😄', time: '10:33 AM', sent: true },
];

const ChatPage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(contacts[0]);
  const [activeTab, setActiveTab] = useState('All');
  const [message, setMessage] = useState('');

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="h-screen flex overflow-hidden bg-[#0a0015]">

      {/* ── SIDEBAR ─────────────────────────────── */}
      <div className="w-[280px] flex flex-col bg-[#0d0020] border-r border-white/5 shrink-0">

        {/* Sidebar Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-sm">
              ✦
            </div>
            <span className="text-white font-bold text-base">CipherChat</span>
          </div>
          <button className="w-8 h-8 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-lg font-light">
            +
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
            <span className="text-xs text-gray-600 bg-white/5 px-1.5 py-0.5 rounded">Ctrl K</span>
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

        {/* Contacts List */}
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {/* Favorites */}
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs text-gray-500 font-medium tracking-wider uppercase">Favorites</span>
            <span className="text-gray-600 text-sm">+</span>
          </div>

          {contacts.slice(0, 3).map((c) => (
            <div
              key={c.id}
              onClick={() => setSelected(c)}
              className={`flex items-center gap-3 px-2 py-2.5 rounded-xl cursor-pointer transition-all ${
                selected.id === c.id
                  ? 'bg-purple-500/15 border border-purple-500/25'
                  : 'hover:bg-white/4'
              }`}
            >
              <div className="relative shrink-0">
                <img src={c.avatar} alt={c.name} className="w-10 h-10 rounded-full object-cover"/>
                {c.online && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-[#0d0020]"/>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline">
                  <span className="text-sm font-medium text-white truncate">{c.name}</span>
                  <span className="text-xs text-gray-600 shrink-0 ml-1">{c.time}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className={`text-xs truncate ${c.typing ? 'text-purple-400' : 'text-gray-500'}`}>
                    {c.msg}
                  </span>
                  {c.unread > 0 && (
                    <span className="ml-1 shrink-0 w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white text-xs flex items-center justify-center font-bold">
                      {c.unread}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* All Chats */}
          <div className="flex items-center justify-between px-2 py-1.5 mt-1">
            <span className="text-xs text-gray-500 font-medium tracking-wider uppercase">All Chats</span>
          </div>

          {contacts.slice(3).map((c) => (
            <div
              key={c.id}
              onClick={() => setSelected(c)}
              className={`flex items-center gap-3 px-2 py-2.5 rounded-xl cursor-pointer transition-all ${
                selected.id === c.id
                  ? 'bg-purple-500/15 border border-purple-500/25'
                  : 'hover:bg-white/4'
              }`}
            >
              <div className="relative shrink-0">
                <img src={c.avatar} alt={c.name} className="w-10 h-10 rounded-full object-cover"/>
                {c.online && (
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-[#0d0020]"/>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline">
                  <span className="text-sm font-medium text-white truncate">{c.name}</span>
                  <span className="text-xs text-gray-600 shrink-0 ml-1">{c.time}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-500 truncate">{c.msg}</span>
                  {c.unread > 0 && (
                    <span className="ml-1 shrink-0 w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 text-white text-xs flex items-center justify-center font-bold">
                      {c.unread}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Navbar */}
        <div className="flex items-center justify-around py-3 border-t border-white/5 px-4">
          {[
            { icon: '💬', label: 'Chats', active: true },
            { icon: '👥', label: 'Contacts', active: false },
            { icon: '🔔', label: 'Alerts', active: false },
            { icon: '⚙️', label: 'Settings', active: false },
          ].map((item) => (
            <button
              key={item.label}
              className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
                item.active
                  ? 'text-purple-400'
                  : 'text-gray-600 hover:text-gray-400'
              }`}
            >
              <span className="text-lg">{item.icon}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── CHAT AREA ────────────────────────────── */}
      <div className="flex-1 flex flex-col relative overflow-hidden">

        {/* Space background */}
        <div
          className="absolute inset-0 z-0"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1200&q=80')`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'brightness(0.35) saturate(1.5)',
          }}
        />
        <div className="absolute inset-0 z-0 bg-gradient-to-b from-[#0a0015]/60 via-transparent to-[#0a0015]/80"/>

        {/* Chat Header */}
        <div className="relative z-10 flex items-center justify-between px-6 py-3 bg-black/20 backdrop-blur-md border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="relative">
              <img src={selected.avatar} alt={selected.name} className="w-10 h-10 rounded-full object-cover"/>
              {selected.online && (
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-transparent"/>
              )}
            </div>
            <div>
              <p className="text-white font-semibold text-sm">{selected.name}</p>
              <p className={`text-xs ${selected.typing ? 'text-purple-400' : 'text-green-400'}`}>
                {selected.typing ? 'typing...' : selected.online ? 'Online' : 'Offline'}
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
          {/* Date badge */}
          <div className="flex justify-center">
            <span className="text-xs text-gray-400 bg-black/30 backdrop-blur-sm px-4 py-1 rounded-full border border-white/5">
              ✦ Today ✦
            </span>
          </div>

          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.sent ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-xs px-4 py-2.5 rounded-2xl ${
                  msg.sent
                    ? 'bg-gradient-to-br from-purple-600 to-pink-600 text-white rounded-tr-sm'
                    : 'bg-black/40 backdrop-blur-sm border border-white/10 text-white rounded-tl-sm'
                }`}
              >
                <p className="text-sm">{msg.text}</p>
                <p className={`text-xs mt-1 ${msg.sent ? 'text-purple-200 text-right' : 'text-gray-500'}`}>
                  {msg.time} {msg.sent && '✓✓'}
                </p>
              </div>
            </div>
          ))}

          {/* Typing indicator */}
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
        </div>

        {/* Input Bar */}
        <div className="relative z-10 px-4 py-3 bg-black/30 backdrop-blur-md border-t border-white/5">
          <div className="flex items-center gap-3">
            <button className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-purple-400 transition-all shrink-0">
              +
            </button>
            <div className="flex-1 flex items-center gap-2 bg-white/5 border border-white/8 rounded-2xl px-4 py-2.5">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={`Message ${selected.name}...`}
                className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
              />
              <button className="text-gray-500 hover:text-purple-400 transition-colors text-lg">😊</button>
              <button className="text-gray-500 hover:text-purple-400 transition-colors">🎤</button>
            </div>
            <button className="w-11 h-11 rounded-full bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/30 hover:shadow-purple-500/50 transition-all hover:-translate-y-0.5 shrink-0">
              ➤
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ChatPage;