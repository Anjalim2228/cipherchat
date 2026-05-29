import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from '../models/Message';
import User from '../models/User';

// Store online users: userId -> socketId
const onlineUsers = new Map<string, string>();

export const initializeSocket = (io: Server) => {

  // Middleware - verify JWT before connection
  io.use(async (socket: any, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET as string
      ) as { userId: string };

      const user = await User.findById(decoded.userId).select('-password');
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = decoded.userId;
      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket: any) => {
    const userId = socket.userId;
    console.log(`✅ User connected: ${socket.user.username} (${socket.id})`);

    // Add to online users
    onlineUsers.set(userId, socket.id);

    // Update user online status in DB
    await User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() });

    // Broadcast online users list to everyone
    io.emit('onlineUsers', Array.from(onlineUsers.keys()));

    // ─── Send Message ──────────────────────────────
    socket.on('sendMessage', async (data: {
      receiverId: string;
      message: string;
    }) => {
      try {
        // Save message to MongoDB
        const newMessage = await Message.create({
          sender: userId,
          receiver: data.receiverId,
          message: data.message,
          messageType: 'text',
        });

        // Populate sender info
        const populatedMessage = await Message.findById(newMessage._id)
          .populate('sender', 'username avatar')
          .populate('receiver', 'username avatar');
            // Send to receiver if online
            const receiverSocketId = onlineUsers.get(data.receiverId);
            if (receiverSocketId) {
              io.to(receiverSocketId).emit('receiveMessage', populatedMessage);
            }

            // Send back to sender too
            socket.emit('receiveMessage', populatedMessage);

        

      } catch (error) {
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // ─── Typing Indicator ─────────────────────────
    socket.on('typing', (data: { receiverId: string }) => {
      const receiverSocketId = onlineUsers.get(data.receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('userTyping', {
          userId,
          username: socket.user.username,
        });
      }
    });

    // ─── Stop Typing ──────────────────────────────
    socket.on('stopTyping', (data: { receiverId: string }) => {
      const receiverSocketId = onlineUsers.get(data.receiverId);
      if (receiverSocketId) {
        io.to(receiverSocketId).emit('userStopTyping', { userId });
      }
    });

    // ─── Mark Messages as Read ────────────────────
    socket.on('markAsRead', async (data: { senderId: string }) => {
      await Message.updateMany(
        { sender: data.senderId, receiver: userId, isRead: false },
        { isRead: true }
      );

      const senderSocketId = onlineUsers.get(data.senderId);
      if (senderSocketId) {
        io.to(senderSocketId).emit('messagesRead', { by: userId });
      }
    });

    // ─── Disconnect ───────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`❌ User disconnected: ${socket.user.username}`);
      onlineUsers.delete(userId);

      await User.findByIdAndUpdate(userId, {
        isOnline: false,
        lastSeen: new Date(),
      });

      io.emit('onlineUsers', Array.from(onlineUsers.keys()));
    });
  });
};