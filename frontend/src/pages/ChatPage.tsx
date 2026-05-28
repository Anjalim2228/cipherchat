import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const ChatPage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="h-screen bg-[#0e0e17] flex flex-col">
      {/* Top Navbar */}
      <div className="h-16 bg-[#1e1e2e] border-b border-white/10 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-[#6270f3] rounded-lg flex items-center justify-center">
            <span className="text-sm">🔐</span>
          </div>
          <h1 className="text-white font-bold text-lg">CipherChat</h1>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-gray-400 text-sm">
            {user?.username || 'User'}
          </span>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-400 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-400/10"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-80 bg-[#13131e] border-r border-white/10 flex flex-col">
          {/* Search */}
          <div className="p-4">
            <input
              type="text"
              placeholder="Search users..."
              className="w-full bg-[#1e1e2e] border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-[#6270f3] text-sm"
            />
          </div>

          {/* Users List */}
          <div className="flex-1 overflow-y-auto px-2">
            <p className="text-gray-500 text-xs font-medium px-2 mb-2 uppercase tracking-wider">
              Users
            </p>

            {/* Placeholder users */}
            {['Alice', 'Bob', 'Charlie', 'David'].map((name) => (
              <div
                key={name}
                onClick={() => setSelectedUser(name)}
                className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all mb-1 ${
                  selectedUser === name
                    ? 'bg-[#6270f3]/20 border border-[#6270f3]/30'
                    : 'hover:bg-white/5'
                }`}
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#6270f3] to-[#a78bfa] flex items-center justify-center shrink-0">
                  <span className="text-white font-semibold text-sm">
                    {name[0]}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium">{name}</p>
                  <p className="text-gray-500 text-xs truncate">
                    Click to start chatting
                  </p>
                </div>

                {/* Online dot */}
                <div className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
              </div>
            ))}
          </div>
        </div>

        {/* Chat Window */}
        <div className="flex-1 flex flex-col">
          {selectedUser ? (
            <>
              {/* Chat Header */}
              <div className="h-16 bg-[#1e1e2e] border-b border-white/10 flex items-center px-6 gap-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#6270f3] to-[#a78bfa] flex items-center justify-center">
                  <span className="text-white font-semibold text-sm">
                    {selectedUser[0]}
                  </span>
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{selectedUser}</p>
                  <p className="text-green-400 text-xs">Online</p>
                </div>
              </div>

              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* Sample messages */}
                <div className="flex justify-start">
                  <div className="bg-[#1e1e2e] border border-white/10 rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-xs">
                    <p className="text-white text-sm">Hey! How are you? 👋</p>
                    <p className="text-gray-500 text-xs mt-1">10:30 AM</p>
                  </div>
                </div>

                <div className="flex justify-end">
                  <div className="bg-[#6270f3] rounded-2xl rounded-tr-sm px-4 py-2.5 max-w-xs">
                    <p className="text-white text-sm">I'm good! Working on CipherChat 🚀</p>
                    <p className="text-purple-200 text-xs mt-1">10:31 AM</p>
                  </div>
                </div>

                <div className="flex justify-start">
                  <div className="bg-[#1e1e2e] border border-white/10 rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-xs">
                    <p className="text-white text-sm">That's awesome! 🔥</p>
                    <p className="text-gray-500 text-xs mt-1">10:32 AM</p>
                  </div>
                </div>
              </div>

              {/* Message Input */}
              <div className="p-4 bg-[#13131e] border-t border-white/10">
                <div className="flex items-center gap-3 bg-[#1e1e2e] border border-white/10 rounded-2xl px-4 py-3">
                  <input
                    type="text"
                    placeholder="Type a message..."
                    className="flex-1 bg-transparent text-white placeholder-gray-500 focus:outline-none text-sm"
                  />
                  <button className="w-8 h-8 bg-[#6270f3] hover:bg-[#4f4fe7] rounded-xl flex items-center justify-center transition-all hover:-translate-y-0.5">
                    <span className="text-white text-sm">➤</span>
                  </button>
                </div>
              </div>
            </>
          ) : (
            /* Empty State */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 bg-[#1e1e2e] rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <span className="text-3xl">💬</span>
                </div>
                <p className="text-white font-medium">Select a conversation</p>
                <p className="text-gray-500 text-sm mt-1">
                  Choose a user from the sidebar to start chatting
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatPage;